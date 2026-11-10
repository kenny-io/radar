// Reasoning effort is optional on every route: a provider or model that rejects the field must never fail the task
// because of it. Each adapter builds its request inside withEffort, which sends it with the field and, on a rejection of
// the field itself, sends it once more without.
import type { Effort } from '../tiers';

/** A provider said no to the effort field itself (a 400 naming it, or OpenRouter's 404 "no endpoint supports the requested parameters"). */
export const isEffortRejection = (e: any) => { const s = Number(e?.status), m = String(e?.message || '');
  return (s === 400 && /effort|reasoning/i.test(m)) || (s === 404 && /parameter|support/i.test(m)); };

const OFF_MS = 10 * 60_000;
const offUntil = new Map<string, number>();

/** Build-and-send with effort; on a rejection send once more without it and remember that for 10 minutes.
 *  `key` names the route and model (`openrouter:anthropic/claude-haiku-5.5`, `https://api.openai.com/v1:gpt-6-luna`).
 *  `resendable` lets a streaming caller refuse the resend once text has been shown (a rejection normally arrives as the
 *  HTTP status, before any text). With no effort the request is sent as it always was. */
export async function withEffort<T>(key: string, effort: Effort | undefined, send: (effort?: Effort) => Promise<T>, resendable: () => boolean = () => true): Promise<T> {
  if (!effort || (offUntil.get(key) || 0) > Date.now()) return send(undefined);
  try { return await send(effort); } catch (e: any) {
    if (!isEffortRejection(e) || !resendable()) throw e;
    console.warn(`[ai] ${key} rejected the effort setting, sending without it: ${String(e?.message || e).slice(0, 160)}`);
    try { const out = await send(undefined); offUntil.set(key, Date.now() + OFF_MS); return out; } catch (e2: any) {
      // Rejected the same way without the field: effort was not the cause, so keep sending it next time.
      if (!isEffortRejection(e2)) offUntil.set(key, Date.now() + OFF_MS);
      throw e2;
    }
  }
}
