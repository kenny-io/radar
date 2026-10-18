import { eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { currentUser } from '@/server/auth/session';
import { oauthRedirect } from '@/server/env';
import { oauthProvider } from '@/server/oauth/registry';
import '@/server/oauth/providers';
import { popupResult } from '../popup';

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const q = new URL(req.url).searchParams;
  const state = q.get('state') || '';
  const st = (await db.select().from(schema.oauthStates).where(eq(schema.oauthStates.state, state)).limit(1))[0];
  if (!st || st.provider !== provider || !st.businessId) return popupResult(provider, { ok: false, error: 'invalid_state' });
  await db.delete(schema.oauthStates).where(eq(schema.oauthStates.state, state));
  if (q.get('error')) return popupResult(provider, { ok: false, error: q.get('error') || 'denied' });
  const p = oauthProvider(provider);
  if (!p) return popupResult(provider, { ok: false, error: 'unknown_provider' });
  try {
    const u = await currentUser();
    if (!u || u.id !== st.userId) return popupResult(provider, { ok: false, error: 'session' });
    const r = await p.callback({ user: u, bid: st.businessId, data: st.data, redirectUri: oauthRedirect(provider), params: q });
    return popupResult(provider, r);
  } catch (e: any) {
    console.error('[oauth callback]', provider, e?.message || e);
    return popupResult(provider, { ok: false, error: 'exchange_failed' });
  }
}
