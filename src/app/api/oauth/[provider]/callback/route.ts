import { OAUTH_FLOW_QUERY, oauthFlow } from '@/lib/oauthReturn';
import { reportFailure } from '@/server/observability/failures';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { currentActor } from '@/server/auth/session';
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
  const flow = oauthFlow(st.data?.q?.[OAUTH_FLOW_QUERY]);
  await db.delete(schema.oauthStates).where(eq(schema.oauthStates.state, state));
  if (q.get('error')) return popupResult(provider, { ok: false, error: q.get('error') || 'denied' }, flow);
  const p = oauthProvider(provider);
  if (!p) return popupResult(provider, { ok: false, error: 'unknown_provider' }, flow);
  try {
    const u = await currentActor();   // a guest connects Search Console on its own draft (start checked it)
    if (!u || u.id !== st.userId || (u.guest && provider !== 'gsc')) return popupResult(provider, { ok: false, error: 'session' }, flow);
    const r = await p.callback({ user: u, bid: st.businessId, data: st.data, redirectUri: oauthRedirect(provider), params: q });
    return popupResult(provider, r, flow);
  } catch (e: any) {
    await reportFailure(e, { source: 'http', operation: 'oauth.callback', businessId: st.businessId, userId: st.userId, provider });
    console.error('[oauth callback]', provider, e?.message || e);
    return popupResult(provider, { ok: false, error: 'exchange_failed' }, flow);
  }
}
