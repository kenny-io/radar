// DEV-ONLY Search Console stub (RADAR_DEV_STUBS=1 with no Google OAuth client). Never used in production.
// Synthesizes properties from the domain and realistic, deterministic daily/query/page rows from the profile keywords and crawl pages:
// believable 16-month growth, weekday seasonality, some pages at positions 8–20 and some low-CTR page-one queries.
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { addDays, slugify } from '@/lib/format';
import type { Profile } from '@/lib/types';
import type { SaRow } from './client';

export const stubSites = (domain: string) => [`sc-domain:${domain}`, `https://blog.${domain}/`, 'https://lumen.studio/'];

/* deterministic RNG */
function hash(s: string) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
function rng(seed: string) { let a = hash(seed); return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Typical organic CTR by position (used only to synthesize believable clicks). */
function curve(pos: number) {
  const C = [0.3, 0.16, 0.105, 0.075, 0.056, 0.043, 0.034, 0.027, 0.022, 0.019];
  if (pos <= 1) return C[0];
  if (pos <= 10) { const i = Math.floor(pos) - 1; const f = pos - Math.floor(pos); return C[i] + (C[Math.min(9, i + 1)] - C[i]) * f; }
  return Math.max(0.002, 0.016 * (14 / (pos + 4)));
}

function articleTitle(kw: string, i: number) {
  if (/template/.test(kw)) return `Free ${kw} (with examples)`;
  if (/^(track|raise|how|write|price|set)\b/.test(kw)) return `How to ${kw} without the busywork`;
  return [`${cap(kw)}: a field guide`, `A practical guide to ${kw}`, `${cap(kw)}, explained`, `Why ${kw} matters`][i % 4];
}

/** Make sure the business has crawl pages to attach Search Console rows to (dev stub only — the real crawl comes from site analysis). */
export async function ensureStubCrawl(bid: string, p: Profile) {
  const have = await db.select({ id: schema.crawlPages.id }).from(schema.crawlPages).where(eq(schema.crawlPages.businessId, bid)).limit(1);
  if (have.length) return;
  const base = `https://${p.domain}`; const name = p.business.name || p.domain;
  const kws = (p.keywords?.list || []).map(k => k.kw);
  const offer = p.business.offerings || [];
  const seg = (p.audience?.segments?.[0] || 'small teams').toLowerCase();
  const arts = kws.map((kw, i) => ({ path: `/blog/${slugify(kw)}`, kw, title: articleTitle(kw, i) }));
  const rows: (typeof schema.crawlPages.$inferInsert)[] = [
    { businessId: bid, url: base + '/', path: '/', kind: 'page', title: `${name} — ${p.business.description || ''}`.replace(/ — $/, ''), h1: p.business.positioning || name, description: p.business.description || '', text: [p.business.description, p.business.positioning, ...offer.map(o => `${o}.`), ...(p.business.differentiators || [])].filter(Boolean).join('\n\n'), links: ['/pricing', '/features', ...arts.slice(0, 3).map(a => a.path)] },
    { businessId: bid, url: base + '/pricing', path: '/pricing', kind: 'page', title: 'Pricing', h1: 'Simple, flat pricing', description: `${name} pricing. ${(p.business.differentiators || []).find(d => /pric/i.test(d)) || 'One plan for the whole team.'}`, text: `Pricing\n\nOne plan for the whole team. ${offer.join(', ')}. Start a free trial.`, links: ['/', '/features'] },
    { businessId: bid, url: base + '/features', path: '/features', kind: 'page', title: 'Features', h1: `Everything ${seg} need`, description: offer.join(' · '), text: offer.map(o => `${o}\n\n${o} built for ${seg}.`).join('\n\n'), links: ['/', '/pricing'] },
    ...arts.map((a, i) => ({
      businessId: bid, url: base + a.path, path: a.path, kind: 'article' as const, title: a.title, h1: a.title,
      description: i % 3 === 1 ? `Our thoughts on ${a.kw}.` : `What ${a.kw} looks like for ${seg}, with practical steps you can use this week.`,
      text: [`${a.title}`, `If you work as one of the ${seg}, ${a.kw} is probably something you think about every week. This guide covers what it is, why it matters and a simple way to handle it.`,
        `What ${a.kw} means in practice`, `Most people start with a spreadsheet. That works until projects overlap and the details get lost.`,
        `A simple process`, `Write down what was agreed, review it weekly, and keep the record next to the work so nothing has to be reconstructed later.`,
        offer[i % Math.max(1, offer.length)] ? `${name} helps with this through ${offer[i % offer.length].toLowerCase()}.` : ''].filter(Boolean).join('\n\n'),
      // Only the first article links to /pricing — the rest link home and to the next article.
      links: ['/', ...(i === 0 ? ['/pricing'] : []), arts[(i + 1) % arts.length].path],
    })),
  ];
  for (const r of rows) await db.insert(schema.crawlPages).values(r).onConflictDoNothing();
}

interface SynQ { q: string; page: string; impr: number; pos: number; ctrMul: number }

/** The synthetic query → page model for a business. */
export async function stubModel(bid: string, p: Profile, property: string) {
  const pages = await db.select().from(schema.crawlPages).where(eq(schema.crawlPages.businessId, bid));
  let origin = `https://${p.domain}`;
  if (!property.startsWith('sc-domain:')) { try { origin = new URL(property).origin; } catch { /* */ } }
  const urlOf = (path: string) => origin + path;
  const arts = pages.filter(x => x.kind === 'article');
  const kwl = p.keywords?.list || [];
  const POS = [3.2, 9.4, 12.8, 6.1, 11.6, 14.2, 4.8, 17.5, 8.6, 13.1];
  const QV = [(k: string) => `how to ${k.replace(/^how to /, '')}`, (k: string) => `what is ${k}`, (k: string) => `${k} examples`, (k: string) => `best ${k} app`, (k: string) => `is ${k} worth it`, (k: string) => `${k} for small teams`, (k: string) => `${k} checklist`];
  const qs: SynQ[] = [];
  const name = (p.business.name || p.domain.split('.')[0]).toLowerCase();
  qs.push({ q: name, page: urlOf('/'), impr: 48, pos: 1.1, ctrMul: 2.1 }, { q: `${name} pricing`, page: urlOf('/pricing'), impr: 9, pos: 1.3, ctrMul: 1.9 }, { q: `${name} login`, page: urlOf('/'), impr: 14, pos: 1.0, ctrMul: 2.4 });
  kwl.forEach((k, i) => {
    const r = rng(bid + k.kw);
    const art = arts.find(a => a.path === `/blog/${slugify(k.kw)}`) || arts[i % Math.max(1, arts.length)];
    const page = urlOf(art ? art.path : '/');
    const pos = POS[i % POS.length];
    const vol = k.vol ?? 800;
    const impr = Math.max(6, (vol / 30) * (pos <= 10 ? 1.3 : 0.9));
    qs.push({ q: k.kw, page, impr, pos, ctrMul: i === 3 || (kwl.length < 4 && i === 0) ? 0.42 : 1 });
    const picks = [0, 1, 2, 3, 4, 5, 6].sort(() => r() - 0.5).slice(0, 3);
    for (const j of picks) qs.push({ q: QV[j](k.kw), page, impr: impr * (0.12 + r() * 0.22), pos: Math.min(38, pos + 1.5 + r() * 6), ctrMul: 0.9 + r() * 0.3 });
  });
  (p.audience?.competitors || []).slice(0, 3).forEach((c, i) => qs.push({ q: `${c.toLowerCase()} alternative`, page: urlOf(pages.find(x => x.path === '/features') ? '/features' : '/'), impr: 22 - i * 5, pos: 7.4 + i * 3.6, ctrMul: 1 }));
  return { qs, pageUrls: [...new Set(qs.map(q => q.page))] };
}

/** Synthetic rows for [from, to] (inclusive) — same shape as searchanalytics.query. */
export function stubRows(bid: string, model: Awaited<ReturnType<typeof stubModel>>, from: string, to: string, anchorEnd: string) {
  const span = 486; const W = [0.62, 1, 1.08, 1.05, 1, 0.86, 0.58];
  const date: SaRow[] = [], query: SaRow[] = [], page: SaRow[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const age = Math.max(0, Math.round((new Date(anchorEnd + 'T12:00').getTime() - new Date(d + 'T12:00').getTime()) / 864e5));
    const t = Math.max(0, 1 - age / span);
    const growth = 0.42 + 0.58 * Math.pow(t, 1.25) + 0.04 * Math.sin(age / 9);
    const wk = W[new Date(d + 'T12:00').getDay()];
    let dc = 0, di = 0, dp = 0; const pg = new Map<string, { c: number; i: number; p: number }>();
    for (const q of model.qs) {
      const r = rng(`${bid}|${d}|${q.q}`);
      const impr = Math.round(q.impr * growth * wk * (0.82 + r() * 0.36));
      if (impr <= 0) continue;
      const pos = Math.max(1, q.pos + (1 - t) * 3.4 + (r() - 0.5) * 1.1);
      const clicks = Math.max(0, Math.round(impr * Math.min(0.95, curve(pos) * q.ctrMul) * (0.75 + r() * 0.5)));
      query.push({ keys: [q.q, d], clicks, impressions: impr, ctr: clicks / impr, position: +pos.toFixed(2) });
      dc += clicks; di += impr; dp += pos * impr;
      const e = pg.get(q.page) || { c: 0, i: 0, p: 0 }; e.c += clicks; e.i += impr; e.p += pos * impr; pg.set(q.page, e);
    }
    if (!di) continue;
    // Anonymized queries: the date and page dimensions include traffic the query dimension doesn't show.
    const ci = Math.round(di * 1.22), cc = Math.round(dc * 1.07);
    date.push({ keys: [d], clicks: cc, impressions: ci, ctr: cc / ci, position: +(dp / di + 0.7).toFixed(2) });
    for (const [u, e] of pg) { const i = Math.round(e.i * 1.12), c = Math.round(e.c * 1.05); page.push({ keys: [u, d], clicks: c, impressions: i, ctr: c / i, position: +(e.p / e.i + 0.3).toFixed(2) }); }
  }
  return { date, query, page };
}

/** query+page aggregate over [from, to] (no date dimension). */
export function stubQueryPage(bid: string, model: Awaited<ReturnType<typeof stubModel>>, from: string, to: string, anchorEnd: string): SaRow[] {
  const { query } = stubRows(bid, model, from, to, anchorEnd);
  const pageOf = new Map(model.qs.map(q => [q.q, q.page]));
  const agg = new Map<string, { c: number; i: number; p: number; page: string; q: string }>();
  for (const r of query) { const q = r.keys[0]; const k = pageOf.get(q)! + '\t' + q; const e = agg.get(k) || { c: 0, i: 0, p: 0, page: pageOf.get(q)!, q }; e.c += r.clicks; e.i += r.impressions; e.p += r.position * r.impressions; agg.set(k, e); }
  return [...agg.values()].map(e => ({ keys: [e.q, e.page], clicks: e.c, impressions: e.i, ctr: e.i ? e.c / e.i : 0, position: e.i ? e.p / e.i : 0 }));
}
