// Article drafting (02-system.md §7): research first (web search + the user's own pages + Search Console), then stream
// the article with the writing model, map every statistic to a source, never invent statistics, then render the hero.
import { RadarError } from '@/server/errors';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../../db';
import { ai, profileContext } from '../../ai';
import { renderImage, defaultArticleImageStyle } from '../images';
import { normKw, topQueries } from '../gsc/metrics';
import { fmtN, slugify } from '@/lib/format';
import { blockText, defaultArticle, extractClaims, normNum, parseBlocks, splitStream, statNumbers } from '@/features/article/blocks';
import { tokens } from '../calendar/research';
import type { Article, Block, CalendarEntry, Profile, Source } from '@/lib/types';
import type { JobCtx } from '../../jobs/queue';
import './stubs';

const MARKS = /\s*\[\d{1,2}\]/g;
const ResearchOut = z.object({ sources: z.array(z.object({ title: z.string(), url: z.string(), use: z.string(), notes: z.array(z.string()) })) });
const MetaOut = z.object({ seoTitle: z.string(), meta: z.string(), alt: z.string() });
const DestatOut = z.object({ sentences: z.array(z.object({ i: z.number().int(), text: z.string() })) });

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
/** Cut at a word boundary to fit `max` characters. */
export function fit(s: string, max: number) { s = s.trim().replace(/\s+/g, ' '); if (s.length <= max) return s; const c = s.slice(0, max + 1).replace(/\s+\S*$/, '').replace(/[\s,;:—–-]+$/, ''); return c.length > 10 ? c : s.slice(0, max); }

/** The user's own pages most related to the topic (from the crawl). */
async function ownPages(bid: string, kw: string, title: string, refreshUrl: string | null) {
  const rows = await db.select().from(schema.crawlPages).where(eq(schema.crawlPages.businessId, bid));
  const t = new Set(tokens(kw + ' ' + title));
  const scored = rows.map(r => ({ r, s: tokens(`${r.title} ${r.h1} ${r.description}`).filter(x => t.has(x)).length + (refreshUrl && (r.path === refreshUrl || r.url.endsWith(refreshUrl)) ? 10 : 0) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3);
  return scored.map(({ r }) => {
    const sentences = r.text.split(/(?<=[.!?])\s+/).filter(s => s.length > 30 && s.length < 300 && tokens(s).some(x => t.has(x))).slice(0, 6);
    return { source: { title: r.title || r.path, url: r.url, use: r.kind === 'article' ? 'Your existing article, linked internally' : 'Your page, linked internally', notes: [r.description, ...sentences].filter(Boolean) } as Source, text: r.text, path: r.path };
  });
}

export async function research(bid: string, profile: Profile, e: CalendarEntry, a: Article, gsc: boolean): Promise<{ sources: Source[]; queries: string[]; refreshText: string | null }> {
  const competitors = profile.audience.competitors.map(c => c.toLowerCase());
  let web: Source[] = [];
  try {
    const out = await ai.run('research', {
      purpose: 'article.research', webSearch: true, schema: ResearchOut, schemaName: 'sources', maxTokens: 3000, temperature: 0,
      system: 'You are Radar’s research assistant. Find credible, current sources an article can cite. Quote facts exactly as the source states them. Never invent a source, a URL or a number.',
      prompt: `${profileContext(profile)}\n\nArticle: “${e.title}” (${e.type}). Primary keyword: “${e.kw}”. Angle: ${a.brief.angle}\nAudience: ${e.audience}\n\nFind 3–6 reputable sources (research, official guidance, respected publications). Exclude competitors (${profile.audience.competitors.join(', ') || 'none'}) and the business’s own site. For each source return: title, full URL, use (a few words: what the article uses it for), and notes: 2–6 short facts or statistics copied exactly as the source states them (keep numbers verbatim with their units).`,
      stubContext: { e, profile },
    }, { businessId: bid });
    const cited = new Set(out.citations.map(c => hostOf(c.url)).filter(Boolean));
    web = out.json!.sources
      .filter(s => /^https?:\/\//.test(s.url) && hostOf(s.url) && hostOf(s.url) !== profile.domain && !competitors.some(c => hostOf(s.url).includes(c.replace(/\s+/g, ''))))
      .filter(s => !cited.size || cited.has(hostOf(s.url))) // only URLs the search actually returned
      .slice(0, 6).map(s => ({ title: s.title.trim(), url: s.url.trim(), use: s.use.trim(), notes: s.notes.map(n => n.trim()).filter(Boolean).slice(0, 8) }));
  } catch (err: any) { console.error('[draft] research failed, continuing with own sources', err?.message); }
  const own = await ownPages(bid, e.kw, e.title, e.mode === 'refresh' ? e.url : null);
  const sources: Source[] = [...web, ...own.map(o => o.source)];
  let queries: string[] = [];
  if (gsc) {
    const kt = tokens(e.kw);
    const qs = (await topQueries(bid, 28, 3000)).filter(q => { const t = tokens(q.q); return t.filter(x => kt.includes(x)).length >= Math.min(2, kt.length); }).slice(0, 10);
    if (qs.length) {
      queries = qs.map(q => q.q);
      sources.push({ title: `Search Console — queries for “${e.kw}”`, url: 'Search Console', use: 'Questions searchers ask', notes: qs.map(q => `“${q.q}” — ${fmtN(q.impr)} impressions, position ${q.pos.toFixed(1)}`) });
    }
  }
  const refreshText = e.mode === 'refresh' ? (own.find(o => e.url && (o.path === e.url || o.source.url.endsWith(e.url)))?.text || null) : null;
  return { sources, queries, refreshText };
}

function draftPrompt(profile: Profile, e: CalendarEntry, a: Article, sources: Source[], queries: string[], refreshText: string | null) {
  const src = sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}\n    ${(s.notes || []).map(n => '• ' + n).join('\n    ') || '• (no notes)'}`).join('\n');
  return `${profileContext(profile)}

Write the article below for ${profile.business.name}'s blog.
Title: ${e.title}
Type: ${e.type}${e.mode === 'refresh' ? ` (a refresh of the existing page ${e.url}: keep what works, update and improve it)` : ''}
Primary keyword: ${e.kw}
Audience: ${e.audience}
Angle: ${a.brief.angle}
Outline (use these as the section headings, in order): ${a.brief.outline.length ? a.brief.outline.map(h => '\n- ' + h).join('') : '\n- (choose 3–5 clear sections)'}
Length: about ${a.brief.words} words.
${queries.length ? `Related questions searchers ask: ${queries.join('; ')}\n` : ''}${refreshText ? `\nCURRENT PAGE TEXT (for the refresh):\n${refreshText.slice(0, 5000)}\n` : ''}
SOURCES (cite by number):
${src || '(none)'}

FORMAT — plain text using only:
- paragraphs separated by a blank line
- "## " for section headings, "### " for sub-headings
- "- " for list items (one per line)
Do not repeat the title. Start with a short introduction paragraph.

RULES
- Write in the brand voice and in ${profile.brand.language}.
- Every statistic, percentage or figure must come from the source notes above, worded faithfully, with the source number in brackets right after the sentence, e.g. "… underbill every month [1]." Name the source in the sentence when it helps.
- NEVER invent statistics, numbers, studies, quotes, customers or results. If you have no source for a figure, make the point without a number.
- Mention ${profile.business.name} naturally at most twice and only where it genuinely helps the reader. Never promote competitors.
- Use the primary keyword in the introduction and in at least one heading, naturally.`;
}

export interface DraftPayload { entryId: string; source: 'user' | 'cron' | 'autopilot'; batchId?: string; batch?: string[] }

export async function draftArticle(ctx: JobCtx<DraftPayload>, e: CalendarEntry, a0: Article | null, profile: Profile, gsc: boolean, name: string): Promise<Article> {
  const bid = ctx.businessId!;
  const a: Article = { ...defaultArticle(e), ...(a0 || {}) } as Article;
  if (!a.brief.angle) a.brief.angle = e.relevance;
  await ctx.progress({ blocks: [], partial: '', stage: 'research' });
  const { sources, queries, refreshText } = await research(bid, profile, e, a, gsc);
  await ctx.progress({ blocks: [], partial: '', stage: 'writing' });

  // Stream the article.
  let text = '';
  const out = await ai.run('writing', {
    purpose: 'article.draft', maxTokens: Math.round(a.brief.words * 2.2) + 600, temperature: 0.6, timeoutMs: 240000,
    system: 'You are Radar, a senior writer producing a useful, accurate article for a small business’s blog. You follow the format and rules exactly.',
    prompt: draftPrompt(profile, e, a, sources, queries, refreshText),
    onDelta: d => { text += d; const s = splitStream(text.replace(MARKS, '')); ctx.progress({ ...s, stage: 'writing' }).catch(() => {}); },
    onReset: () => { if (text) { text = ''; ctx.progress({ stage: 'writing', blocks: [], partial: '' }).catch(() => {}); } },
    stubContext: { e, a, profile, sources },
  }, { businessId: bid });
  if (!text) text = out.text;

  let blocks = parseBlocks(text);
  if (blocks[0] && blocks[0][0] !== 'p' && normKw(blockText(blocks[0])) === normKw(e.title)) blocks = blocks.slice(1);
  const ex = extractClaims(blocks);
  let body = ex.body;
  // Never save an empty draft as "ready for review": fail so the job retries (or shows "couldn't draft").
  if (!body.length) throw new RadarError('Radar couldn’t write this draft. Try again.', 502, 'ai_failed');
  let claims = ex.claims.filter(c => c.source >= 0 && c.source < sources.length);

  // Never invent statistics: every number in the body must appear in the source notes (or the brief/profile).
  const allowedText = [...sources.flatMap(s => [s.title, ...(s.notes || [])]), a.brief.angle, ...a.brief.outline, e.title, e.kw, profileContext(profile)].join(' \n ');
  const allowed = new Set(statNumbers(allowedText).map(normNum));
  const bad = findUnsupported(body, allowed);
  if (bad.length) {
    let fixed: Record<number, string> = {};
    try {
      const r = await ai.run('writing', {
        purpose: 'article.destat', schema: DestatOut, schemaName: 'sentences', maxTokens: 1500, temperature: 0.2,
        system: 'You are Radar’s fact checker. Rewrite each sentence so it makes the same point WITHOUT any number, percentage or figure. Keep the voice. Return every sentence.',
        prompt: bad.map((b, i) => `${i}. ${b.sentence}`).join('\n'),
        stubContext: { bad },
      }, { businessId: bid });
      for (const s of r.json!.sentences) if (s.i >= 0 && s.i < bad.length) fixed[s.i] = s.text.trim();
    } catch { fixed = {}; }
    body = applyFixes(body, bad, fixed, allowed);
    claims = claims.filter(c => { const b = body[c.block]; return b && blockText(b).includes(c.text); });
  }

  // SEO + alt text.
  const keepSeo = a.generated || a.seo.meta || (a.seo.title && a.seo.title !== e.title);
  let seo = { ...a.seo };
  let alt = a.img.alt;
  if (!keepSeo || !alt) {
    try {
      const m = await ai.run('writing', {
        purpose: 'article.meta', schema: MetaOut, schemaName: 'meta', maxTokens: 500, temperature: 0.3,
        system: 'You are Radar, an SEO editor. Write a search title (max 60 characters, include the keyword), a meta description (max 155 characters, specific, no clickbait, no numbers that aren’t in the article) and image alt text (one plain sentence describing a hero image for the article).',
        prompt: `${profileContext(profile)}\n\nArticle title: ${e.title}\nKeyword: ${e.kw}\nImage style: ${a.img.style}; direction: ${a.img.prompt}\nIntro: ${blockText(body[0] || ['p', ''])}`,
        stubContext: { e, profile, style: a.img.style },
      }, { businessId: bid });
      const j = m.json!;
      if (!keepSeo) seo = { title: fit(j.seoTitle || e.title, 60), meta: fit(j.meta, 155), slug: a.seo.slug && a.seo.slug !== slugify(e.kw) ? a.seo.slug : slugify(e.kw) };
      if (!alt) alt = fit(j.alt, 200);
    } catch {
      if (!keepSeo) seo = { title: fit(e.title, 60), meta: '', slug: slugify(e.kw) };
    }
  }
  if (!seo.slug) seo.slug = slugify(e.kw);

  // Hero image (1200×628) in the article's style.
  const img = { ...a.img, alt };
  // Entries created before AI images were available kept the template default; upgrade it on the first real draft
  // unless the user picked a style themselves (the default direction text is untouched).
  if (img.style === 'branded' && !(a.body || []).length && /^Calm, editorial image about /.test(img.prompt || '') && defaultArticleImageStyle() === 'illustration') img.style = 'illustration';
  const key = `${img.style}:${img.seed}`;
  if (!img.url || img.urlKey !== key) {
    try { img.url = await renderImage({ bid, style: img.style, brand: profile.brand, headline: e.title, name, seed: img.seed, prompt: img.prompt, w: 1200, h: 628, kind: 'hero' }); img.urlKey = key; }
    catch (err: any) { console.error('[draft] image failed', err?.message); img.url = null; img.urlKey = null; }
  }
  return { ...a, generated: true, body, seo, img, sources, claims, draftedAt: new Date().toISOString() };
}

interface Bad { block: number; item: number | null; sentence: string }
function sentencesOf(t: string) { return t.split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/); }
function findUnsupported(body: Block[], allowed: Set<string>): Bad[] {
  const out: Bad[] = [];
  body.forEach((b, bi) => {
    const parts = b[0] === 'ul' ? (b[1] as string[]).map((t, i) => [t, i] as const) : [[b[1] as string, null] as const];
    for (const [t, item] of parts) for (const s of sentencesOf(t)) if (statNumbers(s).some(n => !allowed.has(normNum(n)))) out.push({ block: bi, item, sentence: s });
  });
  return out;
}
function applyFixes(body: Block[], bad: Bad[], fixed: Record<number, string>, allowed: Set<string>): Block[] {
  const next = body.map(b => (b[0] === 'ul' ? ['ul', [...(b[1] as string[])]] : [b[0], b[1]]) as Block);
  bad.forEach((x, i) => {
    let rep = fixed[i] ?? '';
    if (rep && statNumbers(rep).some(n => !allowed.has(normNum(n)))) rep = ''; // still unsupported → drop the sentence
    const b = next[x.block];
    if (b[0] === 'ul') { const arr = b[1] as string[]; arr[x.item!] = arr[x.item!].replace(x.sentence, rep).trim(); }
    else (b as any)[1] = (b[1] as string).replace(x.sentence, rep).replace(/\s{2,}/g, ' ').trim();
  });
  return next.map(b => (b[0] === 'ul' ? ['ul', (b[1] as string[]).filter(Boolean)] as Block : b)).filter(b => (Array.isArray(b[1]) ? b[1].length : b[1]));
}

export async function entriesStatus(ids: string[]) {
  if (!ids.length) return [];
  return db.select({ id: schema.calendarEntries.id, status: schema.calendarEntries.status, title: schema.calendarEntries.title }).from(schema.calendarEntries).where(inArray(schema.calendarEntries.id, ids));
}
export { and, eq };
