import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));

import { and, desc, eq, inArray, like } from 'drizzle-orm';
import { db, schema } from '../db';
import { decrypt } from '../crypto';
import { Fixtures, uniq } from '../testing/fixtures';
import { createGuest } from './session';
import { createGoogleState } from './googleState';
import type { LifecyclePayload } from '../services/lifecycle/queue';
import { POST as SIGNUP } from '@/app/api/auth/signup/route';
import { POST as VERIFY } from '@/app/api/auth/verify-email/route';
import { POST as SIGNIN } from '@/app/api/auth/signin/route';
import { GET as GOOGLE } from '@/app/api/auth/google/callback/route';

const F = new Fixtures();
const prefix = `signupmail-${uniq()}`;
const request = (path: string, body: unknown) => new Request(`http://localhost:3000/api/auth/${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'x-real-ip': `${prefix}-${uniq()}` } });
async function confirm(email: string, password = 'long-enough-password') {
  const [mail] = await db.select().from(schema.outboxEmails).where(eq(schema.outboxEmails.to, email)).orderBy(desc(schema.outboxEmails.createdAt)).limit(1);
  const capture = decrypt<{ text: string }>(mail.text.slice('encrypted-auth:'.length))!;
  const token = capture.text.match(/#token=([A-Za-z0-9_-]{43})/)![1];
  return VERIFY(request('verify-email', { token, password }));
}
const mails = (uid: string) => db.select().from(schema.lifecycleEmails).where(and(eq(schema.lifecycleEmails.userId, uid), inArray(schema.lifecycleEmails.type, ['welcome', 'founder_note'])));
const welcomeData = async (uid: string) => decrypt<LifecyclePayload>((await mails(uid)).find(x => x.type === 'welcome')!.payloadEnc)!.data;
afterEach(() => { H.jar.clear(); delete process.env.RADAR_BILLING; });

describe.skipIf(!process.env.DATABASE_URL)('new-account lifecycle emails (database)', () => {
  afterAll(async () => {
    const users = await db.select({ id: schema.users.id }).from(schema.users).where(like(schema.users.email, `${prefix}%`));
    users.forEach(u => F.track(u.id)); await F.cleanup();
    await db.delete(schema.outboxEmails).where(like(schema.outboxEmails.to, `${prefix}%`));
    await db.delete(schema.rateLimits).where(like(schema.rateLimits.key, `%${prefix}%`));
  });

  it('queues welcome and founder only after mailbox confirmation, once across concurrent signup/confirmation and never sign-in', async () => {
    const email = `${prefix}-password@test.local`, password = 'long-enough-password';
    const r = await Promise.all([SIGNUP(request('signup', { name: 'Ada', email, password })), SIGNUP(request('signup', { name: 'Ada', email, password }))]);
    expect(r.map(x => x.status).sort()).toEqual([200, 200]);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    expect(await mails(user.id)).toHaveLength(0);
    expect((await SIGNIN(request('signin', { email, password }))).status).toBe(401);
    const confirmations = await Promise.all([confirm(email, password), confirm(email, password)]);
    expect(confirmations.map(r => r.status).sort()).toEqual([200, 400]);
    const rows = await mails(user.id); expect(rows.map(x => x.type).sort()).toEqual(['founder_note', 'welcome']);
    const founder = rows.find(x => x.type === 'founder_note')!, welcome = rows.find(x => x.type === 'welcome')!;
    expect(await welcomeData(user.id)).toMatchObject({ profileAnalyzed: false });
    expect((await welcomeData(user.id)).businessName).toBeUndefined();
    expect(founder.nextAttemptAt.getTime() - welcome.createdAt.getTime()).toBeGreaterThan(86390e3);
    expect(founder.nextAttemptAt.getTime() - welcome.createdAt.getTime()).toBeLessThan(86410e3);
    expect((await SIGNIN(request('signin', { email, password }))).status).toBe(200);
    expect(await mails(user.id)).toHaveLength(2);
  });

  it('captures an analyzed guest Business Profile before password signup claims the draft', async () => {
    process.env.RADAR_BILLING = 'on';
    const guest = await F.user({ guest: true }); await F.signIn(guest, H.jar);
    const draft = await F.biz(guest, { status: 'onboarding', site: { analyzedAt: new Date().toISOString() }, profile: { business: { name: 'Fieldnote Studio' } }, onboarding: { savedAt: new Date().toISOString(), step: 'save' } });
    const email = `${prefix}-analyzed-password@test.local`;
    const response = await SIGNUP(request('signup', { name: 'Ada', email, password: 'long-enough-password' }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, verificationRequired: true });
    expect(await (await confirm(email)).json()).toMatchObject({ next: '/start-trial' });
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    expect(await welcomeData(user.id)).toMatchObject({ name: 'Ada', profileAnalyzed: true, businessName: 'Fieldnote Studio' });
    expect((await db.select().from(schema.businesses).where(eq(schema.businesses.id, draft.id)))[0]).toMatchObject({ ownerId: user.id, status: 'onboarding' });
    expect(await db.select().from(schema.users).where(eq(schema.users.id, guest.id))).toHaveLength(0);
    expect(await mails(user.id)).toHaveLength(2);
  });

  it('captures an analyzed guest Business Profile before new Google signup claims it', async () => {
    process.env.RADAR_BILLING = 'on';
    const guest = await F.user({ guest: true }); await F.signIn(guest, H.jar);
    const draft = await F.biz(guest, { status: 'onboarding', site: { analyzedAt: new Date().toISOString() }, profile: { business: { name: 'North & South' } }, onboarding: { savedAt: new Date().toISOString(), step: 'save' } });
    const email = `${prefix}-analyzed-google@test.local`;
    const response = await GOOGLE(new Request(`http://localhost:3000/api/auth/google/callback?state=${await createGoogleState('/dashboard')}&code=${encodeURIComponent('dev:' + email)}`));
    expect(response.headers.get('location')).toContain('/start-trial');
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    expect(await welcomeData(user.id)).toMatchObject({ profileAnalyzed: true, businessName: 'North & South' });
    expect((await db.select().from(schema.businesses).where(eq(schema.businesses.id, draft.id)))[0].ownerId).toBe(user.id);
    expect(await db.select().from(schema.users).where(eq(schema.users.id, guest.id))).toHaveLength(0);
    expect(await mails(user.id)).toHaveLength(2);
  });

  it('does not mistake a default profile or another guest’s analyzed draft for completed analysis', async () => {
    const guest = await F.user({ guest: true }); await F.signIn(guest, H.jar);
    const older = await F.biz(guest, { status: 'onboarding', createdAt: new Date(Date.now() - 60e3), site: { analyzedAt: new Date().toISOString() }, profile: { business: { name: 'Old analysis' } } });
    const latest = await F.biz(guest, { status: 'onboarding', site: {}, profile: { business: { name: 'Default while analyzing' } } });
    const unrelated = await F.user({ guest: true });
    await F.biz(unrelated, { status: 'onboarding', site: { analyzedAt: new Date().toISOString() }, profile: { business: { name: 'Other visitor' } } });
    const email = `${prefix}-still-analyzing@test.local`;
    const response = await SIGNUP(request('signup', { name: 'Ada', email })); expect(response.status).toBe(200);
    expect((await confirm(email)).status).toBe(200);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    expect(await welcomeData(user.id)).toMatchObject({ profileAnalyzed: false });
    expect((await welcomeData(user.id)).businessName).toBeUndefined();
    expect((await db.select().from(schema.businesses).where(eq(schema.businesses.id, latest.id)))[0].ownerId).toBe(user.id);
    expect(await db.select().from(schema.businesses).where(eq(schema.businesses.id, older.id))).toHaveLength(0);
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
