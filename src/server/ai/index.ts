// The AI layer: ai.run(task, input, opts). 02-system.md §2.
// The model is chosen per business from Settings → AI models. Provider names never leave this module in user-facing errors.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { env } from '../env';
import { RadarError, GENERIC_AI_ERROR } from '../errors';
import { AI_DEFAULT, aiFind } from '@/lib/constants';
import { anthropicRun } from './adapters/anthropic';
import { openaiRun } from './adapters/openai';
import { stubRun } from './adapters/stub';
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
  timeoutMs?: number;
  /** Stub-only: context passed to the dev stub generator. */
  stubContext?: any;
}
export interface AiOutput<T = any> { text: string; json: T | null; citations: { url: string; title?: string }[]; model: string; provider: string }
export interface ProviderCall { apiModel: string; system?: string; prompt: string; jsonSchema?: any; schemaName?: string; webSearch?: boolean; maxTokens: number; temperature?: number; onDelta?: (d: string) => void; timeoutMs: number }
export interface ProviderResult { text: string; json?: any; citations: { url: string; title?: string }[]; inputTokens?: number; outputTokens?: number }

/** Catalogue id → provider API id. Labels in Settings are unchanged; ids verified against provider docs (DIVERGENCES #4). Override with AI_MODEL_MAP='{"gpt-6-sol":"..."}'. */
const DEFAULT_API_IDS: Record<string, string> = {
  'claude-fable-5.1': 'claude-fable-5-1', 'claude-opus-5.5': 'claude-opus-5-5', 'claude-sonnet-5.5': 'claude-sonnet-5-5', 'claude-haiku-5.5': 'claude-haiku-5-5',
  'gpt-6-astra': 'gpt-6-astra', 'gpt-6.1-sol': 'gpt-6.1-sol', 'gpt-6-sol': 'gpt-6-sol', 'gpt-6-luna': 'gpt-6-luna',
  'grok-4.7': 'grok-4.7', 'grok-4.6': 'grok-4.6',
};
function apiId(id: string) {
  let over: Record<string, string> = {};
  try { over = JSON.parse(process.env.AI_MODEL_MAP || '{}'); } catch { /* */ }
  return over[id] || DEFAULT_API_IDS[id] || id;
}
/** Rough USD per 1M tokens [input, output] for cost logging only. */
const PRICE: Record<string, [number, number]> = { 'claude-fable-5.1': [15, 75], 'claude-opus-5.5': [5, 25], 'claude-sonnet-5.5': [3, 15], 'claude-haiku-5.5': [1, 5], 'gpt-6-astra': [10, 40], 'gpt-6.1-sol': [3, 12], 'gpt-6-sol': [2, 8], 'gpt-6-luna': [0.4, 1.6], 'grok-4.7': [3, 15], 'grok-4.6': [2, 10] };

export function providerOf(modelId: string): 'Anthropic' | 'OpenAI' | 'SpaceX' {
  const m = aiFind(modelId);
  return (m?.p as any) || (modelId.startsWith('claude') ? 'Anthropic' : modelId.startsWith('grok') ? 'SpaceX' : 'OpenAI');
}
function hasKey(p: string) { return p === 'Anthropic' ? !!env.anthropicKey : p === 'OpenAI' ? !!env.openaiKey : !!env.xaiKey; }

async function modelFor(task: AiTask, businessId?: string | null): Promise<string> {
  if (!businessId) return AI_DEFAULT[task];
  const r = await db.select({ ai: schema.businesses.ai }).from(schema.businesses).where(eq(schema.businesses.id, businessId)).limit(1);
  const id = (r[0]?.ai || {})[task] || AI_DEFAULT[task];
  if (!hasKey(providerOf(id)) && process.env.RADAR_AI_FALLBACK === '1') {
    // Operator opted in: fall back to any configured provider (logged per call).
    for (const fb of ['claude-opus-5.5', 'gpt-6-sol', 'grok-4.7']) if (hasKey(providerOf(fb))) return fb;
  }
  return id;
}

async function callProvider(modelId: string, c: ProviderCall): Promise<ProviderResult> {
  const p = providerOf(modelId);
  if (p === 'Anthropic') return anthropicRun(c);
  if (p === 'OpenAI') return openaiRun(c, { base: 'https://api.openai.com/v1', key: env.openaiKey });
  return openaiRun(c, { base: 'https://api.x.ai/v1', key: env.xaiKey });
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

/** Run a task. Retries transient failures; validates JSON against the schema. Throws RadarError with generic copy on failure. */
export async function run<T = any>(task: AiTask, input: AiInput<T>, opts: { businessId?: string | null; retries?: number } = {}): Promise<AiOutput<T>> {
  const modelId = await modelFor(task, opts.businessId);
  const provider = providerOf(modelId);
  const jsonSchema = input.schema ? z.toJSONSchema(input.schema as any, { target: 'draft-7' } as any) : undefined;
  const call: ProviderCall = { apiModel: apiId(modelId), system: input.system, prompt: input.prompt, jsonSchema, schemaName: input.schemaName || 'output', webSearch: input.webSearch, maxTokens: input.maxTokens || 4000, temperature: input.temperature, onDelta: input.onDelta, timeoutMs: input.timeoutMs || 120000 };
  const retries = opts.retries ?? 2;
  let lastErr: any = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const t0 = Date.now();
    try {
      let res: ProviderResult;
      if (env.devStubs) res = await stubRun(input, jsonSchema);
      else {
        if (!hasKey(provider)) throw new Error(`No API key configured for ${provider}`);
        res = await callProvider(modelId, call);
      }
      let json: any = null;
      if (input.schema) {
        const raw = res.json ?? extractJson(res.text);
        const parsed = (input.schema as z.ZodType<T>).safeParse(raw);
        if (!parsed.success) throw new Error('Structured output failed validation: ' + parsed.error.message.slice(0, 300));
        json = parsed.data;
      }
      log(opts.businessId, task, input.purpose, modelId, provider, Date.now() - t0, res, true, null);
      return { text: res.text, json, citations: res.citations || [], model: modelId, provider };
    } catch (e: any) {
      lastErr = e;
      log(opts.businessId, task, input.purpose, modelId, provider, Date.now() - t0, null, false, String(e?.message || e));
      if (e?.permanent) break;
      if (attempt < retries) await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt)));
    }
  }
  console.error(`[ai] ${input.purpose} failed`, lastErr?.message || lastErr);
  throw new RadarError(GENERIC_AI_ERROR, 502, 'ai_failed');
}

function log(businessId: string | null | undefined, task: string, purpose: string, model: string, provider: string, ms: number, res: ProviderResult | null, ok: boolean, error: string | null) {
  const pr = PRICE[model];
  const cost = pr && res ? ((res.inputTokens || 0) * pr[0] + (res.outputTokens || 0) * pr[1]) / 1e6 : null;
  db.insert(schema.aiCalls).values({ businessId: businessId || null, task, purpose, model, provider, latencyMs: ms, inputTokens: res?.inputTokens ?? null, outputTokens: res?.outputTokens ?? null, costUsd: cost, ok, error }).catch(() => {});
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
