/** Cross-window OAuth completion. The nonce identifies a UI attempt; server OAuth state still authorizes the grant. */
export const OAUTH_FLOW_QUERY = 'radar_flow';
export const OAUTH_RETURN_TTL_MS = 10 * 60_000;
export const oauthReturnKey = (flow: string) => `radar-oauth:${flow}`;
export const oauthFlow = (value: unknown): string | undefined => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : undefined;
export interface OAuthResult { ok: boolean; result?: { oauthRef?: string; ch?: string; pickAccount?: boolean }; error?: string }
export interface OAuthReturn extends OAuthResult { type: 'radar-oauth'; provider: string; flow: string; at: number }
/** Only public completion data crosses windows or enters temporary browser storage. */
export function publicOAuthResult(payload: OAuthResult): OAuthResult {
  const result = payload.result;
  const safe = result && typeof result === 'object' ? {
    ...(typeof result.oauthRef === 'string' && result.oauthRef.length <= 100 ? { oauthRef: result.oauthRef } : {}),
    ...(typeof result.ch === 'string' && result.ch.length <= 40 ? { ch: result.ch } : {}),
    ...(typeof result.pickAccount === 'boolean' ? { pickAccount: result.pickAccount } : {}),
  } : undefined;
  return { ok: !!payload.ok, ...(safe && Object.keys(safe).length ? { result: safe } : {}), ...(typeof payload.error === 'string' ? { error: payload.error.slice(0, 500) } : {}) };
}
export function validOAuthReturn(value: unknown, provider: string, flow: string, startedAt: number, now: number): value is OAuthReturn {
  const x = value as Partial<OAuthReturn> | null;
  return !!x && x.type === 'radar-oauth' && x.provider === provider && x.flow === flow && typeof x.ok === 'boolean' && typeof x.at === 'number' && Number.isFinite(x.at) && x.at >= startedAt && x.at <= now + 1000 && now - x.at <= OAUTH_RETURN_TTL_MS;
}

/** Safe, actionable connection copy. Provider codes and raw errors never become HTML or credential diagnostics. */
export function oauthErrorCopy(provider: string, error?: string): string {
  if (error === 'blocked') return 'Allow pop-up windows for Radar, then try connecting again.';
  if (error === 'timeout') return 'Sign-in did not finish within 10 minutes. Return to Radar and try connecting again.';
  if (error === 'cancelled' || error === 'closed') return 'Sign-in was cancelled or interrupted. Try connecting again when you’re ready.';
  if (error === 'session') return 'Your Radar sign-in expired. Sign in to Radar again, then reconnect.';
  if (error === 'access_denied' || error === 'denied') return `Access was not granted. Try again and allow the permissions needed to connect ${provider}.`;
  if (error === 'scope_denied' && provider === 'Google Search Console') return 'Allow the requested read-only Search Console permission so Radar can find your properties.';
  if (error === 'scope_denied' || error === 'Radar needs permission to post. Try again and allow all permissions.') return `Allow all requested permissions so Radar can identify your ${provider} account and publish the posts you approve.`;
  if (error === 'youtube_channel_missing') return 'This Google account has no YouTube channel. Choose an account with a channel, or create a channel on YouTube first.';
  if (error === 'invalid_state') return 'This sign-in link expired or was already used. Start connecting again from Radar.';
  return `${provider} sign-in could not be completed. Try connecting again.`;
}
