// LLM extraction for the Business Profile (02-system.md §3: biz, aud, brand voice/language/markets, keyword seeds).
// Writing model, zod-validated JSON. Dev stubs return realistic data for the synthesized dev site.
import { z } from 'zod';
import { ai } from '../../ai';
import { registerStub } from '../../ai/adapters/stub';
import { devProfileFor } from './devsite';
import { kwIntentHeuristic, langs } from '@/lib/constants';
import type { CrawledPage } from './crawl';

export const BusinessSchema = z.object({
  name: z.string().min(1).max(80),
  industry: z.string().max(80),
  description: z.string().max(300),
  positioning: z.string().max(300),
  offerings: z.array(z.string().max(80)).max(8),
  differentiators: z.array(z.string().max(120)).max(6),
});
export const AudienceSchema = z.object({
  segments: z.array(z.string().max(80)).max(6),
  buyers: z.array(z.string().max(60)).max(4),
  needs: z.array(z.string().max(120)).max(6),
  competitors: z.array(z.string().max(60)).max(6),
});
export const VoiceSchema = z.object({
  voice: z.string().max(300),
  language: z.string().max(40),
  markets: z.array(z.string().max(40)).min(1).max(6),
});
export const KeywordSeedSchema = z.object({ keywords: z.array(z.object({ kw: z.string().max(80), intent: z.enum(['Commercial', 'Informational']) })).max(20) });
export const ClassifySchema = z.object({ articles: z.array(z.string()) });

const SYSTEM = 'You are Radar, analyzing a small business’s website to build its Business Profile. Use only facts supported by the website content provided (and web search where allowed). Be concrete and concise. Write in plain English. Never invent customers, numbers or awards.';

/** Compact digest of the most informative pages for the LLM. */
export function siteDigest(pages: CrawledPage[], max = 18000): string {
  const score = (p: CrawledPage) => (p.path === '/' ? 100 : 0) + (/about|pricing|product|features?|services?|solutions?|customers?|why|how-it-works/.test(p.path) ? 40 : 0) - p.path.split('/').length * 3 - (p.kind === 'article' ? 25 : 0);
  const ordered = [...pages].sort((a, b) => score(b) - score(a));
  let out = ''; for (const p of ordered) {
    const chunk = `\n\n## ${p.url}\nTitle: ${p.title}\nH1: ${p.h1}\nDescription: ${p.description}\n${p.text.slice(0, 1400)}`;
    if (out.length + chunk.length > max) break; out += chunk;
  }
  const articles = pages.filter(p => p.kind === 'article').slice(0, 40).map(p => `- ${p.h1 || p.title}`).join('\n');
  return out + (articles ? `\n\n## Article titles on the site\n${articles}` : '');
}

export async function extractBusiness(bid: string, domain: string, digest: string) {
  const r = await ai.run('writing', { purpose: 'analysis.business', system: SYSTEM, schema: BusinessSchema, schemaName: 'business', stubContext: { domain },
    prompt: `Website: ${domain}\n\nExtract the business:\n- name: the brand name as customers know it\n- industry: "Category · Subcategory", e.g. "B2B software · Productivity"\n- description: one sentence on what it offers and to whom\n- positioning: one sentence on its place in the market\n- offerings: 2–6 products or services\n- differentiators: 2–4 concrete reasons to choose it\n\nWEBSITE CONTENT${digest}` }, { businessId: bid });
  return r.json!;
}

export async function extractAudience(bid: string, domain: string, business: z.infer<typeof BusinessSchema>, digest: string) {
  const r = await ai.run('writing', { purpose: 'analysis.audience', system: SYSTEM, schema: AudienceSchema, schemaName: 'audience', webSearch: true, stubContext: { domain },
    prompt: `Business: ${business.name} (${domain}) — ${business.description}\n\nExtract the audience:\n- segments: 2–4 customer segments\n- buyers: 1–3 roles that make the purchase decision\n- needs: 2–4 needs the business meets, phrased from the customer’s side\n- competitors: up to 5 direct competitors by brand name (from the site and from searching the web for alternatives). Only real companies.\n\nWEBSITE CONTENT${digest}` }, { businessId: bid });
  return r.json!;
}

export async function extractVoice(bid: string, domain: string, digest: string, htmlLang: string | null) {
  const L = langs();
  const r = await ai.run('writing', { purpose: 'analysis.brand', system: SYSTEM, schema: VoiceSchema, schemaName: 'brand', stubContext: { domain },
    prompt: `Website: ${domain}${htmlLang ? ` (html lang="${htmlLang}")` : ''}\n\nDescribe the brand:\n- voice: 1–2 sentences summarizing the tone of the writing\n- language: the site’s main language, one of: ${L.slice(0, 12).join(', ')}, or another language name\n- markets: the countries it sells to (full country names, e.g. "United States"), based on currencies, addresses, shipping and spelling\n\nWEBSITE CONTENT${digest.slice(0, 9000)}` }, { businessId: bid });
  return r.json!;
}

export async function seedKeywords(bid: string, domain: string, business: z.infer<typeof BusinessSchema>, audience: z.infer<typeof AudienceSchema>, digest: string) {
  const r = await ai.run('writing', { purpose: 'analysis.keywords', system: SYSTEM, schema: KeywordSeedSchema, schemaName: 'keywords', stubContext: { domain },
    prompt: `Business: ${business.name} — ${business.description}\nOfferings: ${business.offerings.join('; ')}\nAudience: ${audience.segments.join('; ')}\nNeeds: ${audience.needs.join('; ')}\n\nList 10–14 search keywords this business should target, drawn from the topics its website already covers (pages and articles below). Lowercase, 2–5 words, phrased the way customers search. Mix buying-intent (Commercial) and learning (Informational) queries. No brand names of competitors unless as "<competitor> alternative".\n\nWEBSITE CONTENT${digest.slice(0, 12000)}` }, { businessId: bid });
  return r.json!.keywords.map(k => ({ kw: k.kw.trim().toLowerCase(), intent: k.intent })).filter(k => k.kw);
}

export async function classifyAmbiguous(bid: string, pages: CrawledPage[]): Promise<Set<string>> {
  const amb = pages.filter(p => !p.kindSure).slice(0, 40);
  if (!amb.length) return new Set();
  try {
    const r = await ai.run('writing', { purpose: 'analysis.classify', schema: ClassifySchema, schemaName: 'classification', stubContext: { urls: amb.map(p => p.url) },
      prompt: `Which of these URLs are blog posts or articles (editorial content with a single topic), rather than product, marketing, legal or listing pages? Return only the article URLs.\n\n${amb.map(p => `${p.url} — ${p.title} — ${p.text.slice(0, 160)}`).join('\n')}` }, { businessId: bid, retries: 1 });
    return new Set(r.json!.articles);
  } catch { return new Set(); }
}

/* ── Dev stubs (RADAR_DEV_STUBS=1) ── */
registerStub('analysis.business', (_i, c) => devProfileFor(c.domain).business);
registerStub('analysis.audience', (_i, c) => devProfileFor(c.domain).audience);
registerStub('analysis.brand', (_i, c) => { const p = devProfileFor(c.domain); return { voice: p.brand.voice, language: p.brand.language, markets: p.brand.markets }; });
registerStub('analysis.keywords', (_i, c) => ({ keywords: devProfileFor(c.domain).keywords }));
registerStub('analysis.classify', (_i, c) => ({ articles: (c.urls as string[]).filter(u => /\/(blog|journal)\//.test(u)) }));
export { kwIntentHeuristic };
