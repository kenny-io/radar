import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));
import { GET as getPreferences, PATCH as patchPreferences } from '@/app/api/me/email-preferences/route';
import { POST as unsubscribe } from '@/app/api/email-preferences/route';
import { GET as openWork } from '@/app/email/open/route';
import PreferencePage from '@/app/email-preferences/page';
import { db, schema } from '@/server/db';
import { Fixtures, clearLimits } from '@/server/testing/fixtures';
import { hashPassword } from '@/server/auth/session';
import { createGoogleState } from '@/server/auth/googleState';
import { entryAfterAuth } from '@/server/billing/guard';
import { POST as signIn } from '@/app/api/auth/signin/route';
import { GET as googleCallback } from '@/app/api/auth/google/callback/route';
import { sha256 } from '@/server/crypto';
import { env } from '@/server/env';
import { getEngagementPreferences, updateEngagementPreferences, workPreferenceToken, preferenceToken, onboardingAllowed } from './preferences';
const F = new Fixtures();
const authPrefix = 'engagement-routes-' + Date.now();
const authenticatedEmails: string[] = [];
const priorBilling = process.env.RADAR_BILLING;
const request = (path: string, body: unknown, headers: Record<string, string> = {}) => new Request(new URL(path, env.appUrl), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const patch = (body: unknown, headers: Record<string, string> = {}) => patchPreferences(request('/api/me/email-preferences', body, headers));
const open = (businessId: string, kind: string, ref: string) => openWork(new Request(new URL('/email/open?' + new URLSearchParams({ businessId, kind, ref }), env.appUrl)));

describe.skipIf(!process.env.DATABASE_URL)('engagement settings, opt-out and work links (local database)', () => {
  beforeEach(() => { H.jar.clear(); process.env.RADAR_BILLING = 'off'; });
  afterEach(() => { H.jar.clear(); });
  afterAll(async () => { if (priorBilling === undefined) delete process.env.RADAR_BILLING; else process.env.RADAR_BILLING = priorBilling; for (const email of authenticatedEmails) await clearLimits(sha256(email)); await clearLimits(authPrefix); await F.cleanup(); });

  it('requires a real session and only changes that account’s explicitly chosen flags', async () => {
    expect((await getPreferences()).status).toBe(401);
    const owner = await F.user(), other = await F.user(); await F.signIn(owner, H.jar);
    const initial = await getPreferences(); expect(initial.headers.get('cache-control')).toBe('private, no-store');
    expect(await initial.json()).toEqual({ dailyBrief: false, calendarReminders: false, articleSocial: false });
    expect((await patch({ dailyBrief: true, userId: other.id })).status).toBe(400);
    const changed = await patch({ dailyBrief: true }); expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({ dailyBrief: true, calendarReminders: false, articleSocial: false });
    expect(await getEngagementPreferences(other.id)).toEqual({ dailyBrief: false, calendarReminders: false, articleSocial: false });
    expect(await (await getPreferences()).json()).toEqual({ dailyBrief: true, calendarReminders: false, articleSocial: false });
  });
  it('rejects cross-site, malformed and oversized preference changes without opting anyone in', async () => {
    const user = await F.user(); await F.signIn(user, H.jar);
    expect((await patch({ articleSocial: true }, { origin: 'https://unrelated.example' })).status).toBe(403);
    expect((await patch({ articleSocial: 'true' })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ dailyBrief: true, extra: 'x'.repeat(9000) })).status).toBe(413);
    expect(await getEngagementPreferences(user.id)).toEqual({ dailyBrief: false, calendarReminders: false, articleSocial: false });
  });
  it('keeps signed work opt-out separate from the founder preference, with safe GET and explicit POST', async () => {
    const user = await F.user(); await updateEngagementPreferences(user.id, { dailyBrief: true, calendarReminders: true, articleSocial: true });
    const token = workPreferenceToken(user.id);
    await PreferencePage({ searchParams: Promise.resolve({ token }) });
    expect((await getEngagementPreferences(user.id)).dailyBrief).toBe(true);
    expect((await unsubscribe(request('/api/email-preferences', { token: token + 'x' }))).status).toBe(400);
    expect((await unsubscribe(request('/api/email-preferences', { token }))).status).toBe(200);
    expect(await getEngagementPreferences(user.id)).toEqual({ dailyBrief: false, calendarReminders: false, articleSocial: false });
    expect(await onboardingAllowed(user.id)).toBe(true);
    await updateEngagementPreferences(user.id, { dailyBrief: true });
    expect((await unsubscribe(request('/api/email-preferences', { token: preferenceToken(user.id) }))).status).toBe(200);
    expect(await onboardingAllowed(user.id)).toBe(false);
    expect((await getEngagementPreferences(user.id)).dailyBrief).toBe(true);
  });
  it('accepts bounded RFC8058 work opt-out without a session or browser origin, and rejects other payloads', async () => {
    const user = await F.user(); await updateEngagementPreferences(user.id, { articleSocial: true });
    const token = workPreferenceToken(user.id), path = new URL('/api/email-preferences?token=' + encodeURIComponent(token), env.appUrl);
    const form = (body: string, type = 'application/x-www-form-urlencoded') => new Request(path, { method: 'POST', headers: { 'content-type': type, origin: 'https://mail-provider.example' }, body });
    expect((await unsubscribe(form('List-Unsubscribe=One-Click&dailyBrief=true'))).status).toBe(400);
    expect((await unsubscribe(form('x'.repeat(200)))).status).toBe(400);
    expect((await getEngagementPreferences(user.id)).articleSocial).toBe(true);
    expect((await unsubscribe(form('List-Unsubscribe=One-Click'))).status).toBe(200);
    expect((await getEngagementPreferences(user.id)).articleSocial).toBe(false);
  });
  it('sends signed-out links through sign-in preserving only the validated work destination', async () => {
    const user = await F.user(), business = await F.biz(user);
    const result = await open(business.id, 'brief_reply', '2026-11-04');
    expect(result.status).toBe(303);
    const signin = new URL(result.headers.get('location')!); expect(signin.pathname).toBe('/signin');
    const next = new URL(signin.searchParams.get('next')!, env.appUrl);
    expect(next.pathname).toBe('/email/open'); expect(next.searchParams.get('businessId')).toBe(business.id);
    expect(result.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect((await open(business.id, 'https://evil.example', 'ref')).status).toBe(400);
  });
  it('preserves the work destination through actual password and Google sign-in', async () => {
    const password = 'engagement-route-password';
    const user = await F.user({ password: await hashPassword(password) }), business = await F.biz(user);
    authenticatedEmails.push(user.email);
    const next = '/email/open?' + new URLSearchParams({ businessId: business.id, kind: 'article_social', ref: 'e_test' });
    const response = await signIn(request('/api/auth/signin', { email: user.email, password, next }, { 'x-real-ip': authPrefix }));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ next });
    H.jar.clear();
    const state = await createGoogleState(next);
    const google = await googleCallback(new Request(new URL('/api/auth/google/callback?' + new URLSearchParams({ state, code: 'dev:' + user.email }), env.appUrl)));
    expect(google.status).toBe(307); expect(new URL(google.headers.get('location')!).pathname).toBe('/email/open');
    expect(new URL(google.headers.get('location')!).search).toBe(new URL(next, env.appUrl).search);
  });
  it('keeps the return-path allowance narrow and does not append extra fields when claiming a saved profile', async () => {
    const user = await F.user(), business = await F.biz(user);
    const query = new URLSearchParams({ businessId: business.id, kind: 'brief_reply', ref: '2026-11-04' });
    for (const next of [
      '//evil.example/email/open?' + query,
      '/email/open/extra?' + query,
      '/api/email/open?' + query,
      '/email/open?' + query + '&next=https://evil.example',
      '/email/open?' + query + '&kind=article_social',
      '/email/open?businessId=invalid&kind=brief_reply&ref=2026-11-04',
    ]) expect((await entryAfterAuth(user, next)).next).toBe('/dashboard');
    const savedOwner = await F.user(); await F.biz(savedOwner, { status: 'onboarding', onboarding: { savedAt: new Date().toISOString() } });
    const next = '/email/open?' + query;
    expect(await entryAfterAuth(savedOwner, next)).toMatchObject({ next });
  });
  it('checks membership and business ownership before switching context, even for an active teammate', async () => {
    const owner = await F.user(), teammate = await F.user(), outsider = await F.user(), business = await F.biz(owner);
    await F.member(business.id, teammate, 'Editor');
    await F.signIn(teammate, H.jar);
    expect((await open(business.id, 'calendar_review', '2026-11-04T10:00:00Z')).status).toBe(404);
    await F.signIn(outsider, H.jar);
    expect((await open(business.id, 'calendar_review', '2026-11-04T10:00:00Z')).status).toBe(404);
    expect(H.jar.has('radar_biz')).toBe(false);
  });
  it('selects the named business and fixed feature path only for that business’s existing content', async () => {
    const owner = await F.user(), business = await F.biz(owner), other = await F.biz(owner); await F.signIn(owner, H.jar);
    await db.insert(schema.briefDays).values({ businessId: business.id, date: '2026-11-04', scannedAt: new Date().toISOString() });
    const entry = `link-${business.id}`;
    await db.insert(schema.calendarEntries).values({ id: entry, businessId: business.id, title: 'Useful article', kw: 'useful', type: 'Guide', date: '2026-11-04', status: 'review' });
    await db.insert(schema.articles).values({ entryId: entry, businessId: business.id, data: { generated: true } });
    const pack = `pack-${business.id}`;
    await db.insert(schema.socialPacks).values({ id: pack, businessId: business.id, data: {} });
    for (const [kind, ref, destination] of [
      ['brief_reply', '2026-11-04', '/brief'],
      ['article_social', entry, '/social?' + new URLSearchParams({ generate: '1', article: entry })],
      ['social_publish', pack, '/social?' + new URLSearchParams({ pack })],
    ]) {
      const result = await open(business.id, kind, ref); expect(result.status).toBe(303);
      const hop = new URL(result.headers.get('location')!);
      expect(hop.pathname).toBe('/api/b/current'); expect(hop.searchParams.get('id')).toBe(business.id); expect(hop.searchParams.get('next')).toBe(destination);
    }
    expect((await open(other.id, 'article_social', entry)).status).toBe(404);
    expect((await open(other.id, 'social_publish', pack)).status).toBe(404);
    expect((await open(other.id, 'brief_reply', '2026-11-04')).status).toBe(404);
  });
});
