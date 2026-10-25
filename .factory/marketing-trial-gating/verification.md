# Verification: marketing-trial-gating (T6, independent QA)

**Status: done.**
- 48 checks: 45 pass, 3 fail (2 minor, 1 cosmetic). There are no release-blocking or major defects.
- Also: 1 blocked (real Stripe), 4 not run, 1 not applicable (Turnstile). All are listed at the end.
- All three defects were introduced on this branch. None is a baseline issue.

**Recommendation:** releasable to `main` with `RADAR_BILLING` off, provided the PM accepts D2 as minor.
- D1 and D3 need billing enforced, so they don't appear with the flag off.
- D2 does appear with the flag off. I reproduced it on a flag-off server with fresh cookie jars. It reaches production through the new guest `/start` flow.
- D2 loses no data: the profile is saved and listed in the switcher. Fix it soon, either before merge or right after.
- Fix D1 and settle observation O1 before flipping the flag on.

## Environment
**Tested revision**
- `876329bce6d61742b055bb3a3f4b796029e141cc`, a detached HEAD in `.claude/worktrees/mtg-qa`.
- The PM worktree is at `a8bd5bc3`, which differs only in `state.md`.

**App**
- Started with `PORT=3600 npm run dev` (web plus worker), `RADAR_DEV_STUBS=1`, stub billing provider, `APP_URL=http://localhost:3600`.
- Four server sessions, each with its own log:
  1. `RADAR_BILLING` unset (off): `logs/dev-off-1.log`.
  2. `RADAR_BILLING=on`: `logs/dev-on-1.log`.
  3. `RADAR_BILLING=on` plus a temporary local-only `STRIPE_WEBHOOK_SECRET`: `logs/dev-on-2.log`.
  4. `RADAR_BILLING` unset again (off), to recheck D2 with fresh cookie jars: `logs/dev-off-2.log`.
- `.env.local` was restored from the backup at the end (checksum verified, so neither QA line remains).

**Databases**
- QA data: `radar_mtg_qa` on docker Postgres `localhost:54329`. Seed: `scripts/dev-seed.ts`.
- Vitest ran against a separate database, `radar_mtg_qa_tests`.
- DB changes I made in `radar_mtg_qa`:
  - Re-ran the `drizzle/0008_grandfather.sql` statement before flipping the flag.
  - `DELETE FROM rate_limits` once (6 rows) when switching to billing on.
  - `DELETE … WHERE key LIKE 'billing:%'`: the browser IP `::1` was at 9 of 10 billing calls for the hour.
  - `DELETE … WHERE key LIKE 'analysis:ip:::1@%'`, after the browser 429 check, so that AC-G9 could run in the browser.
  - These are logged in `logs/db-resets.txt`.
- Data left in `radar_mtg_qa`: the QA accounts and their businesses, plus the D2 recheck businesses `d2-signin-off.test` (`qa-b1`) and `d2-google-off.test` (`qa-off-1`). `radar_mtg_qa_tests` also still exists. Drop both databases if you don't want them.

**Prototypes**
- `python3 -m http.server 8813` serving the update's `prototype/`, used for the marketing pages.
- The update's `Radar.html` loads base files the update folder doesn't contain (30 × 404s in `logs/proto.log`).
- For the trial page, I built a merged prototype in scratch: base `design_handoff_radar 3/prototype` + update 2026-10-23 + update 2026-10-23b + this update. It was served on :8814.

**Browsers**
- The Claude desktop built-in browser (Chromium; 1024x768 viewport, also emulated at 375 and in light and dark).
- Headless Playwright Chromium, using the engineer's T2 scripts adapted to :8813/:3600 plus my own scripts.

**Test accounts**
- Local only, all on `@radar.test`, plus the seed `dev@radar.local`. Passwords are in `test-accounts.txt` in my scratch directory.
- `qa-off-1`, `qa-off-2`: created with billing off.
- `qa-a1`: journey A, 3DS card.
- `qa-b1`: journey B.
- `qa-member1`: invited Editor.
- `qa-g1`: Google claim.

**Evidence root:** `/private/tmp/claude-501/-Users-ekene-Downloads-design-handoff-radar-radar-push--claude-worktrees-radar-update-branch-cd9f3e/c824c4ef-4674-4d86-a43c-b23cffa1ba2d/scratchpad/qa-t6/`, shortened to `<ev>` below. Screenshots are only in `<ev>/pw/out/`, never in the repo.

## Results

### Build and unit tests
| # | Check | How | AC | Result |
|---|---|---|---|---|
| 1 | Typecheck | `npm run typecheck` (`<ev>/logs/typecheck.log`) | — | pass |
| 2 | Unit tests | `npx vitest run` (`<ev>/logs/vitest.log`) | — | pass on baseline: 461 passed, 1 failed, 44 skipped. The failure is the known `openrouter.qa.test.ts` parity snapshot; the skips are the four `*.live.test.ts` files. No new failures. |

### Marketing (AC-M1–M7, S1–S2)
| # | Check | How | AC | Result |
|---|---|---|---|---|
| 3 | Nav `.day`; hero matches the prototype | `pw/behave.mjs`; browser, home vs `Radar Home.html` | M1 | pass |
| 4 | Fidelity vs prototype at 1440 and 375 | `pw/layout.mjs`, `copy.mjs`, `focus.mjs`, `anim.mjs` (`<ev>/pw/out/layout-all.txt`, `copy-diff.txt`, `focus-run.txt`, `anim-reduce.txt`); `pricecta.mjs` | M2 | pass. Diffs from logged items: testimonials hidden, logos at opacity .72 (grayscale marks), 375px grids fixed (the prototype is 412–431px wide there). DOM-only diffs: on AI, "Mentioned · #2" is split into two text nodes (same rendered text); on Backlinks, the prototype keeps "Approved / Declined / Undo" labels in the DOM, while production renders them on action (`behave.mjs` covered that interaction). The home "Start free trial" style diff is a text-matching artifact. The prototype's dark 40px button (y7225) sits after the testimonials (which start at y5566, "Loved by") and before "One plan…" (y7448), so it was removed with the testimonials. Production's pricing button matches the prototype's pricing button (light, 48px; `pricecta.mjs`). Focus styles are identical, and no focus is invisible. |
| 5 | Website fields | `behave.mjs`: clean and validate, note copy, refocus, `aria-live`, no prefill, localStorage key removed | M3 | pass |
| 6 | CTAs, footer, `/login` → `/signin` (query kept) | `behave.mjs`; curl | M4 | pass |
| 7 | Reduced motion shows end states; no-WebGL fallback `#111318` | `behave.mjs`, `nogl.png` | M5 | pass |
| 8 | Marketing ignores the app theme | `behave.mjs`, `leak.mjs` (app CSS doesn't leak in either direction) | M6 | pass |
| 9 | No third-party requests; no console errors on marketing pages | `behave.mjs`, `layout.mjs` (prod external list empty) | M2/M4 | pass |
| 10 | Scrollbar scoping | `pw/scrollers.mjs`, `scrollers375.mjs` | Notes for QA | pass. Marketing `html`/`body` compute `auto`. App `html`/`body` and inner scrollers (`div.seg`, `nav.set-nav`, textareas) compute `none`. |
| 11 | App at 375, 320 and 1024 (dashboard, performance, backlinks, brief, calendar, article) | `pw/appfix.mjs` (`appfix.txt`, `app-*-375.png`) | M7 | pass. No horizontal scroll; chart wrapper `min-width:0; overflow:hidden`; `.perf-sg` rows; Section headers wrap; Backlinks meta `nowrap`. |
| 12 | Default signup sub; "No card needed" gone | browser `/signup`; `grep -r "No card needed" src` | S1 | pass |
| 13 | Pending signup variant | browser (billing off and on) | S2 | pass. h1, sub with the name at weight 500, business row with 34px LogoTile and `Status ok` "Ready". |

### Gating and journeys (billing on unless noted)
| # | Check | How | AC | Result |
|---|---|---|---|---|
| 14 | Journey A | browser, `/start?domain=HTTPS://www.Fieldnote.app/x` | G1 | pass. Cleaned to `fieldnote.app`; analysis starts with no click; query stripped. Review edit shows "Edited" → GSC → Save "Save profile & continue" → pending `/signup` → signup → `/start-trial` with art and Back link → 3DS card (Fail, then Complete) → success → "Open dashboard" → `/dashboard`, scrolled to top, toast "Your free trial has started.", query stripped. `/profile` keeps the edit. |
| 15 | Journey B | browser: signup `qa-b1` → `/onboarding` → … → Save "Save profile & continue" → `/start-trial` → pay → dashboard | G2 | pass. Draft committed `active`; `trialing`; one toast. |
| 16 | Page guard for no session, guest, owner without access, owner with access (trialing and comp), member | `<ev>/curl/matrix.sh` → `matrix-on.txt` (pages block) | G3 | pass. Details below. |
| 17 | API gate: 7 actors × 6 businesses × `workspace`, `act` (`suggestions.list`, `onboarding.step`), `events` | `matrix.sh` → `<ev>/curl/matrix-on-biz.txt` | G4 | pass. Details below. The `act(onboarding.step)=500` column in `matrix-on.txt` is my script's quoting bug (an extra `}` in the JSON); `matrix-on-biz.txt` is the corrected rerun. |
| 18 | Claim at email signup keeps the edit and Edited flag | journey A, DB `edited` | G5 | pass |
| 19 | Claim at sign-in to an existing account with access | browser: guest draft (edited) → pending signup → Sign in as `qa-b1` | G5 | pass on the data: `/dashboard?saved=profile`, toast "Business Profile saved", draft committed under `qa-b1` with `{"business.description":true}`. See D2 for which business is shown. |
| 20 | Claim at sign-in without access | browser: guest draft → sign in as `qa-off-2` | G5/G6 | pass. `/start-trial` with "Claim Noaccess Qa is ready to be found." and Back link. After paying, the dashboard shows the claimed business. |
| 21 | Google sign-up claim with an edit and stub GSC connected | `pw/claim-google.mjs` (`claim-google.txt`, `claim-google-trial.png`) | G5 | pass. Real popup to `/api/oauth/gsc/callback`; property picked; `/api/auth/google/start?dev_as=qa-g1@radar.test` → `/start-trial` with art and Back link. DB: owner `qa-g1`, `edited` kept, `gsc_connections` row `connected` on the claimed business, guest row deleted, `radar_guest` cleared. |
| 22 | Returning sign-in | browser and curl: seed (comp) → `/dashboard`; `qa-off-1` → `/start-trial`, no Back link, no art | G6 | pass |
| 23 | Second business while subscribed | browser, `qa-a1` "Add a business" | G7 | pass. Label "Save profile & open dashboard"; one "Business Profile saved" toast; new business current. Without access the label is "Save profile & continue" with arrow (`qa-b1`, guests). |
| 24 | Back links | browser | G8 | pass. Pending signup → Save step intact (billing off and on). Trial → `/onboarding` Save step, no new jobs. A returning owner sees no Back link. |
| 25 | Resume | browser plus `jobs` table | G9 | pass. Reloading `/start?domain=fieldnote.app` resumed at GSC with no new job. `/start?domain=g9-other-qa.com` on a guest draft for `ratelimit-qa.com`: same draft id, domain changed, `analysis.site` count 1 → 2. |
| 26 | Abuse limits | curl with distinct `X-Forwarded-For` (`<ev>/curl/ratelimit.txt`); browser | G10 | pass. Per IP: analyses 1–5 → 200, the 6th → 429 "You’ve started several analyses in a short time. Try again in an hour." Per domain: the 11th analysis of one domain → 429 "Radar has analyzed dom-limit-qa.test several times today. Try again tomorrow." Guest creation: the 11th per IP → 429. Browser: `/start?domain=` at the limit shows the copy inline (`role=alert`, `aria-invalid`), and the domain stays filled. 24h retention: `jobs/guestCleanup.ts` (24h, no live session) plus unit tests. |
| 27 | An invited member gets in without paying | browser: `qa-a1` invites `qa-member1` (Editor) in Settings → Team; `outbox_emails` row `logged`; link → `/signup?next=…` → signup → `/dashboard` on "Second Biz Qa". A second invite to an existing user (`qa-b1`) through "Sign in" kept `next` and opened Fieldnote. | D6 | pass. Member active, no `billing_accounts` row; `regress.mjs on-member`: every page 200 with 0 errors. |
| 28 | Member when the owner lapses | curl: `qa-a1` `past_due` → member `/dashboard` → `/onboarding`; workspace 402; `/api/me` lists the business with `access:false`. Owner back to `active` → member 200. | D6 / logged "Team members" | pass, as logged (see O2) |

### Payment (stub provider)
| # | Check | How | AC | Result |
|---|---|---|---|---|
| 29 | Trial page layout vs prototype at 1440 and 375, light and dark | `pw/trialfid2.mjs` (merged prototype) and `trialfid.mjs` (`trialfid.txt`, `trial-proto-*.png`, `trial-prod-*.png`); built-in browser in light, dark and 375 | P1 | pass. At 1440: h1, button and form box are identical, colors are identical in both themes, and the copy is identical apart from the date. At 375, production collapses to one column with no art headline (logged; the prototype doesn't collapse). "Use a sample card" is not shipped. |
| 30 | Validation on submit | browser (stub fields) | P2 | pass. All four errors show on empty submit in `--bad`, and focus goes to the card. Expired → "This card has expired"; month 13 → "Use MM / YY"; CVC → "3 or 4 digits"; ZIP → "Enter your ZIP". The real Stripe Elements path is blocked (no keys). |
| 31 | Decline, 3DS and busy copy | browser | P3 | pass. `4000…0002` shows the `role=alert` copy, stays on `/start-trial` with status `none` and no fingerprint. `…3155` opens the 3DS panel: Fail → decline alert; Complete → success. The button reads "Confirming your card…" and is disabled while running (MutationObserver capture). `setup_future_usage: 'off_session'` is set on the PaymentIntent in `src/server/billing/stripe.ts:84` (from code; the real Stripe call isn't exercised). |
| 32 | Subscription starts once | DB plus server log | P4 | pass. One `none → trialing` per account; `trial_credited_at` set (−$1 credit); fingerprint recorded; draft committed on confirm. The real Stripe calls are not verifiable on the stub. |
| 33 | Webhook signatures and replay | `<ev>/curl/webhook.py` → `webhook.txt` (server session 3) | P5 | pass. Valid → 200. Replay with the same id → 200, logged `replay`, one `billing_events` row (attempts 1). Tampered body, timestamp −600s, wrong secret, missing header and v0-only → 400 "Bad signature". Unhandled type → 200, processed. With no secret configured → 400 "Webhook signing secret not configured" (server session 2). |
| 34 | Dates match `GET /api/billing/state` | browser vs API vs DB | P6 | pass. `qa-a1` `trialEnd` 2026-10-28T04:08:36Z = DB `trial_end`; `qa-b1` 2026-10-28T04:19:52Z. The page shows Wed, Oct 28 in the browser's time zone. |
| 35 | Lapsed accounts | `POST /api/billing/dev/simulate` plus browser | P7 | pass. `past_due` → app routes and APIs go to `/start-trial` (402) with "Restart your subscription", "Today · $49" (open invoice, credit applied), "Pay $49 and restart" → paid → `active`. `canceled` → "Today · $50", no trial → paid → `active`. |
| 36 | The amount shown on restart equals the amount charged | stub harness `<ev>/stub-credit-check.ts` plus code | P7 / §21 | **fail: D1** |
| 37 | Repeat card | browser: `qa-off-1` with `qa-b1`'s card `…1012` | P8 | pass. `role=alert` "This card has already been used for a free trial. Try a different card."; no subscription, nothing charged; a fresh card then succeeds. |
| 38 | Page title in restart mode | browser | P7 (copy) | **fail: D3** (cosmetic) |
| 39 | Claim with access opens the claimed business | browser (see check 19), billing on; curl recheck, billing off, email and Google (`<ev>/curl/d2-recheck.txt`) | G5/G7 | **fail: D2** (with the flag on and off) |

### Rollout, regression, security
| # | Check | How | AC | Result |
|---|---|---|---|---|
| 40 | Flag off behaves as before | browser journey A (guest → pending signup → signup → `/dashboard`, toast, `edited` kept) and journey B (→ "Save profile & open dashboard"); `/start-trial` → `/dashboard`; `regress.mjs billing-off` (`regress-billing-off.txt`) | R1 | pass |
| 41 | Grandfather, then flip | re-ran the 0008 SQL; flag on; seed → `comp`, every app route 200, `/start-trial` → `/dashboard` | R1 | pass (see O1) |
| 42 | Docs and config | `.env.example` (`RADAR_BILLING`, `STRIPE_*`, `RADAR_BILLING_GRANDFATHER_BEFORE`); `docs/LAUNCH.md` §7c (price, webhook URL, seven events, test-mode run list, flip, cutoff) | R2 | pass |
| 43 | Signed-in regression with billing on | `regress.mjs on-seed`, `on-a1`, `on-member` (`regress-on-*.txt`, PNGs) | — | pass. All 8 app pages plus the article land with 0 console errors, 0 page errors and 0 HTTP ≥400. The Settings sidebar shows Search Console, Publishing, AI models, Calendar, Team, Account. |
| 44 | Log out and sign in | browser account menu "Log out" → `/signin`, `/api/me` 401, `/dashboard` redirects; sign in again | — | pass |
| 45 | `currentUser()` never returns a guest | code (`guest = false` filter); a guest jar gets 401 on `/api/me`, `/api/billing/state` and `/api/admin/metrics`; invites send a guest to sign in | security | pass |
| 46 | Stub routes 404 unless the provider is stub | code: `dev/simulate` and `dev/confirm-intent` throw `notFound()` before importing the stub; `stub.ts` throws if loaded in production | security | pass (from code, not exercised) |
| 47 | No secrets or card data in logs or `events` | grep across all four server logs; SQL over `events.props` | security | pass. No PAN, whsec/sk/client secret, or password values. The 13-digit numbers are timestamps. `user.signed_up {method:"password"}` is a label. Billing events hold ids and statuses only. |
| 48 | Guest cookie flags | curl headers; Playwright cookies | security | pass. `radar_guest` is HttpOnly and SameSite=Lax (secure in production per code), and it's cleared after a claim. |

**Gate matrix detail (checks 16–17), billing on**
- **No session:** app pages → `/signup`; `/onboarding` → `/signup`; `/start-trial` → `/signup`; APIs → 401.
- **Guest:** app pages → `/signup`; `/onboarding` → `/start`.
  - Own draft: workspace 200, events 200, `onboarding.step` 200; `suggestions.list` (not allowlisted) → **402**.
  - Any other guest's draft, another user's draft, or an active business → **404**.
- **Owner without access (`qa-off-1`):**
  - Pages → `/start-trial`; `/onboarding` and `/start-trial` → 200.
  - Own active business → 402 on workspace, act and events.
  - Everything else → 404.
- **Trialing owner, comp seed, member of a trialing owner:**
  - Pages 200; `/start-trial` → `/dashboard`.
  - Exception: the member gets the page, by design (O5).
  - Their own business → 200; the member gets 403 on the Owner-only `onboarding.step`.
  - Everything else → 404.

## Defects

### D1 — minor: restart after a trial canceled before its first invoice shows $50 but charges $49
**Tested revision:** 876329bc.

**Repro**
1. Start a trial (any stub card).
2. `POST /api/billing/dev/simulate {"status":"canceled"}`.
3. Open `/start-trial`. It shows "Restart your subscription", "Today · $50" and "Pay $50 and restart".
4. Pay. The success screen says "Your next payment of $50…".

**Expected:** the amount on the button and timeline equals the PaymentIntent amount. Alternatively, the unused $1 credit is handled explicitly.

**Actual:** the PaymentIntent is $49 (4900).
- Empirical: the stub harness `<ev>/stub-credit-check.ts` creates a customer, adds the −100 credit, starts a trialing subscription, cancels it, then creates the incomplete restart subscription. Output: `restartPIs:[{amount:4900}]`, balance 0.
- Cause in code: `src/server/billing/state.ts` sets `due = PRICE_CENTS` for every non-`past_due` restart, while `stub.ts` `invoiceFor` applies the customer's credit balance.
- Real Stripe also applies customer balance to the next invoice, so production would probably behave the same (not verified without keys).
- The user is charged less than shown, but a payment button should state the actual amount.
- This also conflicts with the logged DIVERGENCES row "`canceled`: new subscription at $50 now". It's a deviation from that record, not only a copy issue.
- It does **not** affect an account whose credit was already used by a `past_due` invoice. `qa-off-1` paid $49 on `past_due`, then $50 on the canceled restart, both correctly.

**Evidence:** the `qa-b1` flow (trial → `canceled` → restart, `logs/dev-on-1.log`); `<ev>/stub-credit-check.ts`.

### D2 — minor: claiming by sign-in or Google into an account that already has access and a business opens a different business
This happens with the flag **on and off**. No cookie precondition is needed.

**Classification:** introduced on this branch, not a baseline issue.
- `main` has no guest or claim flow: `src/server/auth/claim.ts` and `src/server/billing/guard.ts` don't exist there.
- `main`'s `POST /api/auth/signin` only creates a session.
- The claim and commit path came in with T3 (`ee3bfd7f`, `9c06b788`) and was wired up by T4.

**Repro (browser, billing on)**
1. As a guest, run `/start?domain=claim-signin-qa.com`, review, skip GSC, then Save.
2. On the pending signup, choose "Sign in" and sign in as `qa-b1`, an account with access and an existing business.

**Repro (curl, billing off, fresh jar with no `radar_biz` cookie; `<ev>/curl/d2-recheck.txt`, `logs/dev-off-2.log`)**
1. Guest: `POST /api/b {"domain":"d2-signin-off.test"}`.
2. `act onboarding.save` → `{committed:false, next:"/signup"}`.
3. `POST /api/auth/signin` as `qa-b1` → `next: "/dashboard?saved=profile"`.
4. `GET /api/me` → `currentId` is `4a4175f8` (fieldnote.app, where `qa-b1` is only an invited Viewer), not the claimed `96beeced`.
5. The same happens with Google: `/api/auth/google/start?dev_as=qa-off-1@radar.test` → `currentId` is `5d55b8e8` (northwind-studio.com), not the claimed `ea55b391`.

**Expected:** `/dashboard` opens the profile just saved. AC-G7 does this, and so does the paid-trial path, because `billing/start` and `billing/confirm` set `radar_biz`.

**Actual:** the toast "Business Profile saved" shows over another business. The claimed one is only in the switcher.

**Cause:**
- `destinationAfterAuth` → `resolveEntry` (`src/server/billing/guard.ts`) commits the draft but never sets `radar_biz`.
- `getMe` then picks the cookie's business, or else the oldest accessible business (`listBusinesses` orders by `created_at`).
- From code, not exercised: `trialGuard`'s commit branch has the same gap. It's reachable only when a user with access still has a saved, uncommitted draft.

**Evidence:**
- Browser: DB row `d7d8e159…` is `active`, owned by `qa-b1`.
- Flag off: `<ev>/curl/d2-recheck.txt`.

### D3 — cosmetic: `/start-trial` is titled "Start your free trial · Radar" in restart mode
**Repro:** put an account in `past_due` or `canceled`, then open `/start-trial`.

**Expected:** a title that matches the h1 ("Restart your subscription"), which is what screen readers and the browser tab announce.

**Actual:** the static metadata title in `src/app/(auth)/start-trial/page.tsx`.

## Observations (not counted as defects; the PM decides)
- **O1. Rollout risk at flag flip (AC-R1).**
  - `0008` comps only owners who had an active business when it ran.
  - Owners who sign up between merge and flip (here `qa-off-1` and `qa-off-2`, created with the flag off) are sent to `/start-trial` when the flag turns on.
  - `docs/LAUNCH.md` §7c documents `RADAR_BILLING_GRANDFATHER_BEFORE`, but marks it optional.
  - Suggestion: make re-running 0008 or setting the cutoff a required flip step, or confirm that charging these users is intended. Nobody is locked out at the merge deploy itself, because the flag is off.
- **O2. Member whose owner lapses mid-session.**
  - The next action returns 402, and the client sends the member to `/start-trial`.
  - That page offers the member their own trial, which wouldn't restore access to the owner's business. A fresh navigation goes to `/onboarding` instead.
  - Covered by the logged "Team members / Lost access" rows, which are Needs approval. Flagged because the 402 redirect looks wrong for members.
- **O3. Stub-only date mismatches** (dev only; not reproducible with real Stripe as far as I can tell):
  - `past_due` simulated during a trial shows "Oct 28" before paying and "Nov 24" afterwards (the stub starts a new 30-day period).
  - A canceled restart shows "Nov 25" before paying (one calendar month) and "Nov 24" afterwards (stub `MONTH = 30 days`).
- **O4. Baseline:** a malformed JSON body to any API returns 500 "Radar couldn’t finish this." `src/server/http/handle.ts` hasn't changed since the scaffold, so this isn't a regression.
- **O5.** A member with no own business can open `/start-trial` directly and sees the trial offer. This matches `trialGuard` in the architecture and is harmless.
- **O6. Minor a11y on the stub card fields:** errors are not linked with `aria-describedby`, though the inputs are labelled by wrapping labels. The stub is dev-only; the Elements path wasn't testable.
- **O7.** The logo tile for stub domain `qa-off-two.com` rendered blank (the stub logo image). A stub artifact.
- **O8.** The update's `prototype/` can't run `Radar.html` on its own. It needs the base and earlier updates layered (see Environment).

## Not run or blocked
- **Blocked: real Stripe.** No test keys. Not covered: Elements iframes and their error codes, the Stripe 3DS modal, real webhooks from the Dashboard, customer-balance behavior, and the $49 first invoice. These need the LAUNCH §7c test-mode run list.
- **Not run (4):**
  - Safari, Firefox and real phones (Chromium only).
  - Live Google OAuth and real Search Console (the dev stubs were used).
  - `next build` production build.
  - Hourly guest cleanup executed in real time (covered by code reading and unit tests only).
- **Not applicable (1):** Turnstile. It's only a seam in this update.
- **Evidence retention:** `<ev>` is in this session's scratch directory, which doesn't persist. Copy anything you want to keep.
- Passing these checks doesn't prove every behavior is correct; it covers the scenarios listed above.
