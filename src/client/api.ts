import type { ActResponse } from '@/lib/types';

export class ApiError extends Error { constructor(message: string, public status: number, public code?: string, public errors?: Record<string, string>) { super(message); } }

/** Sent on every request. The server answers a request without it as it did before "lighter saves": the whole workspace,
 *  article bodies included, on every write (first-five architecture §3.1). Tabs opened before that release send nothing. */
export const CLIENT_HEADER = { 'x-radar-client': '2' };

export async function api<T = any>(path: string, opts: { method?: string; body?: any } = {}): Promise<T> {
  const r = await fetch(path, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: opts.body ? { ...CLIENT_HEADER, 'content-type': 'application/json' } : CLIENT_HEADER, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
  let j: any = null; try { j = await r.json(); } catch { /* */ }
  if (!r.ok || (j && j.ok === false)) throw new ApiError(j?.error || 'Radar couldn’t finish this. Try again.', r.status, j?.code, j?.errors);
  return j as T;
}
/** 402 subscription_required: the business (or the account) has no trialing/active subscription. */
export const isSubscriptionRequired = (e: unknown) => e instanceof ApiError && e.status === 402 && (!e.code || e.code === 'subscription_required');
/** `reply: 'rev'` asks a write to answer with the new revision only, no workspace (debounced autosaves). */
export const actCall = <T = any>(bid: string, action: string, input?: any, reply?: 'rev') => api<ActResponse<T>>(`/api/b/${bid}/act`, { body: { action, input, ...(reply ? { reply } : {}) } });

/** Open an OAuth popup and resolve with the callback's message. */
export function openOAuth(provider: string, bid: string, params: Record<string, string> = {}): Promise<{ ok: boolean; result?: any; error?: string }> {
  return new Promise(resolve => {
    const q = new URLSearchParams({ bid, ...params });
    const w = 520, h = 640, x = window.screenX + (window.outerWidth - w) / 2, y = window.screenY + (window.outerHeight - h) / 2;
    const pop = window.open(`/api/oauth/${provider}/start?${q}`, `radar-oauth-${crypto.randomUUID()}`, `width=${w},height=${h},left=${x},top=${y}`);
    let done = false;
    const onMsg = (e: MessageEvent) => {
      if (!pop || e.source !== pop || e.origin !== location.origin || !e.data || e.data.type !== 'radar-oauth' || e.data.provider !== provider) return;
      done = true; cleanup(); resolve({ ok: !!e.data.ok, result: e.data.result, error: e.data.error });
    };
    const iv = setInterval(() => { if (pop && pop.closed && !done) { cleanup(); resolve({ ok: false, error: 'closed' }); } }, 500);
    const cleanup = () => { window.removeEventListener('message', onMsg); clearInterval(iv); };
    window.addEventListener('message', onMsg);
    if (!pop) { cleanup(); resolve({ ok: false, error: 'blocked' }); }
  });
}
