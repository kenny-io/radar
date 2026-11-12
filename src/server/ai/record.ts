// The one writer of ai_calls: text calls (ai/index.ts), AI Visibility engines, image generations and Perplexity searches
// all record through recordAiCall, so spend is counted the same way everywhere. The sandbox publisher's model proxy
// writes the same row through recordAiCallNow. Imports only the db, env and the price table, so any of those modules
// can import it without a cycle.
import { db, schema } from '../db';
import { env } from '../env';
import { costOf, type Usage } from './prices';

export interface AiCallRecord extends Usage {
  businessId?: string | null;
  /** 'writing' | 'research' | 'utility' | 'premium' | 'visibility' | 'image' | 'search' */
  task: string;
  purpose: string;
  /** The model asked on that route. */
  model: string;
  /** 'openrouter' | 'Anthropic' | 'OpenAI' | 'SpaceX' | 'Perplexity' | 'Google' */
  provider: string;
  latencyMs: number;
  /** Reported by the route; wins over the price table. */
  costUsd?: number | null;
  ok: boolean;
  /** An Error or a short message. Never prompt or answer text. */
  error?: unknown;
}

/** Provider credentials never reach a row, even when a provider echoes one back in an error body. */
function redact(s: string): string {
  for (const k of [env.openrouterKey, env.anthropicKey, env.openaiKey, env.xaiKey, env.perplexityKey, env.geminiKey]) if (k && k.length >= 6) s = s.split(k).join('[redacted]');
  return s;
}

/** The ai_calls row for one call. The table has one input column, so prompt-cache reads and writes a caller split out are
 *  added to `inputTokens` (uncached + cache read + cache write); the cost still prices each at its own rate. */
function row(r: AiCallRecord) {
  const costUsd = r.costUsd ?? costOf(r.model, r, r.provider);
  const error = r.error == null ? null : redact(String((r.error as any)?.message || r.error)).slice(0, 500);
  const cached = r.cacheReadTokens != null || r.cacheWriteTokens != null || r.cacheWrite1hTokens != null;
  const inputTokens = cached ? (r.inputTokens || 0) + (r.cacheReadTokens || 0) + (r.cacheWriteTokens || 0) + (r.cacheWrite1hTokens || 0) : r.inputTokens ?? null;
  return {
    businessId: r.businessId || null, task: r.task, purpose: r.purpose, model: r.model, provider: r.provider, latencyMs: r.latencyMs,
    inputTokens, outputTokens: r.outputTokens ?? null, costUsd, ok: r.ok, error,
  };
}

/** Write one ai_calls row. Fire and forget: it returns at once, never throws and never rejects into the caller, so a
 *  slow or failing insert cannot delay or fail the work being recorded. Pass no prompt or answer text. */
export function recordAiCall(r: AiCallRecord): void {
  try {
    Promise.resolve(db.insert(schema.aiCalls).values(row(r))).catch(() => {});
  } catch { /* recording is best effort */ }
}

/** The same row, awaited: resolves once it is written and rejects with the insert's error when it is not. For a caller
 *  that owns the whole exchange and must know whether its spend was logged (the sandbox model proxy, which catches the
 *  rejection, reports it and still answers). Everything else uses recordAiCall. Pass no prompt or answer text. */
export async function recordAiCallNow(r: AiCallRecord): Promise<void> {
  await db.insert(schema.aiCalls).values(row(r));
}
