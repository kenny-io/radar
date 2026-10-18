// Google Search Console API client: encrypted token storage, token refresh, sites.list, searchanalytics.query, revoke.
// Tokens created by the dev OAuth stub carry { stub: true } and are served by ./stub (RADAR_DEV_STUBS=1 only).
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import { env } from '../../env';
import { decrypt, encrypt } from '../../crypto';

export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/webmasters/v3';

export interface GscTokens { stub?: boolean; access_token?: string; refresh_token?: string; expires_at?: number; scope?: string }

/** Google returned something we can't proceed past right now. `transient` = 5xx / quota / rate limit (resume later). */
export class GscApiError extends Error {
  constructor(message: string, public status: number, public transient: boolean, public reason?: string) { super(message); }
}

export async function loadTokens(bid: string): Promise<GscTokens | null> {
  const r = (await db.select({ t: schema.gscConnections.tokensEnc }).from(schema.gscConnections).where(eq(schema.gscConnections.businessId, bid)).limit(1))[0];
  try { return decrypt<GscTokens>(r?.t); } catch { return null; }
}

/** Save tokens without touching the connection status (status only changes once a property is connected). */
export async function saveTokens(bid: string, t: GscTokens | null) {
  const tokensEnc = t ? encrypt(t) : null;
  await db.insert(schema.gscConnections).values({ businessId: bid, status: 'none', tokensEnc })
    .onConflictDoUpdate({ target: schema.gscConnections.businessId, set: { tokensEnc, updatedAt: new Date() } });
}

/** Exchange an authorization code (OAuth callback). */
export async function exchangeCode(code: string, redirectUri: string): Promise<GscTokens> {
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: env.googleClientId, client_secret: env.googleClientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new GscApiError(`token exchange failed: ${j.error || r.status}`, r.status, false, j.error);
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (Number(j.expires_in || 3600) * 1000), scope: j.scope };
}

/** A valid access token, refreshing (and persisting) it when it is about to expire. */
export async function accessToken(bid: string): Promise<{ tokens: GscTokens; token: string | null }> {
  const t = await loadTokens(bid);
  if (!t) throw new GscApiError('not authorized', 401, false, 'no_tokens');
  if (t.stub) return { tokens: t, token: null };
  if (t.access_token && (t.expires_at || 0) - 60_000 > Date.now()) return { tokens: t, token: t.access_token };
  if (!t.refresh_token) throw new GscApiError('no refresh token', 401, false, 'no_refresh_token');
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.googleClientId, client_secret: env.googleClientSecret, refresh_token: t.refresh_token, grant_type: 'refresh_token' }) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new GscApiError(`token refresh failed: ${j.error || r.status}`, r.status, r.status >= 500, j.error);
  const next: GscTokens = { ...t, access_token: j.access_token, expires_at: Date.now() + Number(j.expires_in || 3600) * 1000, scope: j.scope || t.scope, refresh_token: j.refresh_token || t.refresh_token };
  await saveTokens(bid, next);
  return { tokens: next, token: next.access_token! };
}

async function gfetch(token: string, url: string, init: RequestInit = {}) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 60_000);
  let r: Response;
  try { r = await fetch(url, { ...init, signal: ctl.signal, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) } }); }
  catch (e: any) { throw new GscApiError(`network: ${e?.message || e}`, 0, true, 'network'); }
  finally { clearTimeout(timer); }
  const txt = await r.text(); let j: any = {}; try { j = txt ? JSON.parse(txt) : {}; } catch { /* */ }
  if (!r.ok) {
    const reason = j?.error?.errors?.[0]?.reason || j?.error?.status || '';
    const quota = r.status === 429 || /quota|rateLimit/i.test(reason);
    throw new GscApiError(`Search Console HTTP ${r.status} ${reason}: ${(j?.error?.message || txt).slice(0, 200)}`, r.status, r.status >= 500 || quota, reason);
  }
  return j;
}

export interface SiteEntry { siteUrl: string; permissionLevel: string }
export async function listSites(token: string): Promise<SiteEntry[]> {
  const j = await gfetch(token, `${API}/sites`);
  return (j.siteEntry || []).filter((s: SiteEntry) => s.permissionLevel !== 'siteUnverifiedUser');
}

export interface SaRow { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }
/** searchanalytics.query with startRow pagination (rowLimit 25,000). */
export async function queryAll(token: string, siteUrl: string, body: { startDate: string; endDate: string; dimensions: string[] }, onPage?: (rows: SaRow[]) => Promise<void>): Promise<SaRow[]> {
  const all: SaRow[] = []; let startRow = 0; const rowLimit = 25000;
  for (;;) {
    const j = await gfetch(token, `${API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, { method: 'POST', body: JSON.stringify({ ...body, type: 'web', rowLimit, startRow }) });
    const rows: SaRow[] = j.rows || [];
    if (onPage) await onPage(rows); else all.push(...rows);
    if (rows.length < rowLimit) break;
    startRow += rowLimit;
  }
  return all;
}

export async function revoke(t: GscTokens | null) {
  if (!t || t.stub) return;
  const tok = t.refresh_token || t.access_token; if (!tok) return;
  try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok)}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' } }); } catch { /* best effort */ }
}
