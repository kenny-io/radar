// OAuth providers for social channels (architecture.md §7): defineOAuth('x' | 'linkedin' | 'linkedin_page', …), role Editor.
// The callback exchanges the code at once (X codes last 30 s), fetches the identity, and stores both encrypted as a pending
// authorization (1 hour); social.connect (or social.pages first, for a page) finishes it. Nothing is connected until then.
// With RADAR_DEV_STUBS=1 start redirects straight to the callback with a stub code (`stub_as=other` signs in as someone else).
import crypto from 'node:crypto';
import { defineOAuth, type OAuthCallbackCtx, type OAuthStartCtx } from '../../../oauth/registry';
import { env } from '../../../env';
import { RadarError } from '../../../errors';
import { decrypt, encrypt, randomToken } from '../../../crypto';
import { requireRole } from '../../../access';
import { getBiz } from '../../../workspace';
import { socialOn } from '../../../flags';
import { COPY } from '@/lib/socialPublish';
import type { Profile, SocialChannel } from '@/lib/types';
import type { Identity, Tokens } from './api';
import { savePendingSocial } from './accounts';
import { X_AUTHORIZE, X_SCOPES, xExchange, xMe } from './x';
import { LI_AUTHORIZE, LI_PAGE_SCOPES, LI_PROFILE_SCOPES, liCreds, liExchange, liMe, liUserinfo } from './linkedin';
import { stubIdentity, stubTokens } from './stubs';

const UNAVAILABLE = 'This connection isn’t available right now. Try again later.';
/** Shown when the user unticked a permission on the consent screen (§21 P6). Nothing is saved. */
export const SCOPE_ERROR = 'Radar needs permission to post. Try again and allow all permissions.';
const REQUIRED: Record<SocialChannel, string[]> = { x: X_SCOPES.split(' '), li_profile: LI_PROFILE_SCOPES.split(' '), li_page: ['w_organization_social', 'rw_organization_admin'] };
/** Every required scope was granted. A token response without a scope list is accepted (the API calls will tell). */
export const scopesOk = (ch: SocialChannel, granted: string | null | undefined) => !granted || REQUIRED[ch].every(x => granted.split(/[\s,]+/).includes(x));
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
const isStub = (ctx: OAuthCallbackCtx) => env.devStubs && ctx.params.get('code') === 'stub-code';
const b64url = (b: Buffer) => b.toString('base64url');

async function gate(ctx: OAuthStartCtx) {
  const b = await getBiz(ctx.bid);
  if (!(await socialOn(b))) throw new RadarError(COPY.notEnabled, 404, 'not_enabled');
  return b;
}
function stubStart(ctx: OAuthStartCtx) {
  const as: Record<string, string> = ctx.params.get('stub_as') === 'other' ? { stub_as: 'other' } : {};
  return { url: `${ctx.redirectUri}?${q({ code: 'stub-code', state: ctx.state, ...as })}` };
}
/** Re-check the role, then store the pending authorization and hand the popup its reference. */
async function finish(ctx: OAuthCallbackCtx, ch: SocialChannel, tokens: Tokens, id: Identity) {
  const oauthRef = await savePendingSocial(ctx.bid, ctx.user!.id, ch, { tokens, id });
  console.log(`[social.oauth] ${ch} authorized for ${ctx.bid}`);
  return { ok: true, result: { oauthRef, ch } };
}
async function callbackFor(ctx: OAuthCallbackCtx, ch: SocialChannel, real: () => Promise<{ tokens: Tokens; id: Identity }>) {
  if (!ctx.user) return { ok: false, error: 'session' };
  try { await requireRole(ctx.bid, ctx.user.id, 'Editor'); } catch { return { ok: false, error: 'forbidden' }; }
  if (!ctx.params.get('code')) return { ok: false, error: 'denied' };
  if (isStub(ctx)) {
    const b = await getBiz(ctx.bid);
    return finish(ctx, ch, stubTokens(ch), stubIdentity(ch, { businessName: (b.profile as Profile)?.business?.name || b.domain, userName: ctx.user.name, userId: ctx.user.id, as: ctx.params.get('stub_as') }));
  }
  try {
    const r = await real();
    if (!scopesOk(ch, r.tokens.scope)) { console.warn(`[social.oauth] ${ch} missing scopes for ${ctx.bid}`); return { ok: false, error: SCOPE_ERROR }; }
    return finish(ctx, ch, r.tokens, r.id);
  }
  catch (e: any) { console.error(`[social.oauth] ${ch} exchange failed: ${String(e?.message || e).slice(0, 300)}`); return { ok: false, error: 'exchange_failed' }; }
}

/* X — OAuth 2.0 Authorization Code with PKCE (S256), confidential client */
defineOAuth('x', {
  role: 'Editor',
  async start(ctx) {
    await gate(ctx);
    if (env.devStubs) return stubStart(ctx);
    if (!env.xClientId || !env.xClientSecret) throw new RadarError(UNAVAILABLE, 503, 'oauth_unconfigured');
    const verifier = randomToken(48);
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    return { url: `${X_AUTHORIZE}?${q({ response_type: 'code', client_id: env.xClientId, redirect_uri: ctx.redirectUri, scope: X_SCOPES, state: ctx.state, code_challenge: challenge, code_challenge_method: 'S256' })}`, data: { v: encrypt(verifier) } };
  },
  callback: ctx => callbackFor(ctx, 'x', async () => {
    const verifier = decrypt<string>(ctx.data?.v);
    if (!verifier) throw new Error('missing PKCE verifier');
    const tokens = await xExchange(ctx.params.get('code') || '', verifier, ctx.redirectUri);
    return { tokens, id: await xMe(tokens.access_token) };
  }),
});

/* LinkedIn profile — the profile app (Sign In with LinkedIn using OpenID Connect + Share on LinkedIn) */
defineOAuth('linkedin', {
  role: 'Editor',
  async start(ctx) {
    await gate(ctx);
    if (env.devStubs) return stubStart(ctx);
    const c = liCreds('profile'); if (!c.id || !c.secret) throw new RadarError(UNAVAILABLE, 503, 'oauth_unconfigured');
    return { url: `${LI_AUTHORIZE}?${q({ response_type: 'code', client_id: c.id, redirect_uri: ctx.redirectUri, state: ctx.state, scope: LI_PROFILE_SCOPES })}` };
  },
  callback: ctx => callbackFor(ctx, 'li_profile', async () => {
    const tokens = await liExchange('profile', ctx.params.get('code') || '', ctx.redirectUri);
    return { tokens, id: await liUserinfo(tokens.access_token) };
  }),
});

/* LinkedIn page — the separate page app (Community Management API only). The page is picked in social.pages/social.connect. */
defineOAuth('linkedin_page', {
  role: 'Editor',
  async start(ctx) {
    await gate(ctx);
    if (env.devStubs) return stubStart(ctx);
    const c = liCreds('page'); if (!c.id || !c.secret) throw new RadarError(UNAVAILABLE, 503, 'oauth_unconfigured');
    return { url: `${LI_AUTHORIZE}?${q({ response_type: 'code', client_id: c.id, redirect_uri: ctx.redirectUri, state: ctx.state, scope: LI_PAGE_SCOPES })}` };
  },
  callback: ctx => callbackFor(ctx, 'li_page', async () => {
    const tokens = await liExchange('page', ctx.params.get('code') || '', ctx.redirectUri);
    return { tokens, id: await liMe(tokens.access_token) };
  }),
});
