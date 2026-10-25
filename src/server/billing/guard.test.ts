// resolveEntry and the page guards (architecture §16.5, §4.3). Skipped without DATABASE_URL.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; return { jar: new Map<string, string>() }; });
vi.mock('next/headers', async () => (await import('@/server/testing/jar')).headersMock(() => H.jar));

import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { Fixtures } from '../testing/fixtures';
import type { OnboardingState } from '@/lib/types';
import { cleanAutoDomain, destinationAfterAuth, onboardingGuard, resolveEntry, signupContext, startGuard, trialGuard } from './guard';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const SAVED: OnboardingState = { step: 'save', savedAt: '2026-10-25T10:00:00.000Z', tz: 'America/Chicago' };
const status = async (bid: string) => (await db.select().from(schema.businesses).where(eq(schema.businesses.id, bid)))[0];
afterEach(() => { delete process.env.RADAR_BILLING; H.jar.clear(); });

describe('cleanAutoDomain (AC-M3 cleaning)', () => {
  it('trims, lowercases, strips scheme and www., cuts at / ? # or space, validates', () => {
    expect(cleanAutoDomain('  HTTPS://www.FieldNote.app/pricing?x=1 ')).toBe('fieldnote.app');
    expect(cleanAutoDomain('fieldnote.app#top')).toBe('fieldnote.app');
    expect(cleanAutoDomain('shop.example.co.uk extra')).toBe('shop.example.co.uk');
    expect(cleanAutoDomain('localhost')).toBeNull();
    expect(cleanAutoDomain('')).toBeNull();
    expect(cleanAutoDomain(undefined)).toBeNull();
  });
});

describe.skipIf(!ON)('resolveEntry and guards (database)', () => {
  afterAll(() => F.cleanup());

  it('billing on: the §3.4 table', async () => {
    process.env.RADAR_BILLING = 'on';
    const none = await F.user();
    expect(await resolveEntry(none)).toEqual({ redirect: '/onboarding' });           // no business
    const unsaved = await F.user(); await F.biz(unsaved, { status: 'onboarding' });
    expect(await resolveEntry(unsaved)).toEqual({ redirect: '/onboarding' });        // draft not saved yet
    const saved = await F.user(); await F.biz(saved, { status: 'onboarding', onboarding: SAVED });
    expect(await resolveEntry(saved)).toEqual({ redirect: '/start-trial' });         // saved, no access
    const lapsed = await F.user(); await F.biz(lapsed); await F.account(lapsed.id, { status: 'past_due', everSubscribed: true });
    expect(await resolveEntry(lapsed)).toEqual({ redirect: '/start-trial' });        // AC-G6: returning owner without access
    const paid = await F.user(); await F.biz(paid); await F.account(paid.id, { status: 'active' });
    expect(await resolveEntry(paid)).toEqual({ render: true });
    const member = await F.user(); const owner = await F.user(); const b = await F.biz(owner); await F.account(owner.id, { status: 'trialing' }); await F.member(b.id, member);
    expect(await resolveEntry(member)).toEqual({ render: true });                    // members ride on the owner
  });

  it('access plus a saved draft: committed once and rendered; the timezone comes from onboarding.tz', async () => {
    process.env.RADAR_BILLING = 'on';
    const u = await F.user(); await F.account(u.id, { status: 'trialing' });
    const d = await F.biz(u, { status: 'onboarding', onboarding: SAVED });
    expect(await resolveEntry(u)).toEqual({ render: true, committed: d.id });
    const row = await status(d.id);
    expect([row.status, row.timezone, !!row.onboarding.committedAt]).toEqual(['active', 'America/Chicago', true]);
    expect(await resolveEntry(u)).toEqual({ render: true });
    const ev = await db.select().from(schema.events).where(eq(schema.events.businessId, d.id));
    expect(ev.filter(e => e.kind === 'business.onboarded')).toHaveLength(1);
    const gsc = (await db.select().from(schema.gscConnections).where(eq(schema.gscConnections.businessId, d.id)))[0];
    expect(gsc.status).toBe('skipped');
  });

  it('billing off: render with a business, /onboarding without one', async () => {
    const u = await F.user(); await F.biz(u);
    expect(await resolveEntry(u)).toEqual({ render: true });
    expect(await resolveEntry(await F.user())).toEqual({ redirect: '/onboarding' });
  });

  it('destinationAfterAuth: invites first, safe app next kept, ?saved=profile when it committed', async () => {
    const u = await F.user();
    expect(await destinationAfterAuth(u, '/api/invites/abc')).toBe('/api/invites/abc');
    expect(await destinationAfterAuth(u, '/settings')).toBe('/onboarding');            // no business yet
    await F.biz(u);
    expect(await destinationAfterAuth(u, '/settings?x=1')).toBe('/settings?x=1');
    expect(await destinationAfterAuth(u, '//evil.test')).toBe('/dashboard');
    expect(await destinationAfterAuth(u, '/signup')).toBe('/dashboard');
    const v = await F.user(); await F.biz(v, { status: 'onboarding', onboarding: SAVED });
    expect(await destinationAfterAuth(v, null)).toBe('/dashboard?saved=profile');       // flag off: saved draft commits
  });

  it('startGuard, onboardingGuard and signupContext', async () => {
    expect(await startGuard('WWW.Fieldnote.app/x')).toEqual({ props: { actor: 'none', user: null, draft: null, saveCommits: false, autoDomain: 'fieldnote.app' } });
    expect(await onboardingGuard('fieldnote.app')).toEqual({ redirect: '/signup' });
    expect(await signupContext()).toEqual({ pending: null });
    const g = await F.user({ guest: true }); await F.signIn(g, H.jar);
    const d = await F.biz(g, { status: 'onboarding', domain: 'fieldnote.app', onboarding: { step: 'gsc' } });
    const s = await startGuard('fieldnote.app');
    expect(s).toMatchObject({ props: { actor: 'guest', saveCommits: false, autoDomain: 'fieldnote.app', draft: { id: d.id, step: 'gsc', savedAt: null } } });
    expect(await onboardingGuard('fieldnote.app')).toEqual({ redirect: '/start?domain=fieldnote.app' });
    expect(await signupContext()).toEqual({ pending: null });                          // not saved yet → default variant
    await db.update(schema.businesses).set({ onboarding: SAVED }).where(eq(schema.businesses.id, d.id));
    expect(await signupContext()).toEqual({ pending: { name: 'Fieldnote', domain: 'fieldnote.app', brand: { logo: null, primary: '#1F4D3A', secondary: '#F2B544' } } });
    H.jar.clear();
    const u = await F.user({ name: 'Ada' }); await F.signIn(u, H.jar);
    expect(await startGuard('fieldnote.app')).toEqual({ redirect: '/onboarding?domain=fieldnote.app' });
    expect(await startGuard()).toEqual({ redirect: '/onboarding' });
    expect(await onboardingGuard(null)).toEqual({ props: { actor: 'user', user: { name: 'Ada' }, draft: null, saveCommits: true, autoDomain: null } });
    process.env.RADAR_BILLING = 'on';
    expect(await onboardingGuard(null)).toMatchObject({ props: { saveCommits: false } });
  });

  it('trialGuard: /signup without a user; /dashboard with access (committing a saved draft); else the page props', async () => {
    expect(await trialGuard()).toEqual({ redirect: '/signup' });
    const u = await F.user(); await F.signIn(u, H.jar);
    expect(await trialGuard()).toEqual({ redirect: '/dashboard' });                    // billing off
    process.env.RADAR_BILLING = 'on';
    const d = await F.biz(u, { status: 'onboarding', onboarding: SAVED });
    const r: any = await trialGuard();
    expect(r.props.publishableKey).toBeNull();
    expect(r.props.state).toMatchObject({ enforced: true, provider: 'stub', access: false, status: 'none', mode: 'trial', needsRestart: false, trialEndIsPreview: true, dueTodayCents: 100, priceCents: 5000, trialDays: 3, hasDraft: true, draft: { id: d.id } });
    expect(Math.abs(new Date(r.props.state.trialEnd).getTime() - (Date.now() + 72 * 3600e3))).toBeLessThan(5000);
    await F.account(u.id, { status: 'trialing' });
    expect(await trialGuard()).toEqual({ redirect: '/dashboard?saved=profile' });
    expect(await trialGuard()).toEqual({ redirect: '/dashboard' });
  });
});
