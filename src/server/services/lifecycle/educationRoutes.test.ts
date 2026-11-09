import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));
import { GET, PATCH } from '@/app/api/me/education-preferences/route';
import { GET as learn } from '@/app/email/learn/route';
import { POST as unsubscribe } from '@/app/api/email-preferences/route';
import PreferencePage from '@/app/email-preferences/page';
import { educationAllowed, educationPreferenceToken, onboardingAllowed, getEngagementPreferences } from './preferences';
import { entryAfterAuth } from '@/server/billing/guard';
import { Fixtures } from '@/server/testing/fixtures';
import { env } from '@/server/env';
import { BIZ_COOKIE } from '@/server/auth/users';
const F = new Fixtures();
const request = (body: unknown, origin = env.appUrl) => new Request(env.appUrl + '/api/me/education-preferences', { method: 'PATCH', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
describe.skipIf(!process.env.DATABASE_URL)('education preferences and landing boundaries', () => {
  beforeEach(() => H.jar.clear());
  afterAll(() => F.cleanup());
  it('requires authentication, rejects foreign fields and cross-origin writes, changes only education', async () => {
    expect((await GET()).status).toBe(401);
    const user = await F.user(), other = await F.user(); await F.signIn(user, H.jar);
    expect(await (await GET()).json()).toEqual({ education: true });
    expect((await PATCH(request({ education: false, userId: other.id }))).status).toBe(400);
    expect((await PATCH(request({ education: false }, 'https://foreign.test'))).status).toBe(403);
    expect((await PATCH(request({ education: false }))).status).toBe(200);
    expect(await educationAllowed(user.id)).toBe(false); expect(await educationAllowed(other.id)).toBe(true);
    expect(await onboardingAllowed(user.id)).toBe(true); expect(await getEngagementPreferences(user.id)).toEqual({ dailyBrief: true, calendarReminders: true, articleSocial: true });
  });
  it('provides account-level controls without a business/subscription and preserves the safe auth return', async () => {
    const user = await F.user(); await F.account(user.id, { status: 'canceled' }); await F.signIn(user, H.jar);
    expect(await PreferencePage({ searchParams: Promise.resolve({}) })).toBeTruthy();
    expect(await entryAfterAuth({ ...user, appearance: 'system' }, '/email-preferences')).toEqual({ next: '/email-preferences', committed: null });
    H.jar.clear(); await expect(PreferencePage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT');
  });
  it('never mutates on a signed preference GET and accepts purpose-scoped bounded one-click optout', async () => {
    const user = await F.user(); const token = educationPreferenceToken(user.id);
    await PreferencePage({ searchParams: Promise.resolve({ token }) }); expect(await educationAllowed(user.id)).toBe(true);
    const url = env.appUrl + '/api/email-preferences?token=' + encodeURIComponent(token);
    const form = (body: string) => new Request(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://mail-provider.test' }, body });
    expect((await unsubscribe(form('List-Unsubscribe=One-Click&education=true'))).status).toBe(400);
    expect((await unsubscribe(form('List-Unsubscribe=One-Click'))).status).toBe(200);
    expect(await educationAllowed(user.id)).toBe(false); expect(await onboardingAllowed(user.id)).toBe(true);
  });
  it('preserves validated sign-in destinations, rejects unknown/duplicate params and never selects a foreign business', async () => {
    const owner = await F.user(), business = await F.biz(owner), stranger = await F.user(); await F.member(business.id, stranger);
    const path = '/email/learn?lesson=ai_visibility&businessId=' + business.id;
    const response = await learn(new Request(env.appUrl + path));
    expect(response.status).toBe(303); expect(new URL(response.headers.get('location')!).searchParams.get('next')).toBe(path);
    await F.signIn(stranger, H.jar);
    expect((await learn(new Request(env.appUrl + path))).status).toBe(404); expect(H.jar.has(BIZ_COOKIE)).toBe(false);
    expect((await learn(new Request(env.appUrl + path + '&lesson=backlinks'))).status).toBe(404);
    expect((await learn(new Request(env.appUrl + path + '&next=https://foreign.test'))).status).toBe(404);
  });
});
