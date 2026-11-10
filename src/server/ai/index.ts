// The AI layer: ai.run(task, input, opts). 02-system.md §2.
// The model is chosen per business from Settings → AI models. Provider names never leave this module in user-facing errors.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { env } from '../env';
import { reportFailure, type FailureContext } from '../observability/failures';
import { RadarError, GENERIC_AI_ERROR } from '../errors';
import { aiFind } from '@/lib/constants';
import { anthropicRun } from './adapters/anthropic';
import { openaiRun } from './adapters/openai';
import { openrouterRun, openrouterEnabled, openrouterId, openrouterDown, markOpenrouterDown, openrouterSkips, skipOpenrouterModel, isOpenrouterAccountError, isOpenrouterModelMissing, openrouterTripped, noteOpenrouterOutcome, isOpenrouterTimeout } from './adapters/openrouter';
import { stubRun } from './adapters/stub';
import { instructionBlock, readInstructions, withInstructions, type InstructionSpec } from './instructions';
import { recordAiCall } from './record';
import { resolve, effortOn, UTILITY_MIN_TOKENS, PREMIUM_TOKEN_HEADROOM, PREMIUM_MIN_TIMEOUT_MS, STANDARD_CLAUDE_HEADROOM, type Effort, type Step } from './tiers';
import type { Profile } from '@/lib/types';

export type AiTask = 'writing' | 'research';
export interface AiInput<T = any> {
  /** Short machine name of what this call is for, e.g. 'article.draft'. Used for logging and dev stubs. */
  purpose: string;
  system?: string;
  prompt: string;
  /** Zod schema → structured JSON output (validated). */
  schema?: z.ZodType<T>;
  schemaName?: string;
  webSearch?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Streaming text deltas (plain text calls only). */
  onDelta?: (delta: string) => void;
  /** Called before each new attempt (retry or provider failover) so streamed text from a failed attempt is discarded. */
  onReset?: () => void;
  timeoutMs?: number;
  /** Stub-only: context passed to the dev stub generator. */
  stubContext?: any;
  /** Apply this workspace's saved writing instructions. Set only by the writing sites in architecture §6. */
  instructions?: InstructionSpec;
}
export interface AiOutput<T = any> { text: string; json: T | null; citations: { url: string; title?: string }[]; model: string; provider: string }
export interface ProviderCall { apiModel: string; system?: string; prompt: string; jsonSchema?: any; schemaName?: string; webSearch?: boolean; maxTokens: number; temperature?: number; onDelta?: (d: string) => void; timeoutMs: number; /** Reasoning effort, set by the call's tier (never by a caller). Undefined = send no effort field. */ effort?: Effort }
export interface ProviderResult { text: string; json?: any; citations: { url: string; title?: string }[]; inputTokens?: number; outputTokens?: number; /** Actual cost when the route reports it (OpenRouter usage.cost). */ costUsd?: number; /** Web-search tool calls the provider billed (direct Anthropic and OpenAI). */ searches?: number }

/** Catalogue id → provider API id. Labels in Settings are unchanged; ids verified against provider docs (DIVERGENCES #4). Override with AI_MODEL_MAP='{"gpt-6-sol":"..."}'. */
const DEFAULT_API_IDS: Record<string, string> = {
  'claude-fable-5.2': 'claude-fable-5-2', 'claude-fable-5.1': 'claude-fable-5-1', 'claude-opus-5.5': 'claude-opus-5-5', 'claude-sonnet-5.5': 'claude-sonnet-5-5', 'claude-haiku-5.5': 'claude-haiku-5-5',
  'gpt-6-astra': 'gpt-6-astra', 'gpt-6.1-sol': 'gpt-6.1-sol', 'gpt-6-sol': 'gpt-6-sol', 'gpt-6-luna': 'gpt-6-luna',
  'grok-4.7': 'grok-4.7', 'grok-4.6': 'grok-4.6',
};
function apiId(id: string) {
  let over: Record<string, string> = {};
  try { over = JSON.parse(process.env.AI_MODEL_MAP || '{}'); } catch { /* */ }
  return over[id] || DEFAULT_API_IDS[id] || id;
}

export function providerOf(modelId: string): 'Anthropic' | 'OpenAI' | 'SpaceX' {
  const m = aiFind(modelId);
  return (m?.p as any) || (modelId.startsWith('claude') ? 'Anthropic' : modelId.startsWith('grok') ? 'SpaceX' : 'OpenAI');
}
function hasKey(p: string) { return p === 'Anthropic' ? !!env.anthropicKey : p === 'OpenAI' ? !!env.openaiKey : !!env.xaiKey; }

/** The business's `ai` settings (model choices and saved writing instructions) in one lookup; {} without a business. */
async function aiSettingsFor(businessId?: string | null): Promise<Record<string, any>> {
  if (!businessId) return {};
  const r = await db.select({ ai: schema.businesses.ai }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).limit(1);
  return r[0]?.ai || {};
}

/* Provider failover. A business's chosen model is always tried first. If its provider has no key, is out of credit,
   rejects the key, or keeps failing, the call moves to the next configured provider (closest equivalent per task).
   Account-level failures (401/402/403, or 429 with a quota/credit/billing message) mark the provider unavailable for
   10 minutes so later calls skip it without waiting. The model actually used is logged in ai_calls.
   Which model is `chosen`, and which list follows it, comes from the call's tier (./tiers.ts): the lists below are the
   standard ones, per kind. */
const FALLBACKS: Record<AiTask, string[]> = { writing: ['claude-sonnet-5.5', 'grok-4.7', 'gpt-6-sol'], research: ['claude-opus-5.5', 'gpt-6-sol', 'grok-4.7'] };
const DOWN_MS = 10 * 60_000;
const downUntil = new Map<string, number>();
const isDown = (p: string) => (downUntil.get(p) || 0) > Date.now();
export function isAccountError(e: any): boolean {
  const st = Number(e?.status) || Number(String(e?.message || '').match(/^HTTP (\d{3})/)?.[1]) || 0;
  const msg = String(e?.message || '');
  if (st === 401 || st === 402 || st === 403) return true;
  return st === 429 && /quota|credit|billing|insufficient|exceeded your current|spend limit|payment/i.test(msg);
}
function candidates(chosen: string, fallbacks: string[], force: boolean): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [chosen, ...fallbacks]) {
    const p = providerOf(id);
    if (seen.has(p)) continue;
    seen.add(p);
    if (hasKey(p) && !isDown(p)) out.push(id);
  }
  // Every provider looks unavailable: still try the chosen model (a stale "down" mark should not block all work).
  return out.length || !force ? out : [chosen];
}

/* OpenRouter primary route (OPENROUTER_API_KEY). Same failover order as above, but each model is tried on OpenRouter
   first, then on its direct provider (if that key is set), before moving to the next model. A model whose direct
   provider has no key can still be served through OpenRouter. OpenRouter account errors pause OpenRouter for 10
   minutes; a model OpenRouter doesn't have skips OpenRouter for that model only. While the circuit breaker is open
   (repeated timeouts/5xx), OpenRouter is skipped for models that have a direct route. Without the key: candidates() only. */
export interface Route { modelId: string; via: 'openrouter' | 'direct'; /** Last-resort route: tried even if marked unavailable. */ force?: boolean }
/** OpenRouter usable for this model right now? `hasDirect`: the breaker only applies when there's somewhere else to go. */
const orUsable = (orId: string, hasDirect: boolean) => !openrouterDown() && !openrouterSkips(orId) && !(hasDirect && openrouterTripped());
/** `fallbacks`: the models after `chosen` (one per provider is kept). `force` false: a step that is not the plan's last
 *  returns nothing when everything looks unavailable, so the plan moves on instead of forcing `chosen`. */
export function routes(task: AiTask, chosen: string, fallbacks: string[] = FALLBACKS[task], force = true): Route[] {
  if (!openrouterEnabled()) return candidates(chosen, fallbacks, force).map(modelId => ({ modelId, via: 'direct' as const }));
  const out: Route[] = [];
  const seen = new Set<string>();
  for (const id of [chosen, ...fallbacks]) {
    const p = providerOf(id);
    if (seen.has(p)) continue;
    seen.add(p);
    const orId = openrouterId(id);
    const direct = hasKey(p) && !isDown(p);
    if (orId && orUsable(orId, direct)) out.push({ modelId: id, via: 'openrouter' });
    if (direct) out.push({ modelId: id, via: 'direct' });
  }
  if (out.length || !force) return out;
  // Everything looks unavailable: still try the chosen model on both routes (stale marks should not block all work).
  return [...(openrouterId(chosen) ? [{ modelId: chosen, via: 'openrouter' as const, force: true }] : []), { modelId: chosen, via: 'direct' as const }];
}

async function callProvider(modelId: string, c: ProviderCall): Promise<ProviderResult> {
  const p = providerOf(modelId);
  if (p === 'Anthropic') return anthropicRun(c);
  if (p === 'OpenAI') return openaiRun(c, { base: 'https://api.openai.com/v1', key: env.openaiKey });
  return openaiRun(c, { base: 'https://api.x.ai/v1', key: env.xaiKey });
}

/** Bring a model's output inside the schema's hard limits before validation: trim over-long strings at a word
 *  boundary, drop surplus array items, clamp numbers. Models (especially with constraints relaxed for structured
 *  output) occasionally overshoot by a few characters; that shouldn't fail a whole task. */
export function fitToSchema(v: any, s: any, root: any = s): any {
  if (v == null || !s || typeof s !== 'object') return v;
  if (s.$ref && typeof s.$ref === 'string') { const ref = s.$ref.replace(/^#\/(\$defs|definitions)\//, ''); const d = root?.$defs?.[ref] ?? root?.definitions?.[ref]; return d ? fitToSchema(v, d, root) : v; }
  for (const k of ['anyOf', 'oneOf'] as const) if (Array.isArray(s[k])) {
    const branch = s[k].find((b: any) => (b.type === 'array') === Array.isArray(v) && (b.type === 'null') === (v === null) && (!b.type || b.type === 'array' || b.type === 'null' || typeof v === (b.type === 'integer' ? 'number' : b.type)));
    return branch ? fitToSchema(v, branch, root) : v;
  }
  if (typeof v === 'string') {
    if (s.maxLength != null && v.length > s.maxLength) { const cut = v.slice(0, s.maxLength); const sp = cut.lastIndexOf(' '); return (sp > 0 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–—]+$/, ''); }
    return v;
  }
  if (typeof v === 'number') {
    let n = v; if (s.type === 'integer') n = Math.round(n);
    if (s.minimum != null) n = Math.max(s.minimum, n); if (s.maximum != null) n = Math.min(s.maximum, n);
    return n;
  }
  if (Array.isArray(v)) {
    const items = s.items ? v.map(x => fitToSchema(x, s.items, root)) : v;
    return s.maxItems != null ? items.slice(0, s.maxItems) : items;
  }
  if (typeof v === 'object' && s.properties) {
    const o: any = { ...v };
    for (const [k, sub] of Object.entries<any>(s.properties)) if (k in o) o[k] = fitToSchema(o[k], sub, root);
    return o;
  }
  return v;
}

function extractJson(text: string): any {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* */ }
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s >= 0 && e > s) { try { return JSON.parse(t.slice(s, e + 1)); } catch { /* */ } }
  const s2 = t.indexOf('['), e2 = t.lastIndexOf(']');
  if (s2 >= 0 && e2 > s2) { try { return JSON.parse(t.slice(s2, e2 + 1)); } catch { /* */ } }
  return null;
}

/** Reasoning models (e.g. Grok 4.7) can take minutes on large structured outputs: scale the default timeout with the
 *  requested output size. Explicit timeoutMs on a call always wins. */
const defaultTimeout = (maxTokens: number, webSearch: boolean) => Math.min(600_000, Math.max(180_000, maxTokens * 45) + (webSearch ? 60_000 : 0));

/** A route with the extras its tier step gives it (./tiers.ts). */
type PlanRoute = Route & { effort?: Effort; boost?: Step['boost'] };
/** Every step's routes in order. Only the last step may force a route when everything looks unavailable; a model and
 *  route an earlier step already planned is not repeated. */
function planRoutes(task: AiTask, steps: Step[]): PlanRoute[] {
  const out: PlanRoute[] = []; const seen = new Set<string>();
  steps.forEach((s, i) => {
    for (const r of routes(task, s.chosen, s.fallbacks, i === steps.length - 1)) {
      const k = r.modelId + ' ' + r.via; if (seen.has(k)) continue; seen.add(k);
      out.push({ ...r, ...(s.effort && effortOn() ? { effort: s.effort } : {}), ...(s.boost ? { boost: s.boost } : {}) });
    }
  });
  return out;
}

/** Run a task. Retries transient failures, fails over between providers, validates JSON against the schema. Throws RadarError with generic copy on failure. */
export async function run<T = any>(task: AiTask, input: AiInput<T>, opts: { businessId?: string | null; retries?: number } = {}): Promise<AiOutput<T>> {
  const settings = await aiSettingsFor(opts.businessId);
  // The model plan comes from the call's purpose (./tiers.ts): a utility purpose never reads the business's choice, a
  // premium one asks the premium chain first. `chosen` is the model asked first; anything else that answers is a fallback.
  const tiered = resolve(task, input.purpose, settings, FALLBACKS);
  const chosen = tiered.chosen;
  // Saved writing instructions go last in the system prompt, read from the same row as the model choice. With none
  // saved (or no spec, or no business) `system` is the caller's value untouched.
  const system = input.instructions && opts.businessId ? withInstructions(input.system, instructionBlock(readInstructions(settings), input.instructions)) : input.system;
  const jsonSchema = input.schema ? z.toJSONSchema(input.schema as any, { target: 'draft-7' } as any) : undefined;
  const retries = opts.retries ?? 2;
  const plan: PlanRoute[] = env.devStubs ? [{ modelId: chosen, via: 'direct' }] : planRoutes(task, tiered.steps);
  // A model that declined the request is not asked again on its other route. A premium attempt that used up its whole
  // timeout ends the premium step, so the wait before the standard model starts is one timeout at most. OpenRouter's
  // idle cutoff is not that: it is an ordinary failed attempt, and the plan goes on to the model's direct route.
  const skipModels = new Set<string>(); let premiumOver = false;
  // Providers THIS call marked unavailable (out of credit, key rejected). A plan with more than one step can name the
  // same provider twice; its later direct route is not asked again while another route can still be tried.
  const downHere = new Set<string>();
  const usableAfter = (ri: number) => plan.some((r, j) => {
    if (j <= ri || skipModels.has(r.modelId) || (r.boost === 'premium' && premiumOver)) return false;
    if (r.via === 'direct') { const p = providerOf(r.modelId); return hasKey(p) && !isDown(p); }
    return !!r.force || orUsable(openrouterId(r.modelId)!, plan[j + 1]?.modelId === r.modelId && plan[j + 1]?.via === 'direct');
  });
  let lastErr: any = null; let lastReport: FailureContext | null = null;
  for (let ri = 0; ri < plan.length; ri++) {
    const { modelId, via, force, effort, boost } = plan[ri];
    if (skipModels.has(modelId) || (boost === 'premium' && premiumOver)) continue;
    const provider = providerOf(modelId);
    const viaOr = via === 'openrouter';
    const logProvider = viaOr ? 'openrouter' : provider;
    const orModel = viaOr ? openrouterId(modelId)! : '';
    const directNext = plan[ri + 1]?.modelId === modelId && plan[ri + 1]?.via === 'direct';
    // Re-check at each step: an account error, unknown model or open breaker earlier in THIS call also applies here.
    if (viaOr && !force && !orUsable(orModel, directNext)) continue;
    // The same for a direct provider this call marked unavailable, unless nothing after it can be tried either: then it
    // is still asked (a call never ends on a skip while there was an attempt left to make).
    if (!viaOr && downHere.has(provider) && usableAfter(ri)) continue;
    // The timeout always follows the caller's own budget. Token extras: thinking counts against max_tokens on Claude 5.x,
    // so a utility attempt gets a floor, a premium one headroom, and a standard Claude attempt headroom when the caller
    // asked for little. Without a boost (tiers off) the request is the caller's, untouched.
    const base = input.maxTokens || 4000;
    const maxTokens = boost === 'utility' ? Math.max(base, UTILITY_MIN_TOKENS) : boost === 'premium' ? base + PREMIUM_TOKEN_HEADROOM : boost === 'standard' && provider === 'Anthropic' && base < 4000 ? base + STANDARD_CLAUDE_HEADROOM : base;
    let timeoutMs = input.timeoutMs || defaultTimeout(base, !!input.webSearch);
    if (boost === 'premium') timeoutMs = Math.max(timeoutMs, PREMIUM_MIN_TIMEOUT_MS);
    const call: ProviderCall = { apiModel: viaOr ? orModel : apiId(modelId), system, prompt: input.prompt, jsonSchema, schemaName: input.schemaName || 'output', webSearch: input.webSearch, maxTokens, temperature: input.temperature, onDelta: input.onDelta, timeoutMs, effort };
    // OpenRouter gets one attempt when the same model's direct provider is next in line (failing over is faster than
    // retrying, and OpenRouter already retries across its own hosts); otherwise the usual retries.
    const tries = viaOr && directNext ? 0 : retries;
    for (let attempt = 0; attempt <= tries; attempt++) {
      // A breaker that opened during this route's own retries ends them when a direct route follows.
      if (viaOr && attempt > 0 && !force && !orUsable(orModel, directNext)) break;
      const t0 = Date.now();
      input.onReset?.();
      const row = { businessId: opts.businessId, task: tiered.logTask, purpose: input.purpose, model: modelId, provider: logProvider };
      // Set once the provider has answered: an answer Radar then rejects was still billed, and is recorded as such.
      let res: ProviderResult | null = null;
      try {
        if (env.devStubs) res = await stubRun(system === input.system ? input : { ...input, system }, jsonSchema);
        else if (viaOr) res = await openrouterRun(call);
        else {
          if (!hasKey(provider)) throw Object.assign(new Error(`No API key configured for ${provider}`), { permanent: true });
          res = await callProvider(modelId, call);
        }
        // An empty answer is a failure (e.g. a provider that accepts the request and then errors inside the stream).
        if (viaOr) noteOpenrouterOutcome(); // OpenRouter answered: breaker count resets even if the answer is unusable
        if (!String(res.text || '').trim() && res.json == null) throw new Error('Empty response from ' + logProvider);
        let json: any = null;
        if (input.schema) {
          const raw = fitToSchema(res.json ?? extractJson(res.text), jsonSchema);
          const parsed = (input.schema as z.ZodType<T>).safeParse(raw);
          if (!parsed.success) throw new Error('Structured output failed validation: ' + parsed.error.issues.map(issue => issue.code).slice(0, 8).join(', '));
          json = parsed.data;
        }
        recordAiCall({ ...row, latencyMs: Date.now() - t0, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: res.costUsd, searches: res.searches, ok: true });
        if (modelId !== chosen) console.warn(`[ai] ${input.purpose}: used ${modelId} (fallback from ${chosen})`);
        if (!viaOr && openrouterEnabled() && !env.devStubs) console.warn(`[ai] ${input.purpose}: served by ${provider} directly (OpenRouter unavailable for ${modelId})`);
        return { text: res.text, json, citations: res.citations || [], model: modelId, provider: logProvider };
      } catch (e: any) {
        lastErr = e;
        lastReport = { source: 'ai', operation: input.purpose, businessId: opts.businessId, provider: logProvider, model: call.apiModel, attempt: attempt + 1, maxAttempts: tries + 1, retrying: ri < plan.length - 1 || (!e?.permanent && !isAccountError(e) && attempt < tries), degraded: ri < plan.length - 1 };
        await reportFailure(e, lastReport);
        // Tokens and cost when the provider answered and Radar rejected it (empty, invalid JSON), or declined and said what it used.
        const billed: ProviderResult | null = res ?? e?.billed ?? null;
        recordAiCall({ ...row, latencyMs: Date.now() - t0, inputTokens: billed?.inputTokens, outputTokens: billed?.outputTokens, costUsd: billed?.costUsd, searches: billed?.searches, ok: false, error: e });
        if (viaOr) {
          noteOpenrouterOutcome(e);
          if (isOpenrouterAccountError(e)) { markOpenrouterDown(String(e?.message || e)); break; }
          if (isOpenrouterModelMissing(e)) { skipOpenrouterModel(orModel, String(e?.message || e)); break; }
        } else if (isAccountError(e)) { downUntil.set(provider, Date.now() + DOWN_MS); downHere.add(provider); console.warn(`[ai] ${provider} unavailable for 10 min: ${String(e?.message || e).slice(0, 160)}`); break; }
        if (e?.refusal) skipModels.add(modelId);
        if (boost === 'premium' && isOpenrouterTimeout(e) && !e?.idle) { premiumOver = true; break; }
        if (e?.permanent) break;
        if (attempt < tries) await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt)));
      }
    }
  }
  // Interim failures are not alerted. When the routes after one were skipped without an attempt (OpenRouter's account
  // is down, its breaker is open), that interim failure is what ended the call: report it as final.
  if (lastErr && lastReport?.retrying) await reportFailure(lastErr, { ...lastReport, retrying: false, degraded: false });
  console.error(`[ai] ${input.purpose} failed`, lastErr?.message || lastErr);
  const failure = new RadarError(GENERIC_AI_ERROR, 502, 'ai_failed');
  // Keep operational diagnostics internal; HTTP responses still expose only the safe userMessage/code.
  Object.defineProperty(failure, 'cause', { value: lastErr, enumerable: false });
  throw failure;
}

/** Every generation prompt includes the Business Profile (02-system.md §2). */
export function profileContext(p: Profile): string {
  const pri = (p.keywords?.list || []).filter(k => k.priority).map(k => k.kw);
  return [
    `BUSINESS PROFILE`,
    `Name: ${p.business.name}`, `Website: ${p.domain}`, `Description: ${p.business.description}`, `Industry: ${p.business.industry}`,
    `Positioning: ${p.business.positioning}`,
    `Offerings: ${p.business.offerings.join('; ')}`, `Differentiators: ${p.business.differentiators.join('; ')}`,
    `Audience segments: ${p.audience.segments.join('; ')}`, `Key buyers: ${p.audience.buyers.join('; ')}`, `Audience needs: ${p.audience.needs.join('; ')}`,
    `Competitors (never promote these): ${p.audience.competitors.join('; ') || 'none listed'}`,
    `Brand voice: ${p.brand.voice}`, `Language: ${p.brand.language}`, `Markets: ${p.brand.markets.join(', ')}`,
    `Priority keywords: ${pri.join(', ') || 'none'}`,
  ].join('\n');
}

export const ai = { run, profileContext };
export default ai;
