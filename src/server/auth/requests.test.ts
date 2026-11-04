import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));

import { eq, inArray, like, or } from 'drizzle-orm';
import { db, schema } from '../db';
import { env } from '../env';
import { sha256 } from '../crypto';
import { Fixtures, uniq } from '../testing/fixtures';
import { SESSION_COOKIE, hashPassword } from './session';
import { AUTH_BODY_BYTES, assertAuthOrigin, authBody } from './requests';
import { consumeGoogleState, createGoogleState, GOOGLE_STATE_COOKIE } from './googleState';
import { POST as signup } from '@/app/api/auth/signup/route';
import { POST as signin } from '@/app/api/auth/signin/route';
import { GET as google } from '@/app/api/auth/google/callback/route';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const prefix = `authqa-${uniq()}`;
const email = (suffix: string) => `${prefix}-${suffix}@test.local`;
const accountLimitKeys = new Set<string>();
const request = (path: string, body: unknown, ip = `${prefix}-${uniq()}`, headers: Record<string, string> = {}) => {
  if (path === 'signin' && body && typeof (body as any).email === 'string')
    accountLimitKeys.add(`auth:signin:email:${sha256((body as any).email.trim().toLowerCase())}@900`);
  return new Request(`http://localhost:3000/api/auth/${path}`, { method: 'POST', headers: { 'x-real-ip': ip, ...headers }, body: JSON.stringify(body) });
};

afterEach(() => { H.jar.clear(); });

describe('auth request boundaries', () => {
  it('rejects browser cross-site posts and accepts same-origin or API clients without Origin', () => {
    const req = (h: Record<string, string>) => request('signup', {}, undefined, h);
    expect(() => assertAuthOrigin(req({ origin: new URL(env.appUrl).origin }))).not.toThrow();
    expect(() => assertAuthOrigin(req({}))).not.toThrow();
    const foreignHeaders: Record<string, string>[] = [{ origin: 'https://evil.test' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }];
    for (const h of foreignHeaders)
      expect(() => assertAuthOrigin(req(h))).toThrow(/permission/);
  });
  it('caps streamed bodies without relying on Content-Length and maps malformed JSON to 400', async () => {
    const req = new Request('http://localhost/auth', { method: 'POST', body: 'x'.repeat(AUTH_BODY_BYTES + 1) });
    await expect(authBody(req)).rejects.toMatchObject({ status: 413, code: 'payload_too_large' });
    await expect(authBody(new Request('http://localhost/auth', { method: 'POST', body: '{broken' })))
      .rejects.toMatchObject({ status: 400, code: 'invalid' });
  });
});

describe.skipIf(!ON)('public auth regression (database)', () => {
  afterAll(async () => {
    const created = await db.select({ id: schema.users.id }).from(schema.users).where(like(schema.users.email, `${prefix}%`));
    created.forEach(u => F.track(u.id));
    await F.cleanup();
    await db.delete(schema.rateLimits).where(or(like(schema.rateLimits.key, `auth:%:ip:${prefix}%`), inArray(schema.rateLimits.key, [...accountLimitKeys])));
  });

  it('bounds signup strings and legacy sign-in input', async () => {
    for (const change of [{ name: 'a'.repeat(201) }, { email: 'a'.repeat(321) }]) {
      const r = await signup(request('signup', { name: 'Ada', email: email(uniq()), password: 'longenough1', ...change }));
      expect(r.status).toBe(400);
    }
    expect((await signin(request('signin', { email: email('absent'), password: 'a'.repeat(1025) }))).status).toBe(400);
    expect((await signup(new Request('http://localhost/auth', { method: 'POST', headers: { 'x-real-ip': prefix + '-malformed' }, body: '{bad' }))).status).toBe(400);
  });

  it('handles simultaneous signup of one normalized email with one pending account and generic responses', async () => {
    const address = email('race');
    const responses = await Promise.all([
      signup(request('signup', { name: 'Ada', email: ` ${address.toUpperCase()} `, password: 'longenough1' })),
      signup(request('signup', { name: 'Ada', email: address, password: 'longenough1' })),
    ]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 200]);
    for (const r of responses) expect(await r.json()).toEqual({ ok: true, verificationRequired: true });
    const rows = await db.select().from(schema.users).where(eq(schema.users.email, address));
    expect(rows).toHaveLength(1);
    expect(H.jar.has(SESSION_COOKIE)).toBe(false);
  });

  it('allows sign-in for legacy passwords above bcrypt’s 72-byte limit', async () => {
    const password = 'a'.repeat(100);
    const user = await F.user({ password: await hashPassword(password) });
    expect((await signin(request('signin', { email: user.email, password }))).status).toBe(200);
  });

  it('throttles a normalized account across rotating IPs and IPs across different accounts', async () => {
    for (let i = 0; i < 10; i++) expect((await signin(request('signin', { email: email('limit'), password: 'wrong' }))).status).toBe(401);
    expect((await signin(request('signin', { email: ` ${email('limit').toUpperCase()} `, password: 'wrong' }))).status).toBe(429);
    const ip = prefix + '-ip-limit';
    for (let i = 0; i < 30; i++) expect((await signin(request('signin', { email: email('ip' + i), password: 'wrong' }, ip))).status).toBe(401);
    expect((await signin(request('signin', { email: email('ip31'), password: 'wrong' }, ip))).status).toBe(429);
  });

  it('throttles signup before validation/hash work and rejects foreign-origin auth before inserting', async () => {
    const ip = prefix + '-signup-limit';
    for (let i = 0; i < 10; i++) expect((await signup(request('signup', {}, ip))).status).toBe(400);
    expect((await signup(request('signup', {}, ip))).status).toBe(429);
    expect((await signup(request('signup', { name: 'Ada', email: email('foreign'), password: 'longenough1' }, undefined, { origin: 'https://evil.test' }))).status).toBe(403);
    expect(await db.select().from(schema.users).where(eq(schema.users.email, email('foreign')))).toHaveLength(0);
  });

  it('binds Google sign-in to its initiating browser and expires old states', async () => {
    const state = await createGoogleState('/dashboard');
    expect(H.jar.get(GOOGLE_STATE_COOKIE)).toBe(state);
    H.jar.clear();
    const r = await google(new Request(`http://localhost/api/auth/google/callback?state=${state}&code=dev`));
    expect(r.headers.get('location')).toContain('/signup?error=google');
    expect(H.jar.has(SESSION_COOKIE)).toBe(false);
    H.jar.set(GOOGLE_STATE_COOKIE, state);
    await db.update(schema.oauthStates).set({ createdAt: new Date(Date.now() - 601000) }).where(eq(schema.oauthStates.state, state));
    expect(await consumeGoogleState(state)).toBe(null);
    await db.delete(schema.oauthStates).where(eq(schema.oauthStates.state, state));
  });

  it('atomically consumes Google state once and refuses provider mismatch', async () => {
    const state = await createGoogleState('/dashboard');
    const first = await consumeGoogleState(state);
    expect(first?.data).toEqual({ next: '/dashboard' });
    H.jar.set(GOOGLE_STATE_COOKIE, state);
    expect(await consumeGoogleState(state)).toBe(null);
    const other = prefix + '-other-provider';
    await db.insert(schema.oauthStates).values({ state: other, provider: 'gsc' });
    H.jar.set(GOOGLE_STATE_COOKIE, other);
    expect(await consumeGoogleState(other)).toBe(null);
    await db.delete(schema.oauthStates).where(eq(schema.oauthStates.state, other));
  });
});
