// "Add to calendar for review" (02-system.md §10): a refresh entry in `review` status 2 days out, with the diff pre-applied
// to a generated draft (seo title/meta from the diff; body = existing page with the edited and added sections), written by the LLM.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { bizToday, getBiz } from '../../workspace';
import { ai } from '../../ai';
import { registerStub } from '../../ai/adapters/stub';
import { RadarError, notFound } from '../../errors';
import { shortId } from '../../crypto';
import { addDays, slugify } from '@/lib/format';
import type { Article, Block, Profile } from '@/lib/types';
import { normKw } from './metrics';
import type { SuggestionData } from './suggestions';

const DraftOut = z.object({
  angle: z.string(), outline: z.array(z.string()),
  blocks: z.array(z.object({ type: z.enum(['p', 'h2', 'h3', 'ul']), text: z.string().nullable().optional(), items: z.array(z.string()).nullable().optional() })),
});

export async function acceptSuggestion(bid: string, id: string): Promise<{ entryId: string; date: string }> {
  const row = (await db.select().from(schema.suggestions).where(and(eq(schema.suggestions.id, id), eq(schema.suggestions.businessId, bid))).limit(1))[0];
  if (!row) throw notFound('That suggestion');
  const s = row.data as SuggestionData;
  if (row.state === 'calendar' && s.entryId) {
    const e = (await db.select({ date: schema.calendarEntries.date }).from(schema.calendarEntries).where(eq(schema.calendarEntries.id, s.entryId)).limit(1))[0];
    if (e) return { entryId: s.entryId, date: String(e.date) };
  }
  const biz = await getBiz(bid); const profile = { ...(biz.profile as Profile), domain: biz.domain };
  const crawl = (await db.select().from(schema.crawlPages).where(and(eq(schema.crawlPages.businessId, bid), eq(schema.crawlPages.path, s.page))).limit(1))[0] || null;
  const date = addDays(bizToday(biz), 2);
  const title = s.diff.title ? s.diff.title[1] : s.title.replace(/^Refresh “|”$/g, '').replace(/^(Rewrite the title on|Add an FAQ to) “|”$/g, '');
  const kwl = profile.keywords?.list || [];
  const topQ = s.queries?.find(q => q.pos > 3) || s.queries?.[0];
  const kw = kwl.find(k => s.queries?.some(q => normKw(q.q) === normKw(k.kw)))?.kw || topQ?.q || title.toLowerCase();
  const kwDef = kwl.find(k => normKw(k.kw) === normKw(kw));

  const changes = [s.diff.title && `SEO title: "${s.diff.title[0]}" → "${s.diff.title[1]}"`, s.diff.meta && `Meta description → "${s.diff.meta[1]}"`, ...s.diff.blocks.map(([k, h, d]) => `${k === 'add' ? 'ADD section' : 'EDIT section'} "${h}": ${d}`)].filter(Boolean).join('\n');
  const r = await ai.run('writing', {
    purpose: 'suggestions.refreshDraft', schema: DraftOut, schemaName: 'refreshed_article', maxTokens: 6000,
    stubContext: { crawl, diff: s.diff, title, kw, profile },
    system: `You refresh an existing article for ${profile.business.name}. Keep everything that is still accurate, apply exactly the requested edits, and add the requested sections. Never invent statistics, prices, dates or customer claims. Never recommend the competitors listed in the profile. Write in the brand voice and in ${profile.brand.language}.`,
    prompt: `${ai.profileContext(profile)}\n\nPage: ${s.url}\nCurrent title: ${crawl?.title || title}\nCurrent text:\n${(crawl?.text || '(not available — write the sections from the changes below)').slice(0, 9000)}\n\nSearch queries that bring people to this page (Search Console, last 28 days): ${(s.queries || []).slice(0, 8).map(q => `"${q.q}"`).join(', ') || 'none'}\n\nChanges to make:\n${changes}\n\nReturn the full refreshed article as blocks (h2/h3 headings, paragraphs, bullet lists). Do not include the page title as a block. Also return a one-sentence angle and the outline (the h2 headings).`,
  }, { businessId: bid });
  const body: Block[] = (r.json!.blocks || []).map(b => (b.type === 'ul' ? ['ul', (b.items || []).filter(Boolean)] : [b.type, (b.text || '').trim()]) as Block).filter(b => (b[0] === 'ul' ? (b[1] as string[]).length : (b[1] as string).length));
  if (!body.length) throw new RadarError('Radar couldn’t finish this. Try again.', 502, 'ai_failed');
  const words = body.reduce((n, b) => n + (b[0] === 'ul' ? (b[1] as string[]).join(' ') : (b[1] as string)).split(/\s+/).length, 0);
  const entryId = shortId('r');
  const article: Article = {
    entryId, generated: true, body,
    brief: { angle: r.json!.angle, outline: r.json!.outline, words: words > 1800 ? 2200 : words > 1100 ? 1400 : 900 },
    seo: { title: s.diff.title ? s.diff.title[1] : crawl?.title || title, meta: s.diff.meta ? s.diff.meta[1] : crawl?.description || '', slug: s.page.split('/').filter(Boolean).pop() || slugify(kw) },
    img: { style: 'branded', seed: Math.floor(Math.random() * 1e6), prompt: title, alt: title, url: null },
    videos: [], videoMeta: [], sources: crawl ? [{ title: crawl.title || s.page, url: crawl.url, use: 'The published article this refresh updates' }] : [], claims: [],
    draftedAt: new Date().toISOString(),
  };
  await db.transaction(async tx => {
    await tx.insert(schema.calendarEntries).values({
      id: entryId, businessId: bid, title, kw, type: 'Guide', vol: kwDef?.vol ?? null, kd: kwDef?.kd ?? null, date, mode: 'refresh', url: s.page,
      measured: s.measured, audience: 'Searchers already finding this page', relevance: s.why, status: 'review',
    });
    await tx.insert(schema.articles).values({ entryId, businessId: bid, data: article });
    await tx.update(schema.suggestions).set({ state: 'calendar', data: { ...s, entryId } }).where(eq(schema.suggestions.id, id));
  });
  return { entryId, date };
}

export async function dismissSuggestion(bid: string, id: string) {
  const r = await db.update(schema.suggestions).set({ state: 'dismissed' }).where(and(eq(schema.suggestions.id, id), eq(schema.suggestions.businessId, bid), eq(schema.suggestions.state, 'open'))).returning({ id: schema.suggestions.id });
  return { ok: r.length > 0 };
}

/* ── dev stub: rebuild the page from its crawl text plus the requested sections ── */
registerStub('suggestions.refreshDraft', (_i, ctx) => {
  const paras: string[] = String(ctx?.crawl?.text || '').split(/\n{2,}/).map((x: string) => x.trim()).filter(Boolean).slice(1);
  const blocks: any[] = [];
  paras.forEach((p: string, i: number) => blocks.push(p.length < 60 && !/[.!?]$/.test(p) ? { type: 'h2', text: p } : { type: 'p', text: i === 0 ? p : p }));
  for (const [k, h, d] of ctx?.diff?.blocks || []) {
    if (k === 'edit') { const at = blocks.findIndex(b => b.type === 'h2' && b.text.toLowerCase() === String(h).toLowerCase()); const add = { type: 'p', text: `${d} In short: keep the record next to the work, review it weekly, and agree changes in writing before they happen.` }; if (at >= 0) blocks.splice(at + 1, 0, add); else blocks.unshift(add); continue; }
    blocks.push({ type: 'h2', text: h });
    if (/faq/i.test(h)) { const qs = [...String(d).matchAll(/“([^”]+)”/g)].map(m => m[1]); for (const q of qs.length ? qs : [`What is ${ctx.kw}?`]) { blocks.push({ type: 'h3', text: q.charAt(0).toUpperCase() + q.slice(1) + (q.endsWith('?') ? '' : '?') }); blocks.push({ type: 'p', text: `A short, direct answer to “${q}” for ${String(ctx?.profile?.audience?.segments?.[0] || 'readers').toLowerCase()}, with the one step to take next.` }); } }
    else { blocks.push({ type: 'p', text: `${d}` }); blocks.push({ type: 'ul', items: ['Write down what was agreed', 'Check progress against it every week', 'Confirm any change in writing before starting it'] }); }
  }
  if (!blocks.length) blocks.push({ type: 'p', text: `${ctx?.title}.` });
  return { angle: `A refreshed, more complete answer to “${ctx?.kw}” for people already finding this page.`, outline: blocks.filter(b => b.type === 'h2').map(b => b.text), blocks };
});
