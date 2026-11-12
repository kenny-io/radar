// Model tiers: which model plan a call gets, decided by its `purpose` alone. Pure (constants and process.env only), so
// routing, Settings and tests share one table. Call sites never name a tier: they keep ai.run('writing' | 'research', …).
//   utility   scoring, classification, extraction, and the image directions read from a finished article: a small
//             model at low effort; never reads the business's choice.
//   standard  everything not listed: the business's choice for the kind, else the standard default.
//   premium   the few tasks worth the strongest model: the premium chain, then the standard plan.
// Every switch is an environment variable read at call time (web and worker must carry the same values):
//   RADAR_AI_TIERS           unset = utility,premium. A comma list turns on only the tiers it names; unknown words are
//                            ignored. `off` = the routing before tiers (writing default gpt-6-sol, no effort, no
//                            headroom) and every variable below is ignored.
//   RADAR_AI_UTILITY_MODEL   catalogue id, default claude-haiku-5.5.
//   RADAR_AI_WRITING_MODEL, RADAR_AI_RESEARCH_MODEL   standard default per kind, default AI_DEFAULT.
//   RADAR_AI_PREMIUM_MODEL / RADAR_AI_PREMIUM_FALLBACK   default claude-fable-5.2 / gpt-6-astra.
//   RADAR_AI_PREMIUM_EFFORT  low | medium | high | xhigh, default medium.
//   RADAR_AI_EFFORT          `off` = never send an effort field on any route.
import { AI_DEFAULT, aiFind } from '@/lib/constants';

export type AiTier = 'utility' | 'standard' | 'premium';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh';
type Kind = 'writing' | 'research';

/** The one table (MT-1). A purpose that is not listed is standard. */
export const PURPOSE_TIER: Record<string, AiTier> = {
  'brief.rank': 'utility', 'visibility.extract': 'utility', 'keywords.intent': 'utility',
  'analysis.classify': 'utility', 'article.meta': 'utility', 'article.destat': 'utility',
  'article.imageDirections': 'utility',
  'article.draft': 'premium', 'suggestions.refreshDraft': 'premium', 'calendar.topics': 'premium',
};
export const tierOf = (purpose: string): AiTier => PURPOSE_TIER[purpose] || 'standard';
/** Standard purposes a person is waiting on (support.answer has 12 s and no retries): low effort, same model. */
export const STANDARD_EFFORT: Record<string, Effort> = { 'support.answer': 'low', 'article.rewrite': 'low', 'brief.rewrite': 'low' };

export const LEGACY_DEFAULT = { writing: 'gpt-6-sol', research: 'claude-opus-5.5' } as const;
/** Same price as each other on the first two; grok-4.7 is the last resort so a utility call with no heuristic fallback still runs. */
export const UTILITY_FALLBACKS = ['claude-haiku-5.5', 'gpt-6-luna', 'grok-4.7'];
/** Thinking counts against max_tokens on Claude 5.x, and a reasoning budget must fit under it: the floor and headroom below keep small budgets from truncating. */
export const UTILITY_MIN_TOKENS = 2048, PREMIUM_TOKEN_HEADROOM = 8000, PREMIUM_MIN_TIMEOUT_MS = 360_000;
/** Added to a standard Claude attempt whose caller asked for under 4,000 tokens. */
export const STANDARD_CLAUDE_HEADROOM = 2048;
const PREMIUM_DEFAULT = 'claude-fable-5.2', PREMIUM_FALLBACK_DEFAULT = 'gpt-6-astra';
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh'];

const read = (name: string) => (process.env[name] || '').trim();
export function tiersOn(): { utility: boolean; premium: boolean; legacy: boolean } {
  const raw = read('RADAR_AI_TIERS').toLowerCase();
  if (!raw) return { utility: true, premium: true, legacy: false };
  const words = raw.split(',').map(w => w.trim());
  if (words.includes('off')) return { utility: false, premium: false, legacy: true };
  return { utility: words.includes('utility'), premium: words.includes('premium'), legacy: false };
}
export const effortOn = () => read('RADAR_AI_EFFORT').toLowerCase() !== 'off';

const warned = new Set<string>();
/** A model named by an environment variable, when it is in the catalogue; otherwise the default (one warning per bad value). */
function envModel(name: string, fallback: string): string {
  const v = read(name);
  if (!v || aiFind(v)) return v || fallback;
  if (!warned.has(name + '=' + v)) { warned.add(name + '=' + v); console.warn(`[ai] ${name}=${v.slice(0, 60)} is not a catalogue model, using ${fallback}`); }
  return fallback;
}
/** The standard default for a kind: LEGACY_DEFAULT when legacy, else RADAR_AI_{WRITING,RESEARCH}_MODEL, else AI_DEFAULT. */
export function standardDefault(kind: Kind): string {
  if (tiersOn().legacy) return LEGACY_DEFAULT[kind];
  return envModel(kind === 'writing' ? 'RADAR_AI_WRITING_MODEL' : 'RADAR_AI_RESEARCH_MODEL', AI_DEFAULT[kind]);
}
function premiumEffort(): Effort { const v = read('RADAR_AI_PREMIUM_EFFORT').toLowerCase() as Effort; return EFFORTS.includes(v) ? v : 'medium'; }

/** One model with its failover list. `boost` marks the attempts that get a tier's extras: 'utility' = token floor,
 *  'premium' = headroom and minimum timeout, 'standard' = thinking headroom on Claude attempts with a small budget.
 *  A legacy step has neither `effort` nor `boost`: its requests are the ones sent before tiers existed. */
export interface Step { chosen: string; fallbacks: string[]; effort?: Effort; boost?: 'utility' | 'premium' | 'standard' }
/** `tier` is informational; routing reads only `steps`. `logTask` is what ai_calls.task records. */
export interface Resolved { tier: AiTier; logTask: string; chosen: string; steps: Step[] }

/** The model plan for one call. `settings` is the business's `ai` column; `fallbacks` the per-kind failover lists. */
export function resolve(kind: Kind, purpose: string, settings: Record<string, any>, fallbacks: Record<string, string[]>): Resolved {
  const on = tiersOn(), tier = tierOf(purpose);
  const done = (logTask: string, steps: Step[]): Resolved => ({ tier, logTask, chosen: steps[0].chosen, steps });
  // A business row has the key only when a member picked a model in Settings: that is an explicit choice.
  const explicit: string | undefined = settings?.[kind] || undefined;
  if (on.legacy) return done(kind, [{ chosen: explicit || LEGACY_DEFAULT[kind], fallbacks: fallbacks[kind] }]);
  if (tier === 'utility' && on.utility) return done('utility', [{ chosen: envModel('RADAR_AI_UTILITY_MODEL', UTILITY_FALLBACKS[0]), fallbacks: UTILITY_FALLBACKS, effort: 'low', boost: 'utility' }]);
  const def = standardDefault(kind);
  const std: Step = { chosen: explicit || def, fallbacks: fallbacks[kind], ...(STANDARD_EFFORT[purpose] ? { effort: STANDARD_EFFORT[purpose] } : {}), boost: 'standard' };
  if (tier !== 'premium' || !on.premium) return done(kind, [std]);
  // A choice other than the default replaces the premium chain (MT-4). Picking the default again means automatic
  // (MT-4a): "Settings shows the default" is the same routing whether it is shown by default or was picked.
  if (explicit && explicit !== def) return done('premium', [std]);
  return done('premium', [{ chosen: envModel('RADAR_AI_PREMIUM_MODEL', PREMIUM_DEFAULT), fallbacks: [envModel('RADAR_AI_PREMIUM_FALLBACK', PREMIUM_FALLBACK_DEFAULT)], effort: premiumEffort(), boost: 'premium' }, std]);
}
