// Job definitions for "analysis" (02-system.md §3). Imported by src/server/jobs/all.ts.
// analysis.site (ref = businessId), payload { keepEdits }. Progress (CONTRACTS.md):
//   { phase: 'site'|'biz'|'content'|'aud'|'brand'|'done', results: {site?,biz?,content?,aud?,brand?}, colors?: [p,s], logoMissing?, failed? }
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { env } from '../../env';
import { defineJob, PermanentJobError } from '../../jobs/queue';
import { bump, defaultProfile } from '../../workspace';
import { crawlSite, CrawlError, type CrawledPage } from './crawl';
import { detectBrand } from './brand';
import { extractBusiness, extractAudience, extractVoice, seedKeywords, classifyAmbiguous, siteDigest } from './extract';
import { mergeAnalysis } from './merge';
import { estimate } from '../keywords/provider';
import { refreshKeywordSuggestions } from '../keywords/suggest';
import { topPages, topQueries, hasData } from '../gsc/metrics';
import { HEX_RE } from '@/lib/format';
import type { Keyword, Profile } from '@/lib/types';

export const crawlFailCopy = (domain: string) => `Radar couldn’t reach ${domain}. The site may be down or blocking crawlers.`;
/** Dev-stub pacing so the streamed phases are visible (real runs take as long as they take). */
const pace = () => (env.devStubs ? new Promise(r => setTimeout(r, 650 + Math.random() * 450)) : Promise.resolve());

defineJob<{ keepEdits?: boolean }>({
  kind: 'analysis.site', maxAttempts: 2, backoffMs: () => 3000, timeoutMs: 15 * 60e3,
  run: async ctx => {
    const bid = ctx.businessId!;
    const b = (await db.select().from(schema.businesses).where(eq(schema.businesses.id, bid)).limit(1))[0];
    if (!b) throw new PermanentJobError('Business not found');
    const domain = b.domain; const keepEdits = !!ctx.payload.keepEdits;
    const results: Record<string, string> = {};
    const prog: any = { phase: 'site', results };
    const emit = (p: any) => { Object.assign(prog, p); return ctx.progress({ ...prog, results: { ...results } }); };
    await emit({ phase: 'site' });

    // 1) site — robots, sitemap, crawl
    let crawl;
    try { crawl = await crawlSite(domain); }
    catch (e: any) {
      if (e instanceof CrawlError) { await emit({ phase: 'site', failed: crawlFailCopy(domain) }); throw new PermanentJobError(crawlFailCopy(domain)); }
      throw e;
    }
    const pages = crawl.pages;
    await db.delete(schema.crawlPages).where(eq(schema.crawlPages.businessId, bid));
    const ambiguousArticles = await classifyAmbiguous(bid, pages);
    pages.forEach(p => { if (!p.kindSure && ambiguousArticles.has(p.url)) p.kind = 'article'; });
    const rows = pages.map((p: CrawledPage) => ({ businessId: bid, url: p.url, path: p.path, title: p.title, kind: p.kind, h1: p.h1, description: p.description, text: p.text, links: p.links.slice(0, 200) }));
    for (let i = 0; i < rows.length; i += 50) await db.insert(schema.crawlPages).values(rows.slice(i, i + 50)).onConflictDoNothing();
    await pace();
    results.site = `${pages.length} pages on ${domain}`;
    await emit({ phase: 'biz' });

    const digest = siteDigest(pages);
    // 2) biz
    const business = await extractBusiness(bid, domain, digest);
    await pace();
    results.biz = `${business.name} · ${business.industry}`;
    await emit({ phase: 'content' });

    // 3) content — articles; pages already ranking need Search Console (DIVERGENCES #9)
    const articles = pages.filter(p => p.kind === 'article').length;
    let ranking: number | null = null;
    const g = (await db.select().from(schema.gscConnections).where(eq(schema.gscConnections.businessId, bid)).limit(1))[0];
    const gscLive = !!g && (g.status === 'connected' || g.status === 'error') && await hasData(bid);
    if (gscLive) {
      const tp = await topPages(bid, 28, 5000); const urls = new Set(pages.map(p => p.url.replace(/\/$/, '')));
      ranking = tp.filter(r => r.pos > 0 && r.pos <= 20 && urls.has(r.url.replace(/\/$/, ''))).length;
    }
    await pace();
    results.content = ranking != null ? `${articles} articles · ${ranking} pages already rank` : `${articles} articles`;
    await emit({ phase: 'aud' });

    // 4) aud
    const audience = await extractAudience(bid, domain, business, digest);
    await pace();
    results.aud = `${audience.segments.length} segments · ${audience.competitors.length} competitors`;
    await emit({ phase: 'brand' });

    // 5) brand — logo, colors, voice, language, markets
    const [det, voice] = await Promise.all([detectBrand(bid, crawl.homeHtml, crawl.origin), extractVoice(bid, domain, digest, null)]);
    const base = defaultProfile(domain).brand;
    const primary = det.primary && HEX_RE.test(det.primary) ? det.primary : base.primary;
    const secondary = det.secondary && HEX_RE.test(det.secondary) ? det.secondary : base.secondary;

    // 6) keywords — site topics + Search Console queries, then volume/difficulty. Priorities stay empty.
    const seeds = await seedKeywords(bid, domain, business, audience, digest);
    const market = voice.markets[0] || 'United States'; const language = det.language || voice.language || 'English (US)';
    const kwMap = new Map<string, Keyword>();
    if (gscLive) {
      const qs = (await topQueries(bid, 28, 300)).filter(q => q.impr >= 20 && !q.q.includes(business.name.toLowerCase())).sort((a, b) => b.impr - a.impr).slice(0, 6);
      for (const q of qs) kwMap.set(q.q.toLowerCase(), { kw: q.q.toLowerCase(), intent: seeds.find(s => s.kw === q.q.toLowerCase())?.intent || (/best|vs|alternative|software|app|template|tool/.test(q.q) ? 'Commercial' : 'Informational'), vol: null, kd: null, src: 'gsc', priority: false });
    }
    for (const s of seeds) if (!kwMap.has(s.kw) && kwMap.size < 15) kwMap.set(s.kw, { kw: s.kw, intent: s.intent, vol: null, kd: null, src: 'site', priority: false });
    const est = await estimate([...kwMap.keys()], market, language);
    const list = [...kwMap.values()].map(k => ({ ...k, vol: est[k.kw]?.vol ?? null, kd: est[k.kw]?.kd ?? null }));

    const fresh: Profile = {
      domain,
      business: { name: business.name, description: business.description, offerings: business.offerings, industry: business.industry, positioning: business.positioning, differentiators: business.differentiators },
      audience: { segments: audience.segments, buyers: audience.buyers, needs: audience.needs, competitors: audience.competitors },
      keywords: { list },
      brand: { logo: det.logo, logoUploaded: false, primary, secondary, voice: voice.voice, language, markets: voice.markets },
    };
    // Re-read: the user may have edited during the run.
    const cur = (await db.select().from(schema.businesses).where(eq(schema.businesses.id, bid)).limit(1))[0]!;
    const edited = keepEdits ? (cur.edited || {}) : {};
    const merged = mergeAnalysis({ ...(cur.profile as Profile), domain }, fresh, edited, keepEdits);
    const logoMissing = !merged.brand.logo;
    await pace();
    results.brand = logoMissing ? 'Logo not found — you can upload one' : 'Logo, 2 colors, voice';
    await db.update(schema.businesses).set({
      profile: merged, edited,
      site: { ...(cur.site || {}), pages: pages.length, articles, ranking, analyzedAt: new Date().toISOString() },
    }).where(eq(schema.businesses.id, bid));
    await bump(bid);
    await emit({ phase: 'done', colors: [merged.brand.primary, merged.brand.secondary], logoMissing });
    if (merged.keywords.list.some(k => k.vol == null || k.kd == null)) {
      const { enqueue } = await import('../../jobs/queue');
      await enqueue('keywords.estimate', {}, { businessId: bid, singletonKey: 'kw-est:' + bid });
    }
    await refreshKeywordSuggestions(bid);
    return { pages: pages.length, articles, ranking, edits: Object.keys(edited).length };
  },
});
