import { OAUTH_FLOW_QUERY, OAUTH_RETURN_TTL_MS, oauthReturnKey, publicOAuthResult, validOAuthReturn, type OAuthResult } from '@/lib/oauthReturn';
import type { ActResponse, DeleteBusinessResult, RestoreBusinessResult } from '@/lib/types';

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

/** Delete the open business. Owner only; `domain` is what the owner typed (the server compares it again). Not an action:
 *  there is no workspace to answer with (.factory/delete-business/architecture.md §9.2). */
export const deleteBusinessCall = (bid: string, domain: string) => api<{ ok: true; data: DeleteBusinessResult }>(`/api/b/${bid}/delete`, { body: { domain } }).then(r => r.data);
/** Restore one of the signed-in owner's deleted businesses. Needs no open business, so it also works on /restore. */
export const restoreBusinessCall = (id: string) => api<{ ok: true; data: RestoreBusinessResult }>('/api/b/restore', { body: { id } }).then(r => r.data);

/** Open a nonce-bound OAuth attempt. Google may sever the opener before returning, so completion also travels same-origin. */
export function openOAuth(provider: string, bid: string, params: Record<string, string> = {}, options: { signal?: AbortSignal } = {}): Promise<OAuthResult> {
  return new Promise(resolve => {
    if (options.signal?.aborted) { resolve({ ok: false, error: 'cancelled' }); return; }
    const flow = crypto.randomUUID(); const key = oauthReturnKey(flow); const startedAt = Date.now();
    const q = new URLSearchParams({ bid, ...params, [OAUTH_FLOW_QUERY]: flow });
    let pop: Window | null = null; let channel: BroadcastChannel | null = null; let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      window.removeEventListener('message', onMessage); window.removeEventListener('storage', onStorage);
      options.signal?.removeEventListener('abort', onAbort);
      channel?.close(); if (timer) clearTimeout(timer);
      try { window.localStorage.removeItem(key); } catch { /* Browser storage may be blocked. */ }
    };
    const finish = (result: OAuthResult) => { if (done) return; done = true; cleanup(); resolve(result); };
    const receive = (data: unknown) => { if (validOAuthReturn(data, provider, flow, startedAt, Date.now())) finish(publicOAuthResult(data)); };
    const onMessage = (event: MessageEvent) => { if (pop && event.source === pop && event.origin === location.origin) receive(event.data); };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key || !event.newValue) return;
      try {
        if (new URL(event.url).origin !== location.origin || event.storageArea !== window.localStorage) return;
        receive(JSON.parse(event.newValue));
      } catch { /* Malformed or blocked storage never completes a connection. */ }
    };
    const onAbort = () => { finish({ ok: false, error: 'cancelled' }); try { pop?.close(); } catch { /* COOP may sever the window. */ } };
    // Register before opening: a fast callback must not beat the completion listeners.
    window.addEventListener('message', onMessage); window.addEventListener('storage', onStorage);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel(key);
        channel.onmessage = event => { if (!event.origin || event.origin === location.origin) receive(event.data); };
      }
    } catch { /* postMessage and storage remain available. */ }
    timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), OAUTH_RETURN_TTL_MS);
    const w = 520, h = 640, x = window.screenX + (window.outerWidth - w) / 2, y = window.screenY + (window.outerHeight - h) / 2;
    try { pop = window.open(`/api/oauth/${provider}/start?${q}`, `radar-oauth-${flow}`, `width=${w},height=${h},left=${x},top=${y}`); }
    catch { finish({ ok: false, error: 'blocked' }); return; }
    if (!pop) finish({ ok: false, error: 'blocked' });
    // Do not infer cancellation from pop.closed: Google's COOP can report true while consent is still in progress.
  });
}
