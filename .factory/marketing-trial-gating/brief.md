# Marketing site, feature pages, signup gating and free trial (update 2026-10-25)

Source handoff: `design_handoff_radar 8/updates/2026-10-25-marketing-trial-gating/` (`UPDATE-2026-10-25-marketing-trial-gating.md` plus `prototype/`).
The approved design is that prototype. It sits on top of the earlier layers: `design_handoff_radar 3` (full), then 4, 5, 6 and 7.
The PM keeps the prototype diff against the previous layer outside the repo, in the scratchpad `diff/` folder, and hands it to each agent.
Fidelity: **high**. Colors, type, spacing, copy and behavior are final.

## User problem
Radar has no public website. `/` sends visitors straight to sign-up, and anyone who signs up gets the full product for free.
The business needs two things:
- A marketing site that explains Radar and turns a visitor's website into a started analysis.
- A paid trial gate: a $1 card check, then 3 days free, then $50/month. Nobody reaches the dashboard without an account and a `trialing`/`active` subscription.

## Smallest complete version (in scope)
- **Marketing pages** (handoff §5, §6, §7): home at `/`, plus `/features/organic-search`, `/features/ai-visibility` and `/features/backlinks`.
- **Two journeys into one gate** (§3.1):
  - **A, website-first:** `/start?domain=` runs an anonymous onboarding, then `/signup` (the "Save your Business Profile" variant), then `/start-trial`, then `/dashboard`.
  - **B, account-first:** `/signup`, then onboarding, then `/start-trial`, then `/dashboard`.
- **Server-side gating** (§3.4) on pages *and* on the business API.
- **Anonymous onboarding** (§3.5): a guest session, rate-limited crawls, a draft kept for at least 24h, then claimed at signup, sign-in or Google sign-in, with the Edited flags and the Search Console connection intact.
- **Trial page and payment** (§3.6, §4):
  1. Stripe Elements collects the card.
  2. A $1 PaymentIntent (`setup_future_usage: off_session`, 3-D Secure) confirms it.
  3. A Subscription follows: $50/month, `trial_end` = now + 3 days, with that card as the default payment method.
  4. Webhooks drive the status.
- **Signup and onboarding copy changes** (§4, "Signup changes"), and the SaveStep button label.
- **Narrow-width fixes** in the app (§1): the `Section` header wraps, the Performance chart wrapper, and the Backlinks proposal meta items.
- `RADAR_DEV_STUBS=1` payment stub so every flow runs locally without keys.

## Exclusions
- Real testimonials. The section stays **hidden** until real, permissioned posts exist (handoff acceptance check).
- Plan management UI (cancel, change card, invoices) and the Stripe customer portal. None of it is designed.
- Taxes, coupons, multiple plans, annual billing.
- The prototype's "Use a sample card" link, Tweaks, and the `?preview=` switches.

## Decisions (PM)
- **D1 Delivery.** Feature branch `kenny-dev/marketing-trial-gating` (cut from `origin/main` @ `ea70ecb2`), then a PR on `kenny-io/radar`. `main` deploys to Railway, so merging waits for the owner's go-ahead.
- **D2 Sign-in route.** Production keeps `/signin`. `/login` redirects to `/signin`, with the query preserved. Logged as a divergence.
- **D3 `/` for signed-in users.** A signed-in (non-guest) user who opens `/` goes to `/dashboard`, as today. The route guard takes it from there. Logged as a divergence.
- **D4 Brand logos on the marketing pages** come from the repo's bundled marks (`src/components/brand.tsx` / `src/lib/brandIcons.ts`), not hot-linked `google.com/s2/favicons`. Fonts come from the bundled `geist` package, not Google Fonts.
- **D5 Card fields.** Stripe's split Card Elements (number, expiry, CVC) plus our own ZIP input, so the designed rows survive. Raw PANs never touch Radar.
- **D6 Team members.** Billing is per account. An invited member of a business whose owner has a `trialing`/`active` subscription doesn't need their own. Logged.
- **D7 Prices and dates.** Server-computed. The timeline and success dates come from the same `trial_end` the subscription uses.
- **D8 Pending owner answers** (see state.md):
  - Existing accounts: grandfather (default) or gate them.
  - Rollout: a billing flag off by default (default) or gate at merge.
  - Stripe test keys.
  - The $1: kept (default), refunded or credited.

## Acceptance criteria
IDs are stable.

**Marketing**
- **AC-M1** `/` renders the home page from handoff §5 to a signed-out visitor. Sections run top to bottom, testimonials excluded. The nav turns `.day` once scrolled over the light page.
- **AC-M2** `/features/organic-search`, `/features/ai-visibility` and `/features/backlinks` render handoff §6, including:
  - the three live demos: keyword ceiling, assistant tabs with arrow keys and auto-advance, and Approve/Decline with Undo announced through `aria-live`;
  - facts, why, how-it-works, screenshot frames, spec list, principles, FAQ and cross-links.
- **AC-M3** Every website field (both hero fields and both closing cards):
  - cleans the input: trim, lowercase, strip `http(s)://` and `www.`, cut at the first `/ ? #` or whitespace;
  - validates it against `^[a-z0-9-]+(\.[a-z0-9-]+)+$`, then routes to `/start?domain={cleaned}`;
  - on invalid input, changes the note to "Enter your website, like yourcompany.com" and refocuses the input; the next keystroke restores the note.
  - It is never prefilled, and the `radar.home.domain` localStorage key is deleted on home load.
- **AC-M4** Links:
  - Every "Get started", "Start free trial" and "Analyze your website" button → `/signup`.
  - "Sign in" → `/signin`.
  - `/login` → `/signin`.
  - Footer: the three feature pages, Sign in, Privacy (`/privacy`), Terms (`/terms`).
- **AC-M5** Reduced motion:
  - The dot-field renders one still frame, demos show their end state, and reveals appear instantly.
  - Without WebGL, the hero is solid `#111318`.
- **AC-M6** Visual fidelity to the prototype at desktop and at 375px. Tokens follow §7.
  - No horizontal scroll at 375px.
  - The user's Radar appearance setting (light/dark/system) doesn't recolor the marketing pages.
  - No third-party requests for fonts or logos.
- **AC-M7** In the app at narrow widths:
  - The `Section` header wraps (`flexWrap`, `rowGap:10`, title `minWidth:0`).
  - The Performance chart wrapper is `min-width:0; overflow:hidden` and the suggestion rows are classed.
  - Backlinks proposal meta items (`Authority n`, `rel`) don't break inside.

**Gating and journeys**
- **AC-G1 Journey A.** `/start?domain=x` with no account:
  1. Analysis starts immediately, with no extra click.
  2. Review, then Search Console (optional), then Save.
  3. "Save profile & continue" → `/signup` in the pending variant.
  4. Sign up (email or Google) → `/start-trial`.
  5. A successful $1 payment → success → "Open dashboard" → `/dashboard`, scrolled to top, with the toast "Your free trial has started."
- **AC-G2 Journey B.** `/signup` in the default variant:
  1. Sign up → onboarding domain step (existing flow).
  2. Review, then Search Console, then Save.
  3. "Save profile & continue" → `/start-trial`.
  4. Payment → "Open dashboard" → `/dashboard`.
- **AC-G3 Server route guard** (§3.4).
  - Every app route:
    - no session → `/signup`;
    - session but no business → onboarding;
    - access not `trialing`/`active` → `/start-trial`.
  - `/start-trial`:
    - no session → `/signup`;
    - already `trialing`/`active` → `/dashboard`.
  - A direct URL can't skip it.
- **AC-G4 API gate.** For an `active` business, `act`, `workspace` and `events` refuse a user without access. A guest can reach only their own onboarding draft, and only the actions onboarding needs.
- **AC-G5 Claim.** The anonymous profile survives sign-up by email, Google sign-up, and sign-in to an existing account. That includes edits, Edited flags and a connected Search Console.
- **AC-G6 Returning sign-in.**
  - Has a business and access → `/dashboard`.
  - Has a business but no access → `/start-trial`, with no "Back to your profile".
- **AC-G7 Second business while subscribed.**
  - The SaveStep button reads "Save profile & open dashboard".
  - Saving commits → `/dashboard` with the toast "Business Profile saved".
  - Without an account or access, the button reads "Save profile & continue" with an arrow.
- **AC-G8 Back links.**
  - Signup (pending variant) → "Back to your profile" → the Save step with the profile intact.
  - Trial → "Back to your profile" → the Save step, shown only when an onboarding draft exists.
- **AC-G9 Resume.** Coming back to `/start` in the same session resumes at the last step. Reloading `/start?domain=` doesn't re-crawl an existing draft for that domain.
- **AC-G10 Abuse limits.** Anonymous crawls are rate-limited per IP and per domain, with readable copy when a limit is hit. Drafts are kept for at least 24 hours, then cleaned up.

**Trial and payment**
- **AC-P1 Trial page** follows §4: layout, art column, timeline and copy. Every date comes from the server's `trial_end`.
- **AC-P2 Card fields** are Stripe Elements. Validation runs on submit and shows the §4 table's messages inline in each field's hint.
- **AC-P3 Payment.**
  - $1 PaymentIntent with `setup_future_usage: 'off_session'`; 3-D Secure is handled.
  - While it runs, the button reads "Confirming your card…".
  - A decline shows the `role="alert"` copy and keeps the user on `/start-trial` with no subscription.
- **AC-P4 Subscription start.** After the $1 succeeds, the server creates the subscription exactly once, from either the confirm call or the webhook: $50/month, `trial_end` = +3 days, default payment method set. The success screen follows, then "Open dashboard" commits the draft.
- **AC-P5 Webhooks.** `invoice.paid`, `customer.subscription.updated/deleted` and `invoice.payment_failed` update the status, with signatures verified. Replays are idempotent.
- **AC-P6 Dates.** The trial end and first-charge dates shown match the subscription's `trial_end`.
- **AC-P7 Lapsed accounts** (`past_due`/`canceled`) see `/start-trial` worded "Restart your subscription", with no new trial.
- **AC-P8 Repeat trials.** A card fingerprint that has already had a trial doesn't get a second one.

**Signup copy**
- **AC-S1** The default signup sub reads "Set up your Business Profile, then start your 3-day free trial." "No card needed" no longer appears anywhere.
- **AC-S2** Pending variant:
  - h1 "Save your Business Profile".
  - Sub: "Create an account to keep **{name}** and open your dashboard."
  - A business row with a 34px LogoTile, the name and domain, and "Ready" as `Status ok`.

**Rollout**
- **AC-R1** The rollout follows the owner's answer in D8. Existing accounts are handled as decided, so nobody using Radar today is locked out at deploy.
- **AC-R2** Docs and config:
  - `.env.example` has the Stripe vars.
  - `docs/LAUNCH.md` has a Stripe section: price, webhook URL, events, test mode.
  - `DIVERGENCES.md` has a section for this update.
  - Migrations are generated and the tests pass.
