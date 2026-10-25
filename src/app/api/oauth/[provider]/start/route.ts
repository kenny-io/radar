import { NextResponse } from 'next/server';
import { db, schema } from '@/server/db';
import { gateBusiness, requireActor, requireRole } from '@/server/access';
import { ownAccess } from '@/server/billing/access';
import { oauthRedirect } from '@/server/env';
import { randomToken } from '@/server/crypto';
import { oauthProvider } from '@/server/oauth/registry';
import '@/server/oauth/providers';
import { popupResult } from '../popup';

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const q = new URL(req.url).searchParams;
  try {
    const u = await requireActor();
    const bid = q.get('bid') || '';
    const p = oauthProvider(provider);
    if (!p) return popupResult(provider, { ok: false, error: 'unknown_provider' });
    // A guest may connect only Search Console, only on its own draft (architecture §4.4). On a draft, other providers need
    // own access, like any non-allowlisted action.
    if (u.guest && provider !== 'gsc') return popupResult(provider, { ok: false, error: 'Business wasn’t found.' });
    await requireRole(bid, u.id, p.role || 'Editor');
    await gateBusiness(u, bid, { action: provider === 'gsc' ? undefined : `oauth.${provider}`, own: await ownAccess(u) });
    const state = randomToken(18);
    const { url, data } = await p.start({ user: u, bid, state, redirectUri: oauthRedirect(provider), params: q });
    await db.insert(schema.oauthStates).values({ state, userId: u.id, businessId: bid, provider, data: { ...(data || {}), q: Object.fromEntries(q) } });
    return NextResponse.redirect(url);
  } catch (e: any) {
    return popupResult(provider, { ok: false, error: e?.userMessage || 'start_failed' });
  }
}
