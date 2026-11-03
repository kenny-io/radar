import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));

import { and, eq, inArray, like } from 'drizzle-orm';
import { db, schema } from '../db';
import { Fixtures, uniq } from '../testing/fixtures';
import { createGuest } from './session';
import { createGoogleState } from './googleState';
import { POST as SIGNUP } from '@/app/api/auth/signup/route';
import { POST as SIGNIN } from '@/app/api/auth/signin/route';
import { GET as GOOGLE } from '@/app/api/auth/google/callback/route';

const F = new Fixtures();
const prefix = `signupmail-${uniq()}`;
const request = (path: string, body: unknown) => new Request(`http://localhost:3000/api/auth/${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'x-real-ip': `${prefix}-${uniq()}` } });
const mails = (uid: string) => db.select().from(schema.lifecycleEmails).where(and(eq(schema.lifecycleEmails.userId, uid), inArray(schema.lifecycleEmails.type, ['welcome', 'founder_note'])));
afterEach(() => H.jar.clear());

describe.skipIf(!process.env.DATABASE_URL)('new-account lifecycle emails (database)', () => {
  afterAll(async () => {
    const users = await db.select({ id: schema.users.id }).from(schema.users).where(like(schema.users.email, `${prefix}%`));
    users.forEach(u => F.track(u.id)); await F.cleanup();
    await db.delete(schema.rateLimits).where(like(schema.rateLimits.key, `%${prefix}%`));
  });

  it('queues one welcome and delayed founder check-in for password signup, including concurrent requests, never for sign-in', async () => {
    const email = `${prefix}-password@test.local`, password = 'long-enough-password';
    const r = await Promise.all([SIGNUP(request('signup', { name: 'Ada', email, password })), SIGNUP(request('signup', { name: 'Ada', email, password }))]);
    expect(r.map(x => x.status).sort()).toEqual([200, 409]);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    const rows = await mails(user.id); expect(rows.map(x => x.type).sort()).toEqual(['founder_note', 'welcome']);
    const founder = rows.find(x => x.type === 'founder_note')!, welcome = rows.find(x => x.type === 'welcome')!;
    expect(founder.nextAttemptAt.getTime() - welcome.createdAt.getTime()).toBeGreaterThan(86390e3);
    expect(founder.nextAttemptAt.getTime() - welcome.createdAt.getTime()).toBeLessThan(86410e3);
    expect((await SIGNIN(request('signin', { email, password }))).status).toBe(200);
    expect(await mails(user.id)).toHaveLength(2);
  });

  it('queues new Google accounts once, while returning Google users receive no additional signup email', async () => {
    const email = `${prefix}-google@test.local`;
    const login = async () => GOOGLE(new Request(`http://localhost:3000/api/auth/google/callback?state=${await createGoogleState('/dashboard')}&code=${encodeURIComponent('dev:' + email)}`));
    expect((await login()).status).toBe(307);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)); expect(user).toBeDefined();
    expect((await mails(user.id)).map(x => x.type).sort()).toEqual(['founder_note', 'welcome']);
    expect((await login()).status).toBe(307);
    expect(await mails(user.id)).toHaveLength(2);
  });

  it('does not enqueue signup messages for anonymous guests', async () => {
    const guest = await createGuest(); F.track(guest.id);
    expect(await mails(guest.id)).toHaveLength(0);
  });
});
