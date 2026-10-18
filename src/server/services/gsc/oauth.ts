// Search Console OAuth provider — defineOAuth('gsc', …). Scope webmasters.readonly, offline access (refresh token), consent prompt.
// The refresh token is stored encrypted on gsc_connections; the connection status does not change until a property is connected (gsc.connect).
import { defineOAuth } from '../../oauth/registry';
import { env } from '../../env';
import { RadarError } from '../../errors';
import { exchangeCode, GSC_SCOPE, saveTokens } from './client';

/** Dev stub when running with RADAR_DEV_STUBS=1 and no Google OAuth client configured. */
export const gscStubbed = () => env.devStubs && !env.googleClientId;

defineOAuth('gsc', {
  role: 'Editor',
  async start({ state, redirectUri }) {
    if (gscStubbed()) return { url: `${redirectUri}?state=${encodeURIComponent(state)}&code=dev` };
    if (!env.googleClientId || !env.googleClientSecret) throw new RadarError('Search Console isn’t available right now.', 503, 'not_configured');
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.search = new URLSearchParams({ client_id: env.googleClientId, redirect_uri: redirectUri, response_type: 'code', scope: GSC_SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state }).toString();
    return { url: u.toString() };
  },
  async callback({ bid, params, redirectUri }) {
    const code = params.get('code');
    if (!code) return { ok: false, error: 'denied' };
    if (gscStubbed()) { await saveTokens(bid, { stub: true }); return { ok: true }; }
    const t = await exchangeCode(code, redirectUri);
    // The user can untick the Search Console permission on Google's consent screen.
    if (t.scope && !t.scope.split(' ').includes(GSC_SCOPE)) return { ok: false, error: 'scope_denied' };
    await saveTokens(bid, t);
    return { ok: true };
  },
});
