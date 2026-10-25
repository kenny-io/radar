# Architecture: signup gating, anonymous onboarding, $1-then-trial billing (T1)

This is the design record for `brief.md` (AC-G1…G10, AC-P1…P8, AC-S1…S2, AC-R1…R2, D1–D8).
- Written against worktree `radar-update-branch-cd9f3e`, branch `kenny-dev/marketing-trial-gating`, base `origin/main` @ `ea70ecb2`.
- Marketing pages (AC-M*) belong to T2 and are out of scope here, except where noted under file ownership.

**Contracts.** The shared contracts in §5 (types, endpoint shapes, error codes) are fixed. T3 writes them into `src/lib/types.ts` and `src/lib/billing.ts` **first**, before any other T3 or T4 work. Neither engineer changes them without asking the PM.

## 1. Design in one page

**Identity: guests**
- A **guest is a `users` row** with `guest = true`.
  - It has a synthetic email `guest+<uuid>@guest.radar.invalid` and an empty name.
  - Its token lives in the existing `sessions` table, under its **own cookie `radar_guest`** (72h).
- `currentUser()` never returns a guest. It reads only `radar_session` and also filters `guest = false`.
- A new `currentActor()` returns `user | guest`. Only these use it:
  - `POST /api/b`;
  - `/api/b/:bid/{act,workspace,events}`;
  - GSC OAuth start and callback.

**One draft per owner**
- The onboarding business (`status = 'onboarding'`) *is* the draft, as today.
- New column `businesses.onboarding jsonb` holds `{step, savedAt, tz}`. It serves Back links, resume and "saved but unpaid".

**Save never activates without access**
- `onboarding.save` flushes edits and marks the draft saved.
- It commits (`status → active`) only when the actor has access.
- Otherwise the server commits it when the subscription is created: confirm endpoint or webhook, whichever comes first.

**Claim**
- Signup, signin and the Google callback read `radar_guest` before `createSession`.
- In one transaction they move the draft to the user: owner, member row, and everything keyed by `business_id` (GSC tokens, crawl pages, jobs, logo).
- Then they delete the guest and clear the cookie.

**Access**
- `ownAccess(actor)` is **always false for a guest**, whatever the flag says. For a real user it is true when any of these holds:
  - billing is not enforced for the user;
  - the user is comp: a `comp` row, or lazily, an owner of an active business created before the grandfather cutoff;
  - the subscription status is `trialing` or `active`.
- `hasAccess(user, business)` = the user is an active member of the business **and** `ownAccess(owner)`.
- Members ride on the owner's subscription (D6).

**Gates**
- **Pages:** `(app)/layout.tsx` calls `resolveEntry()`. `/start`, `/onboarding` and `/start-trial` have their own small guards. All guard logic lives in `src/server/billing/guard.ts`.
- **API:** act, workspace and events:
  - refuse (402) an `active` business without access;
  - restrict a draft to the onboarding allowlist when the actor lacks own access;
  - refuse (404) a guest anywhere except its own draft.

**Stripe**
- REST over `fetch`, with no `stripe` npm package. Every POST carries an `Idempotency-Key`, and `Stripe-Version` is pinned.
- The client uses `@stripe/stripe-js` split Card Elements (D5).
- Sequence: the client creates a PaymentMethod, then `POST /api/billing/start` runs the fingerprint check and creates a $1 PaymentIntent, then the client calls `confirmCardPayment` (3DS), then `POST /api/billing/confirm` runs `activate()`.
  - `activate()` creates the Subscription exactly once (advisory lock plus idempotency key) and commits the draft.
  - The `payment_intent.succeeded` webhook runs the same `activate()`.
  - Other webhooks re-fetch the subscription and store its status.

**Abuse**
- Postgres fixed-window rate limits on guest creation and on `onboarding.analyze` for any actor without own access.
- A Turnstile seam (no-op until keyed).
- An hourly cleanup of guests with no live session after 24h or more.

**Rollout**
- `RADAR_BILLING` is off by default. While off: no gate for signed-in users, `/start` works, and Save commits for signed-in users. A guest's Save always goes to `/signup`.
- Existing owners are grandfathered lazily inside `ownAccess`: an owner of an active business created before `RADAR_BILLING_GRANDFATHER_BEFORE` counts as comp, and a `comp` row is upserted on first use. An idempotent batch backfill also runs.
- Rollback = flag off.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| B1 | A guest is a `users` row (`guest=true`, synthetic `.invalid` email) with its own `radar_guest` cookie, stored in `sessions` | Reuses `members`, `requireRole`, business ownership and `gsc_connections` unchanged. No NOT NULL or UNIQUE constraint changes. The separate cookie plus the `guest=false` filter make "`currentUser()` never returns a guest" true by construction |
| B2 | The guest is created inside `POST /api/b` (a route handler), not in the `/start` page | Next 15 server components can only *read* cookies. The route handler is also the one place to rate-limit and to run the human-check seam |
| B3 | The draft is the existing onboarding business, plus `businesses.onboarding jsonb {step, savedAt, tz}` | Keeps `Onboarding.tsx`'s workspace, SSE and job plumbing. "Saved but unpaid" and resume need server state, and a jsonb column is the smallest change |
| B4 | Save does not commit without access. Commit happens server-side at activation, or at Save when the actor has access | Activating before payment would let a direct URL skip the gate. Server-side commit means a closed tab after paying never strands the profile. The draft stays editable for "Back to your profile" |
| B5 | Claim at all three auth entry points, in one transaction that takes a `FOR UPDATE` lock on the guest user | AC-G5. The lock makes double submits and two tabs safe. Everything is keyed by `business_id`, so moving the owner and the member row moves GSC tokens, crawl pages, jobs and logo with no copying |
| B6 | If the user already owns a draft, the guest draft replaces it and the old one is deleted (tracked) | "One draft per owner" stays true. The guest draft is the one the user just worked on |
| B7 | API gate: an `active` business without access returns 402. A draft held by an actor without own access gets an allowlist. A guest outside its own draft gets 404 | AC-G4. Without the allowlist, any signed-up user without access could call every action (drafting, visibility, re-analyze) on their own draft for free |
| B8 | Stripe over REST, not the SDK. `Stripe-Version` pinned by env with a code default. Webhooks are handled fetch-on-event | Matches every other integration in the repo (`fetch`; only S3 and framer have SDKs). About 12 endpoints. Re-fetching makes event order and payload version irrelevant, which matters because Basil (2025-03-31) moved invoice→subscription fields and period fields |
| B9 | `@stripe/stripe-js` (loader and types) on the client, without `@stripe/react-stripe-js` | js.stripe.com must be loaded from Stripe for PCI scope. Mounting three split elements by hand is short |
| B10 | $1 PaymentIntent first, then a Subscription with `trial_end`. Not `add_invoice_items` on a trialing subscription | AC-P3 says a $1 PaymentIntent. It leaves room to check the fingerprint before charging and leaves no subscription on decline. The idempotent `activate()` covers the two-step risk |
| B11 | `trial_end` is computed once, at `start`. It is persisted in `billing_accounts.pending_trial_end` and in the PaymentIntent metadata, and it is part of the idempotency key | D7 and AC-P6. Retries resend identical parameters; Stripe rejects a reused key with different parameters. The subscription uses `metadata.trial_end` exactly |
| B12 | Dates are shown in the **browser's** time zone, formatted after mount | No business time zone exists before payment. Stripe charges at the `trial_end` instant, and the user experiences that instant in their own zone. Formatting after mount avoids a hydration mismatch |
| B13 | Lapsed means `past_due`/`unpaid` (pay the open invoice) or `canceled`/`incomplete_expired`/`paused` (new subscription at $50 now, no trial). Mode `restart` on the same page | AC-P7. It uses Stripe's own recovery path for past_due, and a lapsed account never gets a second trial |
| B14 | Repeat trials are blocked by `card.fingerprint` in `trial_fingerprints`, checked before the $1 charge and recorded at activation | AC-P8. A race between two accounts using one card at the same moment is accepted |
| B15 | Rate limits use a Postgres fixed-window table. They apply to analysis by **any actor without own access**, not only guests | Applying them only to guests would let a free signup bypass them. No Redis in the stack |
| B16 | Onboarding moves to standalone routes `/start` (guest) and `/onboarding` (user), drawn over a static, `inert` shell backdrop. The in-app modal stays only for "Add a business" | Guests can't enter `(app)`. The prototype shows onboarding over the shell. Layouts don't receive the pathname, so this needs separate routes |
| B17 | Billing off means no gate for signed-in users. Routing (`/onboarding`, `/start`) is the same with the flag on or off. A guest never has own access, so the draft allowlist, the analysis rate limits and "Save → /signup" apply to guests in every flag state | One code path to test. The flag changes only `ownAccess()` for real users. If a guest could commit, the business would become `active` under the guest, and claim (which moves only `onboarding` drafts) would lose it |
| B18 | Grandfathering is lazy, inside `ownAccess`: a user who owns an active business with `created_at < RADAR_BILLING_GRANDFATHER_BEFORE` is comp, and a `comp` row is upserted on first use. A batch backfill (`billing.grandfather`, idempotent, no `once()`) runs at worker start and hourly | The web process enforces billing the moment the flag flips. A worker-only insert would lock grandfathered owners out until it ran. A data insert in migration 0007 would miss owners who sign up between deploy and the flip, and would mean hand-editing a generated migration (AC-R2) |
| B19 | If `RADAR_BILLING` is on but no provider is configured (no key, no stub), billing fails **open** (treated as off), with a `console.error` on every guard call | Locking every new user out over a missing secret is worse than a short free window. The LAUNCH checklist step catches it |
| B20 | Auth endpoints return `{ok, next}`, computed server-side by `resolveEntry()`. The Google callback redirects to the same place | One function decides where a user lands, for the guard, for auth and after a claim |

## 3. Data model: migration `0007_trial_gating.sql` (generated from `schema.ts` by `npm run db:generate`)

```ts
// users: add
guest: boolean('guest').notNull().default(false),
// index: users_guest_created_idx on (created_at) where guest  (cleanup scan)

// businesses: add
onboarding: jsonb('onboarding').$type<OnboardingState>().notNull().default({}),

export const billingAccounts = pgTable('billing_accounts', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  stripeCustomerId: text('stripe_customer_id').unique(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),   // current subscription (a restart replaces it)
  status: text('status').$type<SubStatus>().notNull().default('none'),
  trialEnd: timestamp('trial_end', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  comp: boolean('comp').notNull().default(false),
  compReason: text('comp_reason'),                                  // 'grandfather' | 'manual'
  everSubscribed: boolean('ever_subscribed').notNull().default(false), // set when any subscription is created; drives trial vs restart
  trialPaymentIntentId: text('trial_payment_intent_id'),            // latest $1 PI
  pendingTrialEnd: timestamp('pending_trial_end', { withTimezone: true }),
  pendingPaymentMethodId: text('pending_payment_method_id'),
  pendingSetAt: timestamp('pending_set_at', { withTimezone: true }),
  trialStartedAt: timestamp('trial_started_at', { withTimezone: true }), // set once; guards trial.started tracking
  createdAt: created(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const trialFingerprints = pgTable('trial_fingerprints', {
  fingerprint: text('fingerprint').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  paymentIntentId: text('payment_intent_id').notNull(),
  createdAt: created(),
});

export const billingEvents = pgTable('billing_events', {            // webhook dedupe and audit
  id: text('id').primaryKey(),                                      // Stripe event id
  type: text('type').notNull(),
  receivedAt: created(),
  processedAt: timestamp('processed_at', { withTimezone: true }),   // null until a handler succeeds
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),                                    // short message, never the payload
});

export const rateLimits = pgTable('rate_limits', {
  key: text('key').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull().default(0),
}, t => [primaryKey({ columns: [t.key, t.windowStart] }), index('rate_limits_window_idx').on(t.windowStart)]);
```

**Notes**
- **No data migration.** The grandfather step is code (B18).
- `members.email` for a guest is the synthetic email, so the unique `(business_id, email)` constraint stays satisfied.
- `businesses.owner_id` has **no ON DELETE**. Any code that deletes a user must delete or move their businesses first: claim and cleanup both do.
- Billing columns live on the user because billing is per account (D6).

## 4. States and guards

### 4.1 Subscription status → access

| Stripe `subscription.status` | `ownAccess` | `/start-trial` mode | How it recovers |
|---|---|---|---|
| (no row) / `none` | no | `trial` (or `restart` if `everSubscribed`) | $1 then a subscription |
| `trialing`, `active` | **yes** | → `/dashboard` | — |
| `incomplete` | no | `restart` if `everSubscribed`, else `trial` | the confirm call; it expires after 23h |
| `past_due`, `unpaid` | no | `restart` | pay the open `latest_invoice` with a new card |
| `canceled`, `incomplete_expired`, `paused` | no | `restart` | a new subscription, $50 charged now, no trial |
| `comp = true` (ours) | **yes** | → `/dashboard` | webhooks never touch `comp` |

- `cancel_at_period_end` keeps access until Stripe sends `canceled`.
- `past_due` gates immediately (§3.4 literal).

### 4.2 Draft lifecycle

```
none ─POST /api/b─▶ draft{step} ─onboarding.save─▶ saved{savedAt}
  saved + ownAccess(owner)                         ─commitDraft─▶ business.status = active
  guest draft ─claim(signup|signin|google)─▶ user draft (same row, same state)
  domain change (POST /api/b, other domain) ─▶ same row reset; GSC revoked and deleted, crawl_pages deleted, onboarding = {}
  guest with no live session for 24h+ ─cleanup─▶ deleted
```

`commitDraft(bid)` is the only path to `active`. It is idempotent.
1. Run `UPDATE businesses SET status='active', timezone=COALESCE(validTz(onboarding.tz), timezone), onboarding = onboarding || {committedAt} WHERE id=$1 AND status='onboarding' RETURNING id`.
2. If a row came back:
   - mark GSC `skipped` if it was never connected (moved from `onboarding.finish`);
   - `track('business.onboarded', {bid, uid: ownerId})`;
   - `bump(bid)`.
3. Return whether it committed.

### 4.3 Guard functions (`src/server/billing/guard.ts`, T3). Pages only call these.

```ts
type Entry = { redirect: string } | { render: true; committed?: string /* bid */ };

// Used by (app)/layout.tsx, by the auth endpoints and by the Google callback.
async function resolveEntry(u: SessionUser): Promise<Entry> {
  let a = await accessSummary(u.id);
  if (a.draft?.savedAt && a.own) {                       // self-heal; also a claim by a user who already has access
    const bid = await commitDraft(a.draft.id);           // bid when this call committed it, else null
    a = await accessSummary(u.id);
    if (bid && a.accessible.length) return { render: true, committed: bid };
  }
  if (a.accessible.length) return { render: true };      // members ride on the owner (D6)
  if (a.draft?.savedAt) return { redirect: '/start-trial' };
  if (a.ownsActive) return { redirect: '/start-trial' }; // AC-G6: returning owner without access
  return { redirect: '/onboarding' };                    // no business, or a draft not saved yet
}

// (app)/layout.tsx
const u = await currentUser(); if (!u) redirect('/signup');
const e = await resolveEntry(u); if ('redirect' in e) redirect(e.redirect);
const me = await getMe(u);           // currentId is chosen only among accessible businesses
// render AppProvider + AppShell as today

// /start-trial  ((auth)/start-trial/page.tsx)
async function trialGuard(): Promise<{ redirect: string } | { props: TrialPageProps }>
//   no user → /signup
//   ownAccess → commit a saved draft if one exists → '/dashboard' (+ '?saved=profile' if it committed)
//   else → props (BillingState + publishableKey)

// /start  ((onboard)/start/page.tsx)
async function startGuard(domain?: string): Promise<{ redirect: string } | { props: OnboardingStageProps }>
//   real user → /onboarding?domain=…
//   else → props { actor: guest ? 'guest' : 'none', draft: guest's draft, saveCommits: false, autoDomain }

// /onboarding  ((onboard)/onboarding/page.tsx)
async function onboardingGuard(domain?: string): Promise<…>
//   no user → guest cookie ? /start?domain=… : /signup
//   else → props { actor: 'user', user: {name}, draft, saveCommits: ownAccess, autoDomain }

// /signup and /signin pages (logic unchanged for a signed-in user: redirect to safe next or /dashboard)
async function signupContext(): Promise<{ pending: PendingProfile | null }>
//   guest whose draft has savedAt → pending variant data; else null
```

**`ownAccess(actor)`**:
1. `actor.guest` → false.
2. Billing not enforced for the user → true.
3. `billing_accounts.comp` → true.
4. Status `trialing` or `active` → true.
5. Otherwise, if `RADAR_BILLING_GRANDFATHER_BEFORE` is set and the user owns an active business with `created_at` before it: upsert `billing_accounts(comp = true, comp_reason = 'grandfather')` and return true.
6. Otherwise false.

`bizAccess(biz)` = `ownAccess(owner)`, where the owner is never a guest, because guests only own onboarding drafts.

`accessSummary(uid)` costs one query when billing is enforced and none when it isn't. It returns:

```ts
interface AccessSummary {
  enforced: boolean; own: boolean; status: SubStatus | 'comp';
  accessible: string[];   // active businesses where the user is an active member and ownAccess(owner)
  ownsActive: boolean;    // owns one or more active businesses
  draft: { id: string; domain: string; savedAt: string | null } | null;
}
```

**Auth destination** (`destinationAfterAuth(u, next)`):
1. If `next` starts with `/api/invites/`, return it. Invites always come first.
2. Otherwise run `resolveEntry(u)`:
   - redirect → that path;
   - render → the safe `next` if it is an app path (else `/dashboard`), plus `?saved=profile` when `committed`.

### 4.4 API gate (`src/server/access.ts`, T3)

```ts
// Actor = SessionUser & { guest: boolean }. A guest only ever has an Owner member row on its own draft.
async function requireActor(): Promise<Actor>           // currentUser() ?? currentGuest() ?? throw unauthorized()
export const DRAFT_ACTIONS = new Set(['onboarding.analyze', 'onboarding.step', 'onboarding.save', 'onboarding.finish',
  'profile.update', 'job.get', 'gsc.properties', 'gsc.connect']);   // profile.update covers the logo data-URL upload

async function gateBusiness(actor: Actor, bid: string, action?: string) {
  const biz = await getBizRow(bid);                       // 404 when missing
  if (biz.status === 'onboarding') {
    if (biz.ownerId !== actor.id) throw notFound();       // drafts belong to their owner only
    if (action && !DRAFT_ACTIONS.has(action) && !(await ownAccess(actor))) throw subscriptionRequired();
  } else {
    if (actor.guest) throw notFound();
    if (!(await bizAccess(biz))) throw subscriptionRequired();   // 402, code 'subscription_required'
  }
}
```

**Order in `act`:**
1. `requireActor`.
2. `ACTIONS[action]` lookup.
3. `requireRole(bid, actor.id, …)`.
4. `gateBusiness(actor, bid, action)`.
5. Parse the input.
6. Run with `ActCtx` extended by `{ actor: { guest, ownAccess }, ip }`.

`workspace` and `events` call `gateBusiness(actor, bid)` once. SSE checks at open only, not on every 600ms tick. GSC OAuth start and callback allow a guest only for provider `gsc` and only on its own draft. The callback compares `oauth_states.user_id` with `currentActor().id`.

**Rate-limit hook.** `onboarding.analyze` calls `limitAnalysis(ctx)` before enqueueing, when `!ctx.actor.ownAccess` (§8).

## 5. Shared contracts (T3 writes these first; T4 consumes)

### 5.1 `src/lib/billing.ts` (constants only, imported by server and client)

```ts
export const TRIAL_DAYS = 3;
export const FEE_CENTS = 100;
export const PRICE_CENTS = 5000;   // display only; must match STRIPE_PRICE_ID (start logs an error on mismatch)
export const SUB_STATUSES = ['none','incomplete','incomplete_expired','trialing','active','past_due','unpaid','canceled','paused'] as const;
```

### 5.2 `src/lib/types.ts` additions

```ts
export type SubStatus = 'none' | 'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'unpaid' | 'canceled' | 'paused';
export type DraftStep = 'review' | 'gsc' | 'save';            // 'domain'/'analyzing' are derived from jobs, as today
export interface OnboardingState { step?: DraftStep; savedAt?: string; tz?: string; committedAt?: string }
export interface DraftSummary {
  id: string; domain: string; name: string;
  brand: Pick<Brand, 'logo' | 'primary' | 'secondary'>;
  step: DraftStep | null; savedAt: string | null; analyzed: boolean;
}
export type PendingProfile = Pick<DraftSummary, 'name' | 'domain' | 'brand'>;   // signup pending variant (AC-S2)

export interface BillingState {
  enforced: boolean;                    // false → billing off for this user; page redirects
  provider: 'stripe' | 'stub' | 'none';
  access: boolean;                      // ownAccess
  status: SubStatus | 'comp';
  mode: 'trial' | 'restart' | 'none';   // 'none' when access
  needsRestart: boolean;                // mode === 'restart'
  trialEnd: string | null;              // ISO: the subscription's trial_end, else pending, else preview (now + 3d)
  trialEndIsPreview: boolean;
  currentPeriodEnd: string | null;      // ISO, for the restart success copy
  dueTodayCents: number;                // 100 for a trial; an open invoice's amount_due or PRICE_CENTS for a restart
  priceCents: number; trialDays: number;
  hasDraft: boolean;                    // drives "Back to your profile" (AC-G8)
  draft: DraftSummary | null;
}
export interface TrialPageProps { state: BillingState; publishableKey: string | null }   // key is read on the server, not NEXT_PUBLIC_*
export interface OnboardingStageProps {
  actor: 'guest' | 'user' | 'none';     // 'none' = /start before the first POST /api/b
  user: { name: string } | null;
  draft: DraftSummary | null;
  saveCommits: boolean;                 // SaveStep label: true → "Save profile & open dashboard"
  autoDomain: string | null;            // cleaned and validated ?domain=
}
export interface AuthResult { ok: true; next: string }

// existing types, changed:
//   BusinessSummary: + access: boolean   (false → locked; the switcher hides it; never chosen as currentId)
//   Workspace:       + onboarding: OnboardingState
```

### 5.3 Endpoints (new or changed)

`handle()` returns errors as `{ok:false, error, code}`, where `error` is user-facing copy (§10). Field errors keep the existing `{errors:{field:msg}}` shape.

**Auth**

| Method and path | Auth | Input | Output | Errors |
|---|---|---|---|---|
| `POST /api/auth/signup` | none | `{name, email, password, next?}` | `AuthResult` (claims the guest, then `createSession`, clears `radar_guest`) | 400 field errors (as today, plus `@guest.radar.invalid` rejected as an invalid email), 409 duplicate |
| `POST /api/auth/signin` | none | `{email, password, next?}` | `AuthResult` (filters `guest=false`, now calls `attachInvites`, claims) | 401 `{errors:{pw}}` as today |
| `GET /api/auth/google/callback` | state | — | 302 to `destinationAfterAuth` (claims; the Lax `radar_guest` cookie arrives on the top-level redirect) | 302 `/signup?error=google` as today |
| `POST /api/auth/signout` | user | — | `{ok}`; clears both cookies | — |

**Business**

| Method and path | Auth | Input | Output | Errors |
|---|---|---|---|---|
| `POST /api/b` | actor, or none (creates a guest) | `{domain, turnstileToken?}` | `{ok, id, guest: boolean}`. Same domain as the actor's draft: reset as today but **keep** GSC. Other domain: also revoke and delete the draft's GSC row and crawl_pages, and set `onboarding = {}` | 400 domain, 429 `rate_limited`, 403 `human_check_failed` |
| `POST /api/b/:bid/act` | actor | unchanged | unchanged | + 402 `subscription_required`, 404 for a guest outside its draft, 429 `rate_limited`, 503 `busy` |
| `GET /api/b/:bid/workspace` and `/events` | actor | — | unchanged (+ `Workspace.onboarding`) | + 402 / 404 as above |
| `GET /api/oauth/gsc/start` and `/callback` | actor (guest only on its own draft) | unchanged | unchanged | 404 |

**New and changed actions** (registered in `src/server/actions/onboarding.ts`)

| Action | Role | Input | Output (`data`) |
|---|---|---|---|
| `onboarding.step` | Owner | `{step: DraftStep}` | `{}`. Sets `onboarding.step` |
| `onboarding.save` | Owner | `{tz: string}` | `{committed: boolean, next: '/dashboard' \| '/signup' \| '/start-trial'}`. Sets `savedAt`, `tz` and `step:'save'`; commits iff `ownAccess(actor)` |
| `onboarding.finish` | Owner | `{tz}` | Deprecated alias of `save`, kept for open tabs. `ACTION_OUTCOME['onboarding.finish']` is removed; `commitDraft` tracks `business.onboarded` |

**Billing** (`src/app/api/billing/**`, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`)

| Method and path | Auth | Input | Output | Errors |
|---|---|---|---|---|
| `GET /api/billing/state` | user | — | `BillingState` | 401 |
| `POST /api/billing/start` | user | `{paymentMethodId}` | `{ok, clientSecret, paymentIntentId, trialEnd}` or `{ok, activated: true, state}` (a previous $1 already succeeded) | 401; 409 `already_active`; 409 `restart_required`; 409 `trial_used`; 400 `invalid_payment_method`; 429 `rate_limited`; 503 `billing_unavailable` |
| `POST /api/billing/restart` | user | `{paymentMethodId}` | `{ok, clientSecret, subscriptionId}` or `{ok, activated: true, state}` | 401; 409 `already_active`; 409 `not_lapsed` (never subscribed: use start); 400; 429; 503 |
| `POST /api/billing/confirm` | user | `{paymentIntentId}` or `{subscriptionId}` | `{ok, state}`. Sets `radar_biz` to the committed business | 401; 403 `not_yours`; 409 `payment_not_succeeded`; 502 `activation_failed` |
| `POST /api/billing/webhook` | Stripe signature | raw body | 200 `{received:true}` | 400 bad signature; 500 handler failure (Stripe retries) |
| `POST /api/billing/dev/confirm-intent` | user, stub only | `{paymentIntentId, outcome: 'succeed'\|'decline'\|'auth_fail'}` | the stripe-js result shape `{paymentIntent?, error?}` | 404 unless provider = stub |
| `POST /api/billing/dev/simulate` | user, stub only | `{status: SubStatus}` | `{ok, state}`. Runs the same `syncSubscription` path as a webhook | 404 unless stub |

**Client handling rules (T4)**
- `api()` calls that get 402 `subscription_required` → `location.assign('/start-trial')`. This goes in `src/client/app.tsx`, next to the existing 401 handling.
- After Signup or Google → `window.location.href = r.next`.
- One-shot toasts on `/dashboard`, after which the query string is removed with `history.replaceState`:
  - `?started=trial` → "Your free trial has started.";
  - `?saved=profile` → "Business Profile saved".

## 6. Guest session and claim

**Cookie and session**
- Cookie `radar_guest`: httpOnly, `sameSite: 'lax'`, `secure` in production, `path: '/'`.
- The `sessions` row expires 72h after creation. Each write by a guest (`act` writes, `POST /api/b`) extends it, at most once an hour.
- `currentGuest()` joins `sessions` to `users`, where `guest = true` and the session hasn't expired.

**`claimGuest(tx, guestId, user)`**, called by all three auth routes before `createSession`:

1. `SELECT … FROM users WHERE id = guestId AND guest FOR UPDATE`. If the row is missing (cleaned up, or a second tab already claimed it), clear the cookie and return `{claimed: null}`.
2. `g = draftOf(guestId)`. If there is none, delete the guest and return `{claimed: null}`.
3. Look up the user's own draft (`owner_id = user.id AND status = 'onboarding'`). If it exists:
   - revoke its GSC tokens (best effort, after commit);
   - delete the business (cascade);
   - `track('onboarding.draft_replaced', {uid, bid: old})`.
4. `UPDATE businesses SET owner_id = user.id WHERE id = g.id`.
5. `UPDATE members SET user_id = user.id, email = lower(user.email) WHERE business_id = g.id AND user_id = guestId`.
6. Reassign the guest's events to the user (`events.user_id`), then delete its `oauth_states` rows.
7. `DELETE FROM users WHERE id = guestId`. This cascades the guest's sessions.
8. Commit, clear the cookie, `track('onboarding.claimed', {uid, bid: g.id})`, return `{claimed: g.id}`.
9. Then `destinationAfterAuth()`, which commits the draft if the user has access and it is saved.

**Edge cases**

| Case | Result |
|---|---|
| Invite `next` plus a guest draft | Claimed, kept as the user's draft. They land on the invite |
| User already has an active business with the same domain | Allowed. Duplicate domains are already possible |
| Analysis job running during the claim | Unaffected; jobs are keyed by business |
| Guest's GSC popup open during the claim | Its `oauth_state` was deleted, so the popup shows the existing expired error and the user retries from Settings or onboarding |
| Signup fails (409 duplicate) | Nothing is claimed; the guest stays |
| Google callback without the cookie (another browser) | Nothing to claim; normal destination |

**Guest exclusions elsewhere**
- `signin` filters `guest=false`.
- `src/app/api/admin/metrics/route.ts` and any count of users filter `guest=false`.
- `attachInvites` never matches a guest, because the email is synthetic.

## 7. Stripe

### 7.1 Client (T4)

1. `loadStripe(publishableKey)`.
2. `elements.create('cardNumber' | 'cardExpiry' | 'cardCvc', {style, classes})`, mounted inside `.input`-styled containers. `cardNumber` gets `{showIcon: true, disableLink: true}`.
3. Track `{empty, complete, error}` from each element's `change` event. Validate only on submit (§4 table, mapping in §10).
4. Submit:
   1. `stripe.createPaymentMethod({type: 'card', card: numberEl, billing_details: {address: {postal_code: zip}}})`.
   2. `POST /api/billing/start` (trial) or `POST /api/billing/restart` (restart).
   3. `stripe.confirmCardPayment(clientSecret, {payment_method: pm.id})`. Always pass `payment_method`: for a restart against an open invoice, the subscription default doesn't apply to that invoice's PaymentIntent.
   4. `POST /api/billing/confirm`. Retry 3 times (1s, 2s, 4s) on network errors and 5xx. Then poll `GET /api/billing/state` every 2s for up to 30s until `access`.
   5. Success view, using the `state.trialEnd` from the confirm response (never the preview).
5. The button reads "Confirming your card…" from step 4.1 to the end.
6. "Open dashboard" → `window.location.assign('/dashboard?started=trial')`. A full navigation re-runs the guard and scrolls to the top.

**Element styling.** Elements iframes can't read CSS variables. Read the computed `color`, `font` and placeholder color from a hidden `.input`, pass them as `style.base`, and re-mount on theme change (as `RadarField` does).

### 7.2 Server calls (`src/server/billing/stripe.ts`)

**Request format**
- `application/x-www-form-urlencoded` with bracket encoding (`items[0][price]`, `metadata[k]`, `expand[]`).
- Headers: `Authorization: Bearer ${STRIPE_SECRET_KEY}`, `Stripe-Version: ${STRIPE_API_VERSION}`, `Idempotency-Key` on every POST.
- Keys are prefixed `radar:` and are deterministic, so a retry within 24h replays the first response.

**One lock per request.** `withBillingLock(uid, tx => …)` opens a transaction and takes `pg_advisory_xact_lock(hashtext('billing:' || uid))`. Each request (start, restart, confirm, a webhook delivery) enters it **once**.
- `activate(tx, …)`, `restartIn(tx, …)` and `syncSubscription(tx, …)` receive the `tx`. They never open another transaction or take the lock again.
- Advisory locks are re-entrant only within one connection, so nesting across pooled connections would wait on itself.

**`ensureCustomer(user)`** runs **before** the lock.
1. If `stripe_customer_id` is set, return it.
2. Otherwise `POST /v1/customers {email, name, metadata[radar_user_id]}` with key `radar:cus:{uid}`, which replays the same customer within 24h.
3. Then `INSERT … ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = COALESCE(billing_accounts.stripe_customer_id, EXCLUDED.stripe_customer_id)`.

**`start(user, pmId)`**: rate limits `billing:user:{uid}` 5/h and `billing:ip:{ip}` 10/h, then `ensureCustomer`, then `withBillingLock`:

1. **Gates:** `enforced`, `!own` (409 `already_active`), `!everSubscribed` (409 `restart_required`).
2. **Previous PaymentIntent.** If `trialPaymentIntentId` is set, `GET /v1/payment_intents/{id}`:
   - `succeeded` → `activate(tx, id)`, return `{activated: true}`. This prevents a second $1.
   - `requires_payment_method`, `requires_confirmation` or `requires_action` → `POST /v1/payment_intents/{id}/cancel` (best effort).
3. *(The customer already exists: see `ensureCustomer`.)*
4. **PaymentMethod.** `GET /v1/payment_methods/{pm}`:
   - require `type = card` and `customer` null or ours, else 400;
   - `fp = card.fingerprint`.
5. **Fingerprint.** If `trial_fingerprints` has `fp` → 409 `trial_used`.
6. **Trial end.** Reuse `pendingTrialEnd` when `pendingPaymentMethodId = pm` and `pendingSetAt > now − 1h`. Otherwise use `now + 72h` (to the second) and persist the pending columns.
7. **PaymentIntent.** `POST /v1/payment_intents`:
   - Parameters: `amount=100`, `currency=usd`, `customer`, `payment_method=pm`, `payment_method_types[]=card`, `setup_future_usage=off_session`, `description=Radar card confirmation`, `metadata[radar_user_id]`, `metadata[purpose]=trial_check`, `metadata[trial_end]=<unix>`.
   - Key `radar:pi:{uid}:{pm}:{unix}`.
   - Persist `trialPaymentIntentId`.
8. Return `{clientSecret, paymentIntentId, trialEnd: metadata.trial_end of the returned PI}`. The client secret is never logged.

**`activate(tx, piId, via: 'confirm' | 'webhook')`**, the single path to a trial subscription. The confirm route and the webhook call `withBillingLock(uid, tx => activate(tx, …))`; `start` passes its own `tx`.

1. **Load and verify.** `pi = GET /v1/payment_intents/{piId}`. The callers fetch it before taking the lock, because the lock key needs `uid`. Require `metadata.purpose = trial_check`, `status = succeeded`, `amount = 100`, `currency = usd`. Set `uid = metadata.radar_user_id`.
   - On `confirm`, also require `uid = session user` and `pi.customer = acct.stripe_customer_id`; otherwise 403 `not_yours`.
2. **Serialize.** Already inside `withBillingLock`. `SELECT billing_accounts FOR UPDATE`.
3. **Already done?** If `acct.trialPaymentIntentId = pi.id` and `acct.stripeSubscriptionId` is set, skip to step 7.
4. **Adopt.** `GET /v1/subscriptions?customer={cus}&status=all&limit=20`. A subscription with `metadata.radar_pi = pi.id` is adopted. This covers a crash after creation and keys older than 24h.
5. **Create.** Otherwise `POST /v1/subscriptions`:
   - Parameters: `customer`, `items[0][price]=STRIPE_PRICE_ID`, `trial_end=T`, `default_payment_method=pi.payment_method`, `trial_settings[end_behavior][missing_payment_method]=cancel`, `metadata[radar_user_id]`, `metadata[radar_pi]=pi.id`.
   - `T` is `metadata.trial_end`. In the late edge case, where that is less than an hour away (for example a webhook retried days later), `T = now + 72h`.
   - Key `radar:sub:{pi.id}:{T}`. With `T` in the key, a recomputed `T` never reuses a key with different parameters. The adopt step before it prevents a duplicate.
   - On HTTP 409 (key in flight), wait 1s and retry up to 3 times, then go back to step 4.
6. **Customer default.** `POST /v1/customers/{cus} {invoice_settings[default_payment_method]=pm}`, key `radar:cusdpm:{pi.id}`.
7. **Write the account.**
   - `status`, `trial_end`, `current_period_end = items.data[0].current_period_end`, `stripe_subscription_id`, `everSubscribed = true`, pending columns cleared;
   - `INSERT trial_fingerprints ON CONFLICT DO NOTHING`. The fingerprint is fetched from `pi.payment_method`, never stored on the account.
8. **Once only.** If `trialStartedAt` is null: set it, run `commitDraft(user's saved draft)`, and `track('trial.started', {uid, ref: sub.id})`.
9. **Fee mode** (`RADAR_TRIAL_FEE_MODE`), after commit, each idempotent:
   - `keep` (default): nothing;
   - `refund`: `POST /v1/refunds {payment_intent}`, key `radar:refund:{pi}`;
   - `credit`: `POST /v1/customers/{cus}/balance_transactions {amount: -100, currency: usd, description: Card confirmation credit}`, key `radar:credit:{pi}`. A negative amount is a credit applied to the next invoice.
10. Return `BillingState`.

Holding a transaction across Stripe calls holds one pool connection for about 1–2s, once per user, which is acceptable at this scale (pool max 10). Stripe's idempotency is the second line of defense if the lock is ever bypassed.

**`restart(user, pmId)`**: the same rate limits, then `ensureCustomer`, then `withBillingLock` with the steps below:

1. **Gates.** `everSubscribed` (else 409 `not_lapsed`), `!own`.
2. **Card setup.** `POST /v1/payment_methods/{pm}/attach {customer}` (key `radar:attach:{pm}`), then set `invoice_settings[default_payment_method]` on the customer.
3. **`past_due` or `unpaid` with an open invoice.** Retrieve `latest_invoice` and check `status = open`.
   1. `POST /v1/subscriptions/{sub} {default_payment_method: pm}`.
   2. `GET /v1/invoices/{inv}?expand[]=confirmation_secret`.
   3. Return `confirmation_secret.client_secret`. `dueTodayCents = amount_due`.
4. **Otherwise** (`canceled`, `incomplete_expired`, `paused`, or no open invoice):
   1. If the old subscription isn't terminal, `DELETE /v1/subscriptions/{old}`.
   2. `POST /v1/subscriptions {customer, items[0][price], default_payment_method: pm, payment_behavior: default_incomplete, payment_settings[save_default_payment_method]: on_subscription, expand[]: latest_invoice.confirmation_secret, metadata[radar_user_id], metadata[purpose]: restart}`, key `radar:restart:{uid}:{pm}`.
   3. Store the new subscription id with `status = incomplete`.
   4. Return the client secret.
5. The confirm call with `{subscriptionId}` runs `syncSubscription(id)`. The account must own it, else 403. Access follows the status.

### 7.3 Webhook (`POST /api/billing/webhook`)

**Signature verification**
1. `raw = await req.text()` before anything parses it.
2. Parse `Stripe-Signature` into `t` and every `v1` entry; ignore other schemes.
3. `expected = hmacSha256(STRIPE_WEBHOOK_SECRET, `${t}.${raw}`)`. Pass when any `v1` matches, compared with `crypto.timingSafeEqual` on equal-length buffers, and `|now − t| ≤ 300s`.
4. Otherwise return 400. Never log the body or the header.

**Dedupe**
1. `INSERT billing_events (id, type) ON CONFLICT DO NOTHING`.
2. If the row has `processed_at IS NOT NULL` → 200 (replay).
3. Otherwise increment `attempts` and run the handler.
4. On success, set `processed_at = now()`. On failure, store `last_error` (the message only) and return 500 so Stripe retries.
5. Concurrent duplicate deliveries both run; the handlers are idempotent.

**Handlers (fetch-on-event)**

| Event | Handler |
|---|---|
| `payment_intent.succeeded` | If `metadata.purpose = trial_check`, `activate(id, 'webhook')`; otherwise ignore |
| `payment_intent.payment_failed` | If `trial_check`: `track('trial.payment_failed', {uid, ref: pi.id, props: {code, decline_code}})`. No state change |
| `customer.subscription.created`, `.updated`, `.deleted` | `syncSubscription(object.id)` |
| `invoice.paid`, `invoice.payment_failed` | Account by `object.customer`, then `syncSubscription(acct.stripe_subscription_id)`. Invoice→subscription fields are deliberately not read (Basil moved them) |

**`syncSubscription(tx, id)`**
1. `s = GET /v1/subscriptions/{id}`.
2. Find the account by `s.customer`; if none, return.
   - The webhook and confirm callers do steps 1–2 before taking the lock, then call `withBillingLock(acct.user_id, tx => …)` for steps 3–5.
   - `restart` passes its own `tx`.
3. If `s.id ≠ acct.stripe_subscription_id`:
   - `s` is terminal → ignore it (an old subscription);
   - the account has none → adopt `s`.
4. Write `status`, `trial_end`, `current_period_end` (from `items.data[0]`) and `cancel_at_period_end`.
5. If the status changed, `track('sub.status_changed', {uid, ref: s.id, props: {from, to}})`.

**Dashboard settings (LAUNCH.md)**
- Endpoint `{APP_URL}/api/billing/webhook` with the seven events above.
- Under failed payments, set "if all retries fail → cancel the subscription". Recommended, but the owner confirms it (§13).
- Do not subscribe to `customer.subscription.trial_will_end`; no email is designed.

### 7.4 Stub provider (`RADAR_DEV_STUBS=1` and no `STRIPE_SECRET_KEY`; never when `isProd`)

**Provider choice**
- `provider()` returns:
  - `'stripe'` when `STRIPE_SECRET_KEY` is set;
  - `'stub'` when `devStubs && !isProd`;
  - otherwise `'none'`.
- `stub.ts` throws if imported while `isProd`.

**Server stub**
- `src/server/billing/stub.ts` implements the same interface as `stripe.ts`, backed by in-memory maps on `globalThis`. That is enough for dev and vitest, since only the web process calls it.
- Stub fingerprints are `fp_stub_<last4>`, so dedupe can be tested with a repeated card.

**Client stub**
- `src/features/billing/stubStripe.ts` mirrors the subset of stripe-js used.
- The stub card form uses raw inputs and is rendered only when `provider = 'stub'`.
- PaymentMethod ids are `pm_stub_<scenario>_<last4>`, chosen from the number:
  - `4000 0000 0000 0002` declines;
  - `4000 0025 0000 3155` shows an inline "Simulated 3-D Secure" confirm step (Complete / Fail);
  - any other Luhn-valid number succeeds.
- `confirmCardPayment` calls `POST /api/billing/dev/confirm-intent`.
- The webhook equivalents are `dev/simulate` and a direct call to the webhook dispatcher with a stub event, used in tests.

## 8. Rate limits, bot seam, cleanup

**`hit(key, limit, windowSec)`** (`src/server/abuse/rateLimit.ts`)
- `INSERT INTO rate_limits(key, window_start, count) VALUES ($1, to_timestamp(floor(extract(epoch from now()) / $w) * $w), 1) ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1 RETURNING count`.
- Over the limit → throw `RadarError(copy, 429, 'rate_limited')`.
- When several limits apply, all are checked; a rejected attempt still counts.

| Key | Limit | Applies to |
|---|---|---|
| `guest:ip:{ip}` | 10 / hour | creating a guest in `POST /api/b` |
| `analysis:ip:{ip}` | 5 / hour **and** 20 / day | `onboarding.analyze` when `!ownAccess` (guests and users without access) |
| `analysis:domain:{domain}` | 10 / day | same |
| `analysis:global` | `RADAR_ANALYSIS_GLOBAL_PER_HOUR` (default 300) / hour; returns 503 `busy` | same |
| `billing:user:{uid}`, `billing:ip:{ip}` | 5 / hour, 10 / hour | `billing/start`, `billing/restart` |

- Users with own access are not limited, as today.

**Client IP** (`clientIp(req)`)
- The `x-forwarded-for` list, taking the entry `RADAR_TRUSTED_PROXY_HOPS` (default 1) from the right.
- Then `x-real-ip`, then `'unknown'`.
- **Verify on Railway** at deploy: log the header shape once at boot in production. A CDN in front changes the hop count.

**Human-check seam** (`verifyHuman(token, ip)`, `src/server/abuse/human.ts`)
- Returns true when `TURNSTILE_SECRET_KEY` is unset.
- Otherwise POSTs to Cloudflare siteverify.
- Called only when `POST /api/b` creates a guest. No widget is designed or shipped.

**Cleanup cron** (`src/server/jobs/guestCleanup.ts`, imported from `jobs/all.ts`)
- Runs as `defineCron('onboarding.guestCleanup', now => { if (now.getUTCMinutes() !== 17) return; if (!await once('guest-cleanup:' + now.toISOString().slice(0, 13))) return; … })`.
- **Steps:**
  1. Select up to 200 users where `guest`, `created_at < now() − 24h`, and there is no session with `expires_at > now()`. For each, inside a transaction:
     - revoke and delete GSC tokens for their businesses (best effort; a stub token is a no-op);
     - delete their businesses;
     - delete their `oauth_states`;
     - delete the user.
  2. `DELETE rate_limits WHERE window_start < now() − 2 days`.
  3. `DELETE billing_events WHERE processed_at < now() − 30 days`.
- **Retention.** Drafts survive at least 24h, and in practice 72h after the guest's last write, since session expiry slides.
- **Known gap.** Logo files are orphaned because storage has no delete helper. Logged, not fixed.

**Grandfather** (`src/server/billing/grandfather.ts`)
- The source of truth is the lazy check in `ownAccess` (§4.3), so nobody depends on this job having run.
- The batch backfill runs when billing is enforced and `RADAR_BILLING_GRANDFATHER_BEFORE` is set. It is called at worker start and from the hourly cleanup cron, with no `once()`, so a cutoff set later is still applied.
- It runs `INSERT INTO billing_accounts (user_id, comp, comp_reason) SELECT DISTINCT owner_id, true, 'grandfather' FROM businesses WHERE status = 'active' AND created_at < $cutoff ON CONFLICT (user_id) DO UPDATE SET comp = true, comp_reason = COALESCE(billing_accounts.comp_reason, 'grandfather')`.

## 9. Frontend structure (T4)

**Routes**
- `src/app/(onboard)/start/page.tsx` and `src/app/(onboard)/onboarding/page.tsx`. A route group with no layout; each page calls its guard (§4.3) and renders `<OnboardingStage {...props} />`.
- `src/app/(auth)/start-trial/page.tsx` calls `trialGuard()` and renders `<TrialPage {...props} />`. It reuses the Signup shell, so there is no app backdrop.

**`OnboardingStage`** (`src/features/onboarding/OnboardingStage.tsx`)
- Draws the static shell backdrop: Side visual (initials `?` for a guest), GhostDash "Welcome." with no name for a guest, wrapped in `inert`.
- Draws the `Onboarding` modal on top, `dismissable = false`.
- **Recommended:** wrap it in `AppProvider` with a synthetic `Me` (`{user: {name, email: ''}, businesses: [], currentId: null}`), so `Side`, `GhostDash`, toasts and `GscConnect` work unchanged. Check that `AppProvider` makes no workspace request when `currentId` is null.
- Otherwise add `useAppOptional()` and a small toast host. T4 chooses.

**`Onboarding.tsx` changes**
- Props: `{actor, draft, saveCommits, autoDomain}` instead of reading `useApp().me`. The in-app "Add a business" modal passes `{actor: 'user', draft: me's onboarding business, saveCommits: true, autoDomain: null}`.
- **Resume:**
  - while analysis is queued or running → Analyzing (as today);
  - else when analyzed → `draft.step ?? 'review'`.
  - Call `onboarding.step` on each change to review, gsc or save.
- **Auto-run (AC-G1, AC-G9).** When `autoDomain` is set:
  - no draft, or a different domain → `start(autoDomain)` with no click;
  - same domain → resume, no re-crawl.
  - Then `router.replace(pathname)` to drop `?domain=`.
- **Save:**
  1. `flush`, then `r = act('onboarding.save', {tz})`.
  2. If `r.committed`: `/api/b/current`, then `refreshMe` (in-app) or a full navigation to `/dashboard?saved=profile` (standalone).
  3. Otherwise `location.assign(r.next)`.
- **Label:** `saveCommits` → "Save profile & open dashboard"; otherwise "Save profile & continue" with `iconR="arrow"`.
- **Errors:** a 429 or 503 from `onboarding.analyze` shows `e.message` inline under the domain field (the `dErr` slot) on the domain step, and as a toast on Re-analyze.

**`Signup.tsx`**
- Default sub: "Set up your Business Profile, then start your 3-day free trial."
- Pending variant (`pending: PendingProfile` from `signupContext()`):
  - h1 "Save your Business Profile";
  - sub "Create an account to keep **{name}** and open your dashboard.";
  - business row: 34px `LogoTile`, name and domain, `Status ok` "Ready";
  - "Back to your profile" → `/start`.
- Send `next` in the body and navigate to `r.next`.

**`TrialPage`** (`src/features/billing/TrialPage.tsx`) and `CardFields.tsx`, `StubCardFields.tsx`, `dates.ts`, `copy.ts`, `elementErrors.ts`
- Follows handoff §4.
- `mode = 'restart'` swaps the copy (§10).
- "Back to your profile" → `/onboarding`, only when `state.hasDraft`.

**`AppShell` and `app.tsx`**
- The switcher hides `access: false`.
- The modal opens only from "Add a business". The `!me.currentId` auto-open is gone, because the guard guarantees a current business.
- 402 handling and the one-shot toasts (§5.3).

**Dates** (`dates.ts`)
- `fmtD(iso)` → `Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric'})`, for example "Oct 28".
- `fmtDW(iso)` → adds `weekday: 'short'`, for example "Wed, Oct 28".
- Both run in a `useEffect` after mount. Before mount, render an invisible placeholder of similar width.

## 10. Copy and failure states

| Situation | Copy | Designed? |
|---|---|---|
| Card empty or incomplete or invalid (`incomplete_number`, `invalid_number`) | "Enter your card number" | yes (§4) |
| Expiry empty, `incomplete_expiry`, `invalid_expiry_month`, `invalid_expiry_year` | "Use MM / YY" | yes |
| `invalid_expiry_month_past`, `invalid_expiry_year_past` | "This card has expired" | yes |
| CVC empty, `incomplete_cvc`, `invalid_cvc` | "3 or 4 digits" | yes |
| ZIP shorter than 3 characters after trimming | "Enter your ZIP" | yes |
| `confirmCardPayment` `card_error` or `payment_intent_authentication_failure` (`role="alert"`) | "Your card was declined. Try another card, or check the details with your bank." | yes |
| Other confirm or network failure | "Radar couldn’t confirm your card. Try again." | **not designed** |
| 409 `trial_used` (`role="alert"`) | "This card has already been used for a free trial. Try a different card." | **not designed** |
| 502 `activation_failed` | "Your card is confirmed, but your trial didn’t start yet. Try again in a minute. You won’t be charged twice." | **not designed** |
| 429 billing | "Too many attempts. Try again in an hour." | **not designed** |
| 429 analysis per IP (hour) / (day) | "You’ve started several analyses in a short time. Try again in an hour." / "…Try again tomorrow." | **not designed** |
| 429 analysis per domain | "Radar has analyzed {domain} several times today. Try again tomorrow." | **not designed** |
| 503 `busy` | "Radar is busy right now. Try again in a few minutes." | **not designed** |
| Restart page | h1 "Restart your subscription"; sub "$50/month. Every feature included."; rows "Today · ${due}" / "Your subscription restarts." and "{Mon D} · $50/month" / "Then every month."; button "Pay ${due} and restart"; success h1 "Your subscription has restarted." with "Your card is confirmed. Your next payment of $50 is on {Weekday, Mon D}." (`currentPeriodEnd`) | **not designed** |
| 3-D Secure | Stripe's own modal | **not designed** (the prototype has none) |

The Element error codes above come from Stripe.js knowledge, not a checked doc page. T4 verifies them against the Stripe.js reference and maps any unknown code to the field's first message.

## 11. Environment variables (`.env.example`, T3)

| Var | Default | Notes |
|---|---|---|
| `RADAR_BILLING` | `off` | `off`, `on`, or a comma-separated list of emails (for a production trial run by the owner). Read at call time |
| `STRIPE_SECRET_KEY` | — | A restricted key is recommended. Write access: Customers, PaymentIntents, PaymentMethods, Subscriptions, Refunds (refund mode). Read access: Invoices, Prices |
| `STRIPE_PUBLISHABLE_KEY` | — | Read on the server and passed as a prop. Not `NEXT_PUBLIC_*`, which Railway would inline at build time |
| `STRIPE_WEBHOOK_SECRET` | — | `whsec_…` for the endpoint |
| `STRIPE_PRICE_ID` | — | The $50/month recurring USD price |
| `STRIPE_API_VERSION` | code constant | Pinned. Use the version current when the keys are created; the docs list `2026-05-27.dahlia` at the time of writing. Code reads `items.data[0].current_period_end`, which is Basil or later |
| `RADAR_TRIAL_FEE_MODE` | `keep` | `keep`, `refund` or `credit` |
| `RADAR_BILLING_GRANDFATHER_BEFORE` | — | ISO timestamp, the cutoff for B18 |
| `RADAR_TRUSTED_PROXY_HOPS` | `1` | Client IP selection |
| `RADAR_ANALYSIS_GLOBAL_PER_HOUR` | `300` | Circuit breaker |
| `TURNSTILE_SECRET_KEY` | — | Seam only |

## 12. Events and logs

- **Event kinds.** Extend the `track()` kind union with `` `trial.${string}` | `sub.${string}` | `onboarding.${string}` ``.
- **Events emitted:** `trial.started`, `trial.payment_failed`, `sub.status_changed`, `onboarding.claimed`, `onboarding.draft_replaced`, and `business.onboarded` (from `commitDraft`).
- **What they carry.** Only `uid`, `bid`, a Stripe object id as `ref`, and enum props.
- **Never logged or tracked:** client secrets, PaymentMethod details (brand, last4, fingerprint), raw webhook bodies, `Stripe-Signature`, or API keys.
- **Server logs.** `console.info('[billing] …')` lines carry ids and status only.

## 13. Owner decisions needed (defaults in bold)

1. **Rollout:** **`RADAR_BILLING` flag, off at merge** (flip it after Stripe is configured), or gate at merge. While the flag is off, marketing and signup copy already advertise a trial that isn't charged.
2. **Existing accounts:** **grandfather (comp) owners of active businesses created before the cutoff**, or gate them too.
3. **The $1:** **keep**, refund or credit. All three are implemented behind `RADAR_TRIAL_FEE_MODE`.
4. Stripe test keys, the $50 price and the webhook endpoint (D8).
5. **Background work for lapsed businesses.** Recommended: skip jobs of active businesses whose owner has no access, with one check in `execute()` in `src/server/jobs/queue.ts`. It is a no-op while billing is off. The alternative is to keep running nightly crawls, AI-visibility queries and drafts for unpaid accounts indefinitely.
6. **Repeat-trial card:** **refuse with the copy in §10**, or offer a paid start with no trial (not designed).
7. **Failed payments setting** in the Stripe Dashboard: **cancel after all retries**, or leave as `past_due` or `unpaid`. Either way the user is gated.
8. **Split Card Elements (D5).** Stripe documents them as legacy and maintenance-only, and recommends the Payment Element. Keeping D5 preserves the designed rows; the cost is a migration later.

## 14. File ownership

T2 owns marketing: `src/app/page.tsx`, `/login`, `src/app/features/**`, marketing components, and the root `src/app/layout.tsx` (AC-M6). Neither T3 nor T4 edits them.

| Owner | Files |
|---|---|
| **T3 backend** | `src/lib/types.ts` (billing and onboarding additions, written first) · `src/lib/billing.ts` (new) · `src/server/db/schema.ts` · `drizzle/0007_*.sql` and `drizzle/meta/*` (generated) · `src/server/auth/session.ts` · `src/server/auth/users.ts` · `src/server/auth/claim.ts` (new) · `src/server/access.ts` · `src/server/billing/{config,provider,stripe,stub,access,guard,activate,restart,sync,webhook,grandfather}.ts` (new) · `src/server/abuse/{rateLimit,ip,human}.ts` (new) · `src/server/actions/{onboarding,define}.ts` · `src/server/workspace.ts` · `src/server/events.ts` · `src/server/env.ts` · `src/server/flags.ts` · `src/server/jobs/{guestCleanup.ts (new), all.ts}` · `src/server/jobs/queue.ts` (only if §13.5 is accepted) · `src/app/api/auth/**` · `src/app/api/b/route.ts` · `src/app/api/b/[bid]/{act,workspace,events}/route.ts` · `src/app/api/oauth/[provider]/{start,callback}/route.ts` · `src/app/api/billing/**` (new) · `src/app/api/admin/metrics/route.ts` · **`src/app/(app)/layout.tsx`** (guard-critical, about 10 lines) · `.env.example` · `docs/LAUNCH.md` (Stripe section) · `docs/CONTRACTS.md` (onboarding and billing) · all `src/server/**/*.test.ts` listed in §16 |
| **T4 frontend** | `src/app/(onboard)/start/page.tsx` · `src/app/(onboard)/onboarding/page.tsx` · `src/app/(auth)/start-trial/page.tsx` · `src/app/(auth)/signup/page.tsx` · `src/app/(auth)/signin/page.tsx` · `src/features/onboarding/{Onboarding,Signup,OnboardingStage}.tsx` · `src/features/billing/**` (new) · `src/features/gsc/GscConnect.tsx` · `src/client/app.tsx` · `src/client/api.ts` (if needed) · `src/features/shell/AppShell.tsx` · `package.json` and `package-lock.json` (`@stripe/stripe-js`, the only new dependency) · `src/features/billing/*.test.ts` |
| **PM** | `DIVERGENCES.md` (shared with T2; the PM merges the §17 rows and the engineers' additions) · `.factory/**` |

## 15. Implementation order

1. **T3, contracts (blocks T4).**
   - §5.1 and §5.2 into `src/lib/billing.ts` and `src/lib/types.ts`.
   - `schema.ts` plus a generated 0007.
   - Env parsing.
   - Report to the PM, which unblocks T4.
2. **T3, identity and gates.**
   - Guest session and `currentActor`.
   - `access.ts` (`requireActor`, `gateBusiness`, `DRAFT_ACTIONS`).
   - `billing/access.ts` and `guard.ts`.
   - `commitDraft`, the `onboarding.step` and `onboarding.save` actions, `POST /api/b` changes.
   - Claim in the three auth routes, OAuth guest path, `(app)/layout.tsx`, `getMe` access.
3. **T3, billing.**
   - Provider interface with **stub first**, then `stripe.ts`.
   - start, confirm, restart, state, webhook.
   - Rate limits, cleanup cron, grandfather. Docs.
4. **T4, in parallel from step 1.**
   - `OnboardingStage` and the `/start` and `/onboarding` routes.
   - `Onboarding.tsx` props, resume, save and labels.
   - Signup copy, pending variant and `next`.
   - `TrialPage` against the stub, then real Elements.
   - `app.tsx` (402 handling, toasts) and the AppShell switcher.
5. **T4 integrates** against T3's endpoints in stub mode. Then QA, in stub mode and with Stripe test keys if the owner provides them.

## 16. Tests the engineers must write (vitest; DB tests skip without `DATABASE_URL` and set `RADAR_DEV_STUBS=1` via `vi.hoisted`, as in `publish.test.ts`)

**T3, unit tests**
1. `billing/stripe.test.ts`:
   - form encoding of nested params (`items[0][price]`, `metadata[k]`, `expand[]`);
   - `Idempotency-Key` and `Stripe-Version` headers;
   - error mapping (`card_error` → code);
   - a 409 is retried.
2. `billing/webhook.test.ts`, signatures:
   - valid;
   - wrong secret;
   - tampered body;
   - timestamp 301s old;
   - two `v1` entries with one valid;
   - missing header.
3. `abuse/ip.test.ts`: hop selection, missing headers.

**T3, DB tests**

4. **`access.test.ts`**
   - `ownAccess` matrix: flag off, on and list; `comp`; every `SubStatus`.
   - **A guest is false in every flag state.**
   - Lazy grandfather: an owner of an active business created before the cutoff is true, and a `comp` row now exists. After the cutoff: false.
   - A member rides on the owner.
   - `getMe` never picks a locked business as `currentId`.
   - **`currentUser()` returns null with only a guest cookie, and for a user row with `guest = true`.**
5. **`guard.test.ts`.** The `resolveEntry` table:
   - no business → `/onboarding`;
   - unsaved draft → `/onboarding`;
   - saved draft without access → `/start-trial`;
   - lapsed owner → `/start-trial`;
   - access plus a saved draft → committed and rendered;
   - member only → render;
   - flag off → render, or `/onboarding` with no business.
6. **`actGate.test.ts`**
   - A guest on its own draft: each `DRAFT_ACTIONS` entry passes; a non-allowlisted action (for example `profile.reanalyze`) gets 402.
   - A guest on another guest's draft gets 404. A guest on an active business gets 404 on act, workspace and events.
   - **A signed-up user without access calling a non-allowlisted action on their own draft gets 402.**
   - **With the flag off, a guest is still held to the allowlist (402).**
   - A user without access on an active business gets 402 on act, workspace and events.
   - A member of a paid business passes.
7. **`claim.test.ts`**
   - A guest draft with edits, `edited` flags and a stub `gsc_connections` row survives signup, signin and the Google-callback helper intact: owner, member email, GSC row.
   - The guest is deleted.
   - A user's own old draft is replaced.
   - With access and a saved draft, the draft is committed.
   - Two concurrent claims: exactly one moves the draft.
   - An invite `next` is honored.
8. **`onboarding.test.ts`**
   - `save` without access: not committed, `next` `/signup` (guest) or `/start-trial` (user).
   - **A guest's `save` with the flag off: `committed: false`, `next: '/signup'`. After signup, the claim plus `resolveEntry` commits it.**
   - With access: committed, and `business.onboarded` tracked exactly once.
   - The `finish` alias.
   - `POST /api/b` with the same domain keeps GSC; another domain clears GSC, crawl_pages and `onboarding`.
   - `step` persists.
9. **`rateLimit.test.ts`**
   - Window boundaries.
   - Per-IP hour and day limits and the per-domain limit on `onboarding.analyze` for a guest **and** for a user without access.
   - A user with access is not limited.
   - **A guest is limited with the flag off too.**
   - The global limit gets 503.
   - Guest creation is limited.
10. **`billingFlow.test.ts`** (stub)
    - start, then confirm → `trialing`, with `trial_end = pending_trial_end` (the same second).
    - Confirm twice, and confirm racing the webhook: one subscription, one `trial.started`, the draft committed once.
    - Webhook only, with no confirm: same result.
    - A decline leaves no subscription and status `none`.
    - A repeated fingerprint gets 409 `trial_used`.
    - An account that has subscribed before gets 409 `restart_required`.
    - A previous PaymentIntent that succeeded activates with no new charge.
    - Refund and credit modes each call the stub exactly once.
    - Confirm with another user's PaymentIntent gets 403.
    - **`start` when the previous PaymentIntent succeeded completes without hanging, because the lock is taken once.**
    - Late activation (`metadata.trial_end` less than an hour away) uses the recomputed `T` and is safe to retry.
11. **`webhookSync.test.ts`** (stub)
    - `past_due` → no access; `invoice.paid` → `active`; deleted → `canceled`.
    - A replayed event id is a no-op.
    - A handler that throws leaves `processed_at` null, and the retry processes it.
    - Out-of-order events converge.
    - An event for an old subscription doesn't regress a restarted account.
12. `restart.test.ts` (stub): `past_due` takes the open-invoice path; `canceled` takes the new-subscription path with no trial; access after the subscription's confirm.
13. `guestCleanup.test.ts`: an expired guest older than 24h is deleted with its business; a live guest is kept; a guest under 24h is kept; `rate_limits` are pruned.
14. `grandfather.test.ts`: the backfill gives `comp` before the cutoff, nothing after it, and is idempotent. Changing the cutoff later re-applies it.

**T4 tests**
- `dates.test.ts`: `fmtD` and `fmtDW` for fixed ISO strings, in `TZ = America/Los_Angeles` and `Pacific/Auckland`.
- `elementErrors.test.ts`: each code maps to the §4 copy.
- `stubStripe.test.ts`: number → scenario.

## 17. Validation scenarios (QA)

| Scenario | Expected |
|---|---|
| Journey A, signed out | `/start?domain=x` starts the analysis with no click. Review → GSC (connect a stub) → Save "Save profile & continue" → `/signup` pending variant. Sign up → `/start-trial` → stub `4242…` → success (date = `trial_end`) → Open dashboard → `/dashboard`, toast "Your free trial has started.", GSC connected, edits kept |
| Journey A, Google | Same, but signing up with Google (dev stub). The draft is claimed |
| Journey A, existing account | Sign in from the pending variant: with access → dashboard and "Business Profile saved"; without access → `/start-trial` |
| Journey B | `/signup` (new sub copy) → `/onboarding` domain step → … → Save "Save profile & continue" → `/start-trial` → pay → dashboard |
| Second business with access | "Add a business" → "Save profile & open dashboard" → dashboard with "Business Profile saved" |
| Resume | Reload `/start?domain=x` on Review or GSC: same step, no new crawl. A different domain starts a new analysis |
| Back links | Signup pending → "Back to your profile" → Save step intact. Trial → "Back to your profile" only when a draft exists |
| Direct URL | `/dashboard`, `/settings`, `/api/b/<id>/workspace` without access → `/start-trial` or 402. Without a session → `/signup` or 401. A guest on an app route → `/signup` |
| Decline and 3DS | `4000 0000 0000 0002` → alert copy, still on `/start-trial`, no subscription. `4000 0025 0000 3155` → the simulated 3DS: Complete → success; Fail → decline |
| Repeat card | A second account with the same stub card → `trial_used` copy |
| Lapsed | `dev/simulate past_due` → app routes go to `/start-trial` worded "Restart your subscription"; paying restores access. `canceled` → new subscription, no trial |
| Abuse | A 6th guest analysis from one IP in an hour → inline copy. An 11th for one domain in a day → domain copy |
| Flag off | No gate for signed-in users. Signed-in Save commits. A guest's Save → `/signup`, and the draft is committed after signup. The trial page redirects to `/dashboard` |
| Grandfather | Flip the flag with the cutoff set and before the worker runs: an existing owner → dashboard immediately, no trial page |

## 18. Migration, compatibility, rollback

**Migration**
- 0007 is additive (columns with defaults, new tables) and safe to deploy with the flag off.
- `RADAR_BILLING` off reproduces today's access for everyone.

**Compatibility**
- Auth responses gain `next`, an additive change.
- `onboarding.finish` survives as an alias.
- Old open tabs navigating to `/dashboard` are redirected by the guard.

**Rollback**
- First step: `RADAR_BILLING=off`. Stripe keeps billing existing subscribers, who keep access.
- A full code revert leaves the extra tables and columns unused. Guest rows stay inert, since old code reads only `radar_session` and guests never have one.
- To remove guest rows and drafts after a revert: `DELETE FROM businesses WHERE owner_id IN (SELECT id FROM users WHERE guest); DELETE FROM users WHERE guest;`.

## 19. Risks found in the current code

1. `POST /api/b` resets a draft for a new domain but keeps the old domain's `gsc_connections` (tokens and property) and `crawl_pages`. File: `src/app/api/b/route.ts`. Fixed in §5.3.
2. `businesses.owner_id` has no `ON DELETE`, so deleting a user with businesses fails. Claim and cleanup delete or move businesses first (`src/server/db/schema.ts`, `businesses.ownerId`).
3. Every cron (`publishing.scheduler`, `drafting.due`, `visibility.nightly`, `social.auto`, `social.publisher`, `gsc.daily`, `brief.daily`, backlinks, keywords) runs for any `active` business regardless of payment. Once billing exists, this is an ongoing cost for unpaid accounts (§13.5).
4. `analysis.site` (a 100-page crawl plus LLM calls) can be enqueued by any Editor with no limit. That was fine while it was behind an account; with guests it becomes the public, expensive endpoint (§8).
5. `signin` doesn't call `attachInvites`, unlike signup and Google (`src/app/api/auth/signin/route.ts`). Fixed as part of the claim work.
6. `getMe` picks `currentId` from all active memberships (`src/server/auth/users.ts`), so it would land users on a locked business.
7. There is no middleware. Gating lives entirely in `(app)/layout.tsx` and the route handlers, so any future app page outside `(app)` is ungated.
8. There is no email verification at signup, so each new email is a fresh trial. The fingerprint dedupe (B14) is the only control.

## 20. Proposed DIVERGENCES rows (section "Design update 2026-10-25 (marketing, gating, trial)")

| Area | Design | Build | Why | User-visible | Status |
|---|---|---|---|---|---|
| Card fields | Raw inputs, grouped in fours, up to 16 digits | Stripe split Card Elements (number, expiry, CVC) plus our ZIP input. Grouping and length follow the card brand (for example Amex 4-6-5). Messages are mapped from Element error codes | PCI: raw card numbers never touch Radar (D5) | Barely | Logged |
| Draft commit | "Open dashboard" commits the profile (§3.3 `startTrial`, AC-P4) | Committed on the server when the subscription is created (confirm call or webhook). "Open dashboard" only navigates | A closed tab after paying must not strand the profile | No | Logged |
| Onboarding route | The prototype shows onboarding over the app shell | `/start` (guest) and `/onboarding` (signed in) draw the same modal over an inert shell backdrop. "Add a business" keeps the in-app modal | Guests can't enter the app shell; the server guard needs real routes | No | Logged |
| Search Console during anonymous onboarding | Store on the draft, move at claim | As designed: the tokens stay on the draft business and move with it | — | — | Matches design |
| Trial dates | Today + 3 days | The server's `trial_end` (now + 72h), shown in the browser's time zone | D7; Stripe charges at that instant | Rarely (near midnight) | Logged |
| The $1 | Open question | Owner decision: kept, refunded or credited (`RADAR_TRIAL_FEE_MODE`) | §3.6 question | Yes | Pending owner |
| Lapsed accounts | Suggested: "Restart your subscription", no trial | `past_due`/`unpaid`: pay the open invoice. `canceled`: new subscription at $50 now. Copy in architecture §10 | Not designed | Yes | Not designed |
| Repeat trial | Suggested: fingerprint dedupe | Refused before the $1, with "This card has already been used for a free trial. Try a different card." | Not designed | Yes | Not designed |
| Abuse limits | Rate limit plus bot protection | Postgres limits per IP, per domain and global, with inline copy (not designed). The bot check is a seam only (Turnstile, off until keyed) | No widget is designed | Only when a limit is hit | Logged |
| Pending signup variant | Shown when a profile is pending | Shown when the guest's draft has been **saved**. A guest with an unsaved draft sees the default variant, and the draft is still claimed | The server derives "pending" from saved state | Rarely | Logged |
| Returning user with an old draft | — | Signing up or in with a guest draft replaces the account's earlier unsaved draft | One draft per owner | Rarely | Not designed |
| Team members and billing | — | Members ride on the owner's subscription. A lapsed owner's businesses are hidden from the switcher for that user | D6 | Yes | Logged |
| Existing accounts | — | Owners of active businesses created before the cutoff get a complimentary account (D8 default) | AC-R1 | No | Pending owner |
| Webhook events | `invoice.paid`, `customer.subscription.updated/deleted`, `invoice.payment_failed` | Also `payment_intent.succeeded`/`payment_failed` and `customer.subscription.created` | The webhook is the fallback for the confirm call | No | Logged |
| 3-D Secure | — | Stripe's own authentication modal | Required by the bank | When the bank asks | Not designed |
| Undesigned failure copy | — | Generic confirm failure, activation delay, billing rate limit (architecture §10) | Not designed | Rarely | Not designed |

## Sources

**Repository** (base `ea70ecb2`)
- `src/server/auth/session.ts`, `src/server/auth/users.ts`, `src/server/access.ts`.
- `src/app/api/auth/{signup,signin,google/callback}/route.ts`, `src/app/api/b/route.ts`, `src/app/api/b/[bid]/{act,workspace,events}/route.ts`, `src/app/api/oauth/[provider]/{start,callback}/route.ts`.
- `src/server/actions/{onboarding,profile,define}.ts`, `src/server/db/schema.ts`, `src/server/jobs/{queue,cron,maintenance}.ts`, `src/server/events.ts`, `src/server/flags.ts`.
- `src/features/onboarding/{Onboarding,Signup}.tsx`, `src/features/gsc/GscConnect.tsx`, `src/client/app.tsx`, `src/app/(app)/layout.tsx`.
- Format reference: `.factory/social-channels/architecture.md`.

**Handoff:** `design_handoff_radar 8/updates/2026-10-25-marketing-trial-gating/UPDATE-2026-10-25-marketing-trial-gating.md` §2–§4, plus `prototype/radar-app.jsx` and `radar-trial.jsx`.

**Stripe docs** (read-only search, 2026-10-25)
- Webhook signatures: https://docs.stripe.com/webhooks/signature
- Idempotency, kept at least 24h; a reused key with other params errors; 409 means a conflict with another request on the same key: https://docs.stripe.com/api/idempotent_requests, https://docs.stripe.com/error-low-level, https://docs.stripe.com/changelog/2015-09-03/reuse-idempotency-tokens-alter-error
- Card Element no longer recommended; split elements and `disableLink`: https://docs.stripe.com/payments/link/card-element-link
- `showIcon` on the split `cardNumber` for co-badged cards: https://docs.stripe.com/co-badged-cards-compliance?type=web-elements&ui=card-element, https://docs.stripe.com/js/elements_object/create_element?type=cardNumber
- Basil changes (invoice payment fields removed; subscription period moved to items): https://docs.stripe.com/changelog/basil
- Subscription statuses, `trial_settings.end_behavior`, `trial_will_end`: https://docs.stripe.com/billing/subscriptions/overview, https://docs.stripe.com/billing/subscriptions/trials
- `default_incomplete` and `latest_invoice.confirmation_secret`: https://docs.stripe.com/billing/subscriptions/build-subscriptions
- Customer credit balance (negative amount = credit): https://docs.stripe.com/billing/customer/balance

**Not verified against a doc page (knowledge; the engineer checks these)**
- A PaymentIntent with `customer` and `setup_future_usage` attaches its PaymentMethod to the customer on success.
- The `payment_method.card.fingerprint` field.
- The Stripe.js Element error codes in §10.
- The 300s timestamp tolerance used by the official libraries.
- That Stripe saves no idempotent result for a request rejected as concurrent.
- Railway's `X-Forwarded-For` shape.
