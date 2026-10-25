// Every page-level gating decision (architecture §4.3, §3.4 of the handoff). Pages and auth endpoints call only these.
import { currentGuest, currentUser, type SessionUser } from '../auth/session';
import { env } from '../env';
import { DOMAIN_RE } from '@/lib/format';
import type { OnboardingStageProps, PendingProfile, TrialPageProps } from '@/lib/types';
import { accessSummary, ownAccess } from './access';
import { commitDraft, draftOf, toDraftSummary } from './draft';
import { billingState } from './state';
import { restartDueCents } from './provider';

export type Entry = { redirect: string } | { render: true; committed?: string };

/** Where a just-committed profile opens. */
export const SAVED_DASHBOARD = '/dashboard?saved=profile';
/** A server component can't set cookies, so it sends the browser through GET /api/b/current, which makes `bid` current
 *  and continues to `next` (D2: a committed profile opens on itself, not on the account's oldest business). */
export const openBusinessUrl = (bid: string, next = '/dashboard') => `/api/b/current?id=${encodeURIComponent(bid)}&next=${encodeURIComponent(next)}`;

/** Where a signed-in user belongs: (app)/layout.tsx, the auth endpoints and the Google callback. Self-heals a saved draft
 *  for a user with access (a claim by a user who already pays, or a webhook that ran before the draft was saved). */
export async function resolveEntry(u: SessionUser): Promise<Entry> {
  let a = await accessSummary(u.id);
  if (a.draft?.savedAt && a.own) {
    const bid = await commitDraft(a.draft.id);
    a = await accessSummary(u.id);
    if (bid && a.accessible.length) return { render: true, committed: bid };
  }
  if (a.accessible.length) return { render: true };          // members ride on the owner (D6)
  if (a.draft?.savedAt) return { redirect: '/start-trial' };
  if (a.ownsActive) return { redirect: '/start-trial' };     // AC-G6: returning owner without access
  return { redirect: '/onboarding' };                        // no business, or a draft not saved yet
}

/** `?domain=` as the marketing fields clean it (AC-M3): trim, lowercase, strip scheme and www., cut at / ? # or space. */
export function cleanAutoDomain(v?: string | null): string | null {
  if (!v) return null;
  const d = v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#\s]/)[0];
  return DOMAIN_RE.test(d) ? d : null;
}
const withDomain = (path: string, d: string | null) => d ? `${path}?domain=${encodeURIComponent(d)}` : path;

/** /start-trial: no user → /signup; access → commit a saved draft → /dashboard (?saved=profile when it committed); else the page. */
export async function trialGuard(): Promise<{ redirect: string } | { props: TrialPageProps }> {
  const u = await currentUser();
  if (!u) return { redirect: '/signup' };
  if (await ownAccess(u)) {
    const d = await draftOf(u.id);
    const committed = d?.onboarding?.savedAt ? await commitDraft(d.id) : null;
    return { redirect: committed ? openBusinessUrl(committed, SAVED_DASHBOARD) : '/dashboard' };
  }
  return { props: { state: await billingState(u, { restartDueCents }), publishableKey: env.stripePublishableKey || null } };
}

/** /start (anonymous onboarding): a real user goes to /onboarding; otherwise the guest's draft (or none yet). */
export async function startGuard(domain?: string | null): Promise<{ redirect: string } | { props: OnboardingStageProps }> {
  const autoDomain = cleanAutoDomain(domain);
  if (await currentUser()) return { redirect: withDomain('/onboarding', autoDomain) };
  const g = await currentGuest();
  const d = g ? await draftOf(g.id) : null;
  return { props: { actor: g ? 'guest' : 'none', user: null, draft: d ? toDraftSummary(d) : null, saveCommits: false, autoDomain } };
}

/** /onboarding (signed in): no user → /start (guest cookie) or /signup; else the user's draft. */
export async function onboardingGuard(domain?: string | null): Promise<{ redirect: string } | { props: OnboardingStageProps }> {
  const autoDomain = cleanAutoDomain(domain);
  const u = await currentUser();
  if (!u) return { redirect: (await currentGuest()) ? withDomain('/start', autoDomain) : '/signup' };
  const d = await draftOf(u.id);
  return { props: { actor: 'user', user: { name: u.name }, draft: d ? toDraftSummary(d) : null, saveCommits: await ownAccess(u), autoDomain } };
}

/** /signup and /signin: the pending variant when this browser's guest has a saved draft (AC-S2). */
export async function signupContext(): Promise<{ pending: PendingProfile | null }> {
  const g = await currentGuest();
  const d = g ? await draftOf(g.id) : null;
  if (!d?.onboarding?.savedAt) return { pending: null };
  const s = toDraftSummary(d);
  return { pending: { name: s.name, domain: s.domain, brand: s.brand } };
}

const APP_PATH = /^\/(dashboard|calendar|article|performance|profile|settings|social|brief|backlinks)(\/|\?|#|$)/;
export const safeNext = (n?: string | null) => typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : null;

/** After signup, signin or Google: invites first, then resolveEntry (claim already ran). `committed` is the business the
 *  auth route makes current (setCurrentBusiness) so the dashboard opens the profile just saved. */
export async function entryAfterAuth(u: SessionUser, next?: string | null): Promise<{ next: string; committed: string | null }> {
  const n = safeNext(next);
  if (n?.startsWith('/api/invites/')) return { next: n, committed: null };
  const e = await resolveEntry(u);
  if ('redirect' in e) return { next: e.redirect, committed: null };
  const to = n && APP_PATH.test(n) ? n : '/dashboard';
  if (!e.committed) return { next: to, committed: null };
  return { next: to + (to.includes('?') ? '&' : '?') + 'saved=profile', committed: e.committed };
}
export const destinationAfterAuth = async (u: SessionUser, next?: string | null) => (await entryAfterAuth(u, next)).next;
