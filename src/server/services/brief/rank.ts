// Rank step (02-system §9.2): the research model scores each candidate against a JSON schema; Radar combines it with
// measured recency and engagement. Hostile, off-topic, competitor-owned and rule-violating threads are rejected.
import { z } from 'zod';
import { ai, profileContext } from '@/server/ai';
import { BPLAT, PORDER } from '@/lib/constants';
import type { BriefPlatform, Profile } from '@/lib/types';
import { clip, relevance, type Candidate, type Plan } from './plan';

export const REJECT = ['none', 'hostile', 'off-topic', 'competitor-owned', 'rule-violation', 'promotional'] as const;
export const INTENT = ['asks-for-tool', 'asks-for-help', 'discussion', 'other'] as const;
export const RankSchema = z.object({ results: z.array(z.object({
  id: z.string(),
  fit: z.number().min(0).max(1),
  canHelp: z.number().min(0).max(1),
  intent: z.enum(INTENT),
  asks: z.boolean(),
  reject: z.enum(REJECT),
  replyTo: z.number().int().nullable(),
  theme: z.string(),
  brand: z.boolean(),
})) });
export type RankRow = z.infer<typeof RankSchema>['results'][number];

export interface Scored extends Candidate {
  fit: number; canHelp: number; intent: RankRow['intent']; asks: boolean; reject: RankRow['reject'];
  replyToIdx: number | null; theme: string; score: number;
  /** The official company account could reply credibly (a direct tool request, or an industry claim it can speak to). */
  brand: boolean;
}

export const MIN_SCORE = 0.45;
const INTENT_W: Record<RankRow['intent'], number> = { 'asks-for-tool': 1, 'asks-for-help': 0.85, discussion: 0.5, other: 0.2 };

export function recencyOf(c: Candidate, now = Date.now()) {
  if (!c.postedAt) return 0.4;
  const h = Math.max(0, (now - Date.parse(c.postedAt)) / 3600e3);
  return Math.exp(-h / 24);
}
export const engagementOf = (c: Candidate) => Math.min(1, Math.log10(1 + c.engN) / 2.5);

export function scoreOf(c: Candidate, r: Pick<RankRow, 'fit' | 'canHelp' | 'intent'>) {
  return +(0.32 * r.fit + 0.25 * r.canHelp + 0.15 * INTENT_W[r.intent] + 0.16 * recencyOf(c) + 0.12 * engagementOf(c)).toFixed(4);
}

export function describeCandidate(c: Candidate, now = Date.now()) {
  const h = c.postedAt ? Math.round((now - Date.parse(c.postedAt)) / 3600e3) : null;
  const head = `[${c.id}] ${BPLAT[c.plat]} · ${c.where}${h != null ? ` · ${h}h ago` : ''}${c.eng ? ' · ' + c.eng : ''}${c.promoBanned ? ' · community forbids self-promotion' : ''}`;
  const cm = (c.comments || []).map((x, i) => `  comment [${i}] ${x.who}: ${clip(x.text, 300)}`).join('\n');
  return [head, `Title: ${c.title}`, c.body ? `Body: ${clip(c.body, 500)}` : '', cm ? `Comments:\n${cm}` : ''].filter(Boolean).join('\n');
}

const SYSTEM = (p: Profile) => `You are Radar's research agent. Each morning you find public conversations where ${p.business.name} can genuinely help, so a person from the team can join them as a helpful peer (never as a marketer).

For every candidate thread, score:
- fit (0–1): does it match the audience and their needs?
- canHelp (0–1): could someone from ${p.business.name} add a genuinely useful answer, without selling?
- intent: "asks-for-tool" if they explicitly ask for a tool, product or recommendation; "asks-for-help" if they ask how to solve a problem; "discussion" for opinions/debate; "other" otherwise.
- asks: true only when the thread (or the chosen comment) explicitly asks for a tool or recommendation.
- reject: "hostile" (angry, a pile-on, harassment), "off-topic", "competitor-owned" (posted by or for a competitor), "rule-violation" (joining would break the community's rules, e.g. promotion threads), "promotional" (an ad or launch), else "none".
- replyTo: the index of the comment that is the best place to reply (when the useful conversation is in a comment), else null.
- theme: a 3–6 word lowercase topic label (e.g. "tracking time without timers"). Use the same label for threads about the same topic.
- brand: true only when a reply from the official ${p.business.name} company account would be welcome and credible: the thread directly asks for a tool or recommendation that ${p.business.name} answers, or it makes an industry claim or stat that ${p.business.name}'s own product knowledge speaks to. False for personal stories, venting, opinion threads, and anything where a brand reply would feel like an ad.

${profileContext(p)}`;

/** Score candidates (batched). Pre-filters to the most relevant ~30 per platform to keep ranking focused. */
export async function rankCandidates(p: Profile, plan: Plan, cands: Candidate[], bid: string): Promise<Scored[]> {
  const byPlat = new Map<BriefPlatform, Candidate[]>();
  for (const c of cands) { const a = byPlat.get(c.plat) || []; a.push(c); byPlat.set(c.plat, a); }
  const pool: Candidate[] = [];
  for (const k of PORDER) {
    const a = (byPlat.get(k) || []).map(c => ({ c, r: relevance(`${c.title} ${c.body} ${(c.comments || []).map(x => x.text).join(' ')}`, plan) }));
    pool.push(...a.filter(x => x.r > 0 || plan.alt.some(q => (x.c.title + x.c.body).toLowerCase().includes(q.toLowerCase().replace('alternative to ', '')))).sort((x, y) => y.r - x.r).slice(0, 30).map(x => x.c));
  }
  const chunks: Candidate[][] = [];
  for (let i = 0; i < pool.length; i += 25) chunks.push(pool.slice(i, i + 25));
  const rows: RankRow[] = [];
  for (let i = 0; i < chunks.length; i += 3) {
    const outs = await Promise.all(chunks.slice(i, i + 3).map(ch => ai.run('research', {
      purpose: 'brief.rank', system: SYSTEM(p), schema: RankSchema, schemaName: 'ranking', maxTokens: 4000,
      prompt: `Score each of these ${ch.length} candidate threads. Return one result per id.\n\n${ch.map(c => describeCandidate(c)).join('\n\n')}`,
      stubContext: { profile: p, plan, cands: ch },
    }, { businessId: bid })));
    for (const o of outs) rows.push(...(o.json?.results || []));
  }
  const byId = new Map(rows.map(r => [r.id, r]));
  const lower = (s: string) => s.toLowerCase();
  const out: Scored[] = [];
  for (const c of pool) {
    const r = byId.get(c.id); if (!r) continue;
    let reject = r.reject;
    // Deterministic guards on top of the model: competitor-owned and our own posts are never joined.
    if (reject === 'none' && plan.competitors.some(x => x && (lower(c.who).includes(lower(x)) || lower(c.where).includes(lower(x))))) reject = 'competitor-owned';
    if (reject === 'none' && plan.name && (lower(c.who).includes(lower(plan.name)) || lower(c.where).startsWith(lower(plan.name)))) reject = 'promotional';
    const replyToIdx = r.replyTo != null && c.comments && c.comments[r.replyTo] ? r.replyTo : null;
    out.push({ ...c, fit: r.fit, canHelp: r.canHelp, intent: r.intent, asks: !!r.asks, reject, replyToIdx, theme: (r.theme || '').toLowerCase().trim(), score: scoreOf(c, r), brand: !!r.brand });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Select at most `cap[plat]` replies per enabled platform, by score (02-system §9.3). `skip` = threads already taken. */
export function selectReplies(scored: Scored[], plats: BriefPlatform[], cap: Partial<Record<BriefPlatform, number>>, opts: { brand?: boolean; skip?: Set<string> } = {}): Scored[] {
  const out: Scored[] = [];
  for (const k of PORDER.filter(x => plats.includes(x))) {
    const n = Math.max(0, cap[k] ?? 2);
    out.push(...scored.filter(s => s.plat === k && s.reject === 'none' && s.score >= MIN_SCORE && (!opts.brand || s.brand) && !opts.skip?.has(s.id)).sort((a, b) => b.score - a.score).slice(0, n));
  }
  return out;
}
