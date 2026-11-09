import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { like } from 'drizzle-orm';
import { db, schema } from '../db';
import { env } from '../env';
import { Fixtures, uniq } from '../testing/fixtures';
import { createGoogleState } from './googleState';
import { currentUser, SESSION_COOKIE } from './session';
import { GET as google } from '@/app/api/auth/google/callback/route';
const F = new Fixtures(); const prefix = `oidc-${uniq()}`;
const saved = { devStubs: env.devStubs, googleClientId: env.googleClientId, googleClientSecret: env.googleClientSecret };
let keys: Awaited<ReturnType<typeof generateKeyPair>>, wrongKeys: Awaited<ReturnType<typeof generateKeyPair>>, jwk: any;
beforeAll(async () => { keys = await generateKeyPair('RS256'); wrongKeys = await generateKeyPair('RS256'); jwk = { ...await exportJWK(keys.publicKey), kid: 'audit-key', alg: 'RS256', use: 'sig' }; });
afterEach(() => { H.jar.clear(); Object.assign(env, saved); vi.unstubAllGlobals(); });
async function callback(overrides: Record<string, any> = {}, wrongSignature = false) {
  Object.assign(env, { devStubs: false, googleClientId: 'audit-client', googleClientSecret: 'audit-secret' });
  const claims = { sub: prefix + uniq(), email: `${prefix}-${uniq()}@test.local`, email_verified: true, aud: env.googleClientId, iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 300, ...overrides };
  const token = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'audit-key' }).sign((wrongSignature ? wrongKeys : keys).privateKey);
  const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes('/oauth2/v3/certs') ? Response.json({ keys: [jwk] }) : Response.json({ id_token: token }));
  vi.stubGlobal('fetch', fetcher);
  const state = await createGoogleState('/dashboard');
  return google(new Request(`http://localhost/api/auth/google/callback?state=${state}&code=provider-code`));
}
describe.skipIf(!process.env.DATABASE_URL)('verified Google provider identity (database)', () => {
  afterAll(async () => { const users = await db.select({ id: schema.users.id }).from(schema.users).where(like(schema.users.email, `${prefix}%`)); users.forEach(u => F.track(u.id)); await F.cleanup(); });
  it('accepts a correctly signed, verified Google identity with expected issuer/audience', async () => {
    const response = await callback(); expect(response.headers.get('location')).toContain('/onboarding'); expect(await currentUser()).not.toBeNull();
  });
  it('rejects a forged signature even when all claims look valid', async () => {
    const response = await callback({}, true); expect(response.headers.get('location')).toContain('/signup?error=google'); expect(H.jar.has(SESSION_COOKIE)).toBe(false);
  });
  it('rejects incorrect issuer/audience, expired token, and unverified email', async () => {
    for (const claims of [{ aud: 'other-client' }, { iss: 'https://evil.test' }, { exp: 1 }, { email_verified: false }, { sub: 'x'.repeat(256) }, { email: 'not-an-email' }, { email: 'guest@guest.radar.invalid' }]) {
      const response = await callback(claims); expect(response.headers.get('location')).toContain('/signup?error=google'); expect(H.jar.has(SESSION_COOKIE)).toBe(false);
    }
  });
});
