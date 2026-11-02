# Independent launch QA

Date: 3 November 2026 (Asia/Dubai). Target launch: 4 November. Read production-launch brief, marketing-trial-gating acceptance criteria, Stripe billing brief/QA/provisioning evidence and launch checklist before testing. Workspace: `/Users/ekene/Downloads/design_handoff_radar/radar-push`. Initial local HEAD `e8514678`; PM subsequently selected branch `kenny/production-launch`, based on main `0a9af070`. Existing unrelated dirty records and tsconfig changes preserved.

**Final QA:** observed software acceptance passes at source commit `1f6a1a1b14f5ae298bd188fa47c3d6dfa11e87f9`, source fingerprint `137481f32404de0d8c755c9295fe4865363de733cc3c8b673deb794463f47583`, release BUILD_ID `NNH2Klc26NzUsej_cYYXV`. Public production-mode smoke15/15, actual Stripe browser9/9, earlier full local journey6/6 and delayed hydration3/3. Final independent affected suite373 passed with the single unchanged native raster golden baseline failure; no skips in that run. Q3-D1 cancellation defect is fixed and independently closed below. PM owns full-suite/build/load, rollout and remaining operational decisions. This is a verified local production binary, not a claim that changes have been deployed.

## Live read-only baseline

Target: `https://radar.thally.io`. Playwright drives installed native Google Chrome headlessly in fresh anonymous browser contexts, desktop 1440×900 and mobile 360×844, reduced motion. No live signup, login credential submission, payment, analysis, publishing or customer-data mutation. Google start creates its normal OAuth state row, then navigates to Google's sign-in screen; no Google account authenticated. Public deployment commit provenance is supplied by PM, since public pages expose no SHA.

Browser checks cover nine public routes, legal contact links, direct anonymous protected entry, client-side empty/malformed signup and signin validation, OAuth start parameters/error recovery, mobile overflow and browser/asset failures. **7/7 groups passed**, 3 November 2026 at 00:26:11–00:26:32 Asia/Dubai (machine timestamps retain UTC). Harness: `node .factory/production-launch/qa/public-smoke.mjs`; evidence: ignored `.data/production-launch/qa/public-smoke-results.json`, `public-pages.json`, `public-smoke.log`, and `live-*.png`.

Initial confirmed content failures against AC1, subsequently corrected locally by PM:

- Published Terms contain no price, $1 card confirmation/credit, three-day trial, auto-renewal or cancellation explanation, despite pricing/trial UX. Source `src/app/(public)/terms/page.tsx`; live text retained in `public-pages.json`.
- Published Privacy omits Stripe/payment metadata and active OpenRouter routing, and makes a blanket API-provider training claim. Source `src/app/(public)/privacy/page.tsx`. PM owns correction and legal limitations.
- All three live legal pages expose a real mailto contact. Owner authorized reuse of Thally/Fairspleet identity/policies. Local corrected policies show Fairspleet LLC/address, support/legal mailto links and linked Thally terms/privacy/refunds. QA verifies display and product consistency, not legal sufficiency.

Two initial harness failures were corrected after inspecting actual expected behavior: a callback without valid state deliberately returns `/signup?error=google`; Playwright's redirect interception did not reliably capture the first Google URL, so the harness now reads the actual application's 307 Location. These were harness assumptions, not reported product defects.

## Local verification environment

Created and migrated isolated database `radar_launch_qa_20261103` in existing `radar-sc-db` on localhost:54329. No remote database writes. Next development server `http://localhost:3900`, separate worker, unique `.next-launch-qa` build output, development mode, `RADAR_DEV_STUBS=1`, `RADAR_BILLING=on`, test-only encryption key, no real provider credentials. Ordinary accounts created through the actual browser signup form; synthetic site and card details only. Desktop 1440×1000 and mobile 390×844, native headless Chrome.

**6/6 integrated browser groups passed**, 3 November at 00:31:06–00:31:38 Asia/Dubai:

- Email signup normalizes whitespace/case, opens onboarding and keeps its session across reload; cookie HttpOnly/SameSite=Lax.
- Invalid website has useful error. Real local worker completes site analysis; review can edit the business name, refresh resumes at Search Console with the edit retained, skipping Search Console and saving opens trial.
- Trial shows $1, three days, $49 first monthly bill, then $50/month, credit and cancellation disclosure. Blank card validates; declined stub card displays error without subscription/access.
- Successful synthetic card starts a stub trial, preserves server trial end/price, opens the correct saved business, survives dashboard refresh, and shows own Trial account in Billing at desktop/mobile. No document overflow at 390px. Inspected screenshots of trial disclosure, mobile billing and mobile privacy; no clipping observed.
- Duplicate signup has useful error; wrong signin preserves form with useful error; correct signin reaches dashboard; signout removes protected access.
- Local `/api/health` returns 200 `{ok:true}` and no-store. Updated Terms include all price/trial/renewal/cancellation/refund claims; Privacy includes Stripe/OpenRouter. Terms/Privacy/Bot display contact links and fit at 390px. No unhandled browser errors.

Command: `node .factory/production-launch/qa/local-journeys.mjs`. Clean successful log: `.data/production-launch/qa/local-journeys-verified.log`; report `local-journey-results.json`; screenshots `local-*.png`; full visible local legal text `local-legal-visible.json`. Tested base `0a9af070` plus working changes, source fingerprint `5304f1fd135accd2e462d46abf61d8c15220e1bd8965cbcd1b42c20704831a4a` (sorted tracked and untracked unignored `src` files plus package/lock/web deployment config; path/NUL/contents/NUL SHA256). Subsequent addition of architect's `src/server/services/publishing/http.test.ts` changes full fingerprint to `42f0af378786810440774700a12b426b75ce3ee9028313cfd70d26962c57710f`; no runtime source changed after the browser run at that comparison.

## Hydration defect and retest

QA reproduced an existing cold-page defect: SSR-visible form submission could execute native GET before React attached handlers, resetting values (`GET /signup?` or `/start-trial?`). Sent through PM to E1. Fix disables signup/signin Google/submit/inputs and trial submit/card fields until mounted and guards early/busy handlers.

**3/3 delayed-JavaScript browser checks passed** against final client fix at 00:31:53 Asia/Dubai. Held three Next JS bundle requests per page, asserted SSR inputs/submit disabled, native button click caused no navigation or application POST, released bundles, confirmed enabled controls and handled empty-input validation with no native navigation. Covered signup, signin and authenticated trial. Harness `node .factory/production-launch/qa/hydration.mjs`; report `hydration-results.json`, screenshots `hydration-*-{before,after}.png`. An initial harness counted Next's development diagnostic POST as an application write; filter corrected to `/api/` requests. Earlier aborted/partial harness logs are not acceptance evidence.

## Independent developer checks

`DATABASE_URL=postgres://postgres:radar@localhost:54329/radar_launch_qa_20261103 RADAR_DEV_STUBS=1 npm test -- src/server/auth src/server/billing src/features/billing src/server/abuse src/server/events/cache.test.ts src/app/api/health/route.test.ts src/server/services/analysis/crawl.test.ts` → **24 files, 187 passed, none skipped**, including final Stripe timeout/credit regressions. Log `focused-tests-final.log`. Covers account limits/body bounds/concurrency, browser-bound expiring Google state, claim persistence, access/portal isolation, webhook races/credit retry, restart/grandfather behavior, SSE cache concurrency/isolation/recovery, safe crawler redirects and readiness failures. Auth/trial mount follow-up verified independently by real browser afterward; no implementation-mirroring static test added.

Known full-suite baseline raster golden mismatch is separate and unchanged; PM owns integrated full suite/build/typecheck/load results. Passing cache-unit concurrency does not establish HTTP throughput. QA web/worker stopped after tests; removed only QA's `.next-launch-qa/types/**/*.ts` generated tsconfig entry, preserving pre-existing and PM build entries. `git diff --check` passed.

## Blocked / not run

- Earlier real Stripe blockage was subsequently resolved with authenticated sandbox access. See Q3 below for actual-provider acceptance and the cancellation-sync defect found there. Stub-only claims above remain limited to their original environment.
- Authenticated live signup/onboarding, actual Google login/Search Console, real mail delivery and live publishing were outside authorized read-only production QA and were not run. Google browser start reaches configured sign-in; app verification status remains unverified.
- Real-provider past-due/restart recovery was not exercised; local stub/database regressions cover it. Password recovery/email verification are not implemented in the existing product; E1 records operator support/verified Google sign-in as the current recovery route.
- Safari/Firefox/physical devices not run; observed Chrome mobile viewport only.
- Heavy-traffic capacity and external ongoing monitoring remain PM/architect evidence. Authenticated production backup readback found no native backups/schedules; daily-backup setup was refused because Railway requires Pro and the workspace is Hobby. Architect subsequently produced a private local snapshot and successfully restored it into isolated PostgreSQL18, matching five aggregate production counts; see `qa/backups.md`. Owner keeps Hobby and will arrange private offsite storage. Automated daily/offsite recovery remains unresolved; a local verified archive does not establish that protection. No live load test, production mutation or QA deployment.

## Current acceptance coverage

| Criterion | Status |
|---|---|
| AC1 public navigation/mobile/contact | Passed live baseline navigation and local corrected policy display/content; legal approval is owner responsibility |
| AC2 signup/signin/Google security | Passed local browser/session/errors/hydration and DB boundary tests; real Google completion unverified |
| AC3 billing behavior | Passed local regressions and actual sandbox Elements/3DS/decline/repeat card/portal card+invoice/cancellation-return flows; fresh signed event closes cancellation-sync defect |
| AC4 deployment/health/pool/SSE | Local health/browser job updates and focused cache/health tests passed; infrastructure evidence PM/architect |
| AC5 integrated checks/browser/load | Independent public/local/hydration/browser and 187 focused tests passed; integrated build/load owned by PM |
| AC6 rollout/release | PM owns; no QA merge/deployment |

Recommendation: observed software changes are acceptable for PR review with known baseline raster exception recorded. Public corrected legal pages/auth hardening remain undeployed until authorized delivery. Passing observed smoke checks does not prove Railway production traffic capacity; operations limitations require explicit release judgment. Real-provider browser acceptance no longer remains blocked by lack of sandbox access.

## Q2 final network/privacy hardening verification

After the prior browser pass, runtime changes added socket-level DNS validation through a dedicated pinned `undici` 7.30.1 Agent, per-hop publishing redirects with cross-origin credential stripping and same-origin write preservation, crawler use of the pinned dispatcher, production-mode stub suppression, and OpenRouter text `provider.data_collection: 'deny'`. UI source remains the browser-tested final hydration/legal version.

Independently reviewed changes/tests and ran against the isolated QA database:

`DATABASE_URL=postgres://postgres:radar@localhost:54329/radar_launch_qa_20261103 RADAR_DEV_STUBS=1 npm test -- src/server/auth src/server/billing src/features/billing src/server/services/publishing/http.test.ts src/server/services/publishing/connectors.test.ts src/server/services/analysis/crawl.test.ts src/server/http/publicNetwork.test.ts src/server/env.test.ts src/server/ai/openrouter.test.ts src/server/ai/openrouter.qa.test.ts`

Result: **357 passed, 1 known baseline failure, no skips** across 26 files. Only failure is unchanged native branded raster golden in `openrouter.qa.test.ts`: expected `f883614e6a7dfb07`, actual `91d5409f50974af7`; no expected image/hash was changed. Log `.data/production-launch/qa/final-integrated-focused-tests.log`. New socket tests verify one validated DNS result reaches the connection lookup, mixed/private and IPv4-mapped IPv6 destinations are blocked, and public TLS hostname is preserved. Publishing regressions cover each redirect check, loops, GET/HEAD continuity, auth/cookie removal, preserved write body/method on allowed 307/308, rejected unsafe writes, explicit redirect modes, and connector refresh behavior. Env and OpenRouter assertions cover production stubs off and text privacy routing.

Exact tested base `0a9af070` plus working changes, 408-file source/package/deployment fingerprint: `8c76529330da1dfd14c7540e343e98a7c372d848d319f401ab632c6ba6c51c6e`. Per-file SHA256 manifest `.data/production-launch/qa/final-source-fingerprint.json`, using the earlier path/NUL/contents/NUL algorithm. PM owns production build/load/deployment metadata.

Final production-mode Chrome smoke at `http://localhost:3901`: **15/15 checks passed** against PM-confirmed `.next-launch-build-final` BUILD_ID `fQAS3QW-qLMiPPO_ayayr` (also read locally by QA), local DB, stubs disabled, billing enforcement off. Six public pages at 1440/360px, final policy content, enabled/hydrated signup/signin empty validation, anonymous dashboard gate, readiness 200/no-store, no browser/asset failures. Harness `.factory/production-launch/qa/production-smoke.mjs`; evidence `.data/production-launch/qa/production-smoke-results.json`, `production-smoke.log`, `production-{signin,terms}-mobile.png`.

PM subsequently obtained actual sandbox access; Q3 below records the separate actual-provider test. Capacity/backup limitations above remain unchanged.

## Q3 actual Stripe sandbox acceptance

PM provisioned authenticated **test-only** Stripe account, exact $50/month price and dedicated portal. Separate local database `radar_launch_stripe_sandbox`; final production binary, stubs disabled, billing enabled. Stripe CLI 1.55.6 listens to the seven configured events and forwards actual signed Stripe deliveries to local `/api/billing/webhook`. No production Stripe configuration/customer/subscription was changed and no real card was used. Credentials/signing secret never entered QA records or source. Official synthetic cards verified through `stripe docs /testing` ([Stripe testing reference](https://docs.stripe.com/testing)).

QA used native Chrome, ordinary local browser signup, and a synthetic saved profile created through actual `/api/b` and `onboarding.save` endpoints without crawling or AI. This isolates payment acceptance from previously verified full stub onboarding. Initial HTTP sandbox port3902 correctly refused hosted portal creation in production because return URLs require HTTPS. PM supplied a self-signed **local fixture only** TLS proxy `https://localhost:3903` → HTTP3902 and matching APP_URL; isolated QA context uses `ignoreHTTPSErrors:true` solely for this fixture. No user trust-store/security settings changed.

Observed actual-provider passes:

- Real split Stripe Elements loaded. Generic-decline test card returned useful decline copy and no access.
- Real `stripe-challenge-frame` on `testmode-acs.stripe.com` appeared for always-authenticate card3184. **Fail** recovered with decline/no access; retry **Complete** succeeded, started trial, committed the saved business and opened that exact business.
- Independent GET readback from Stripe confirmed **one succeeded $1 USD payment**, two prior unsuccessful intents canceled, customer balance **−$1**, trialing subscription and exact trial_end matching local persisted date; credit recorded. Evidence `stripe-real-account-check.json`.
- Same previously trialed real card on a separate account was refused with repeat-trial copy/no access. Replacing it with ordinary4242 succeeded through real Elements and started that account's trial.
- Hosted `billing.stripe.com` portal opens, displays **$49 next estimated payment**, accepts replacement4242 as default, shows invoice history, and opens its actual paid trial invoice on `invoice.stripe.com`. **Download invoice** produced a valid20,675-byte PDF. Return link comes back to `/settings?section=billing`.
- Cancellation in the hosted portal applies at trial/period end. Actual signed payment/subscription/invoice webhook rows processed without errors. E3 drove a separate actual test-clock $1 payment, first paid recurring invoice49 and next50. QA independently performed GET-only readback of the retained E3 Stripe customer: succeeded payments100/4900/5000 cents USD, paid first recurring invoice4900 with starting balance−100, later paid invoice5000 with balance0. Evidence `stripe-real-invoices-independent.json`. Clock advancement belongs to E3; these actual amounts were independently checked by QA.

### Q3-D1 — P2 cancellation display/sync defect (fixed; independently retested)

Criterion AC3 / Stripe AC2. Repro: real sandbox trial → Settings Billing → Manage billing → hosted Cancel subscription → confirm → return to Radar → reload. Expected: cancellation warning/date while paid access continues to the end. Original actual: portal says **Cancels Nov5**, but Radar shows an ordinary Trial and `cancelAtPeriodEnd:false` after the signed update is processed. Real pinned `2026-05-27.dahlia` subscription shape: `status:'trialing'`, `cancel_at:1793911362`, `cancel_at_period_end:false`, `canceled_at:1793652415`, `ended_at:null`, `trial_end:1793911362`, first item `current_period_end:1793911362`. Existing normalization read only the explicit boolean. Stripe cancellation itself was applied; this defect affected Radar's display/state. E5 added equality-only normalization for supported at-period-end cancellation and actual-shape regressions. The final retest below closes this defect.

Evidence under `.data/production-launch/qa/`: `stripe-real-browser-results.json`, `stripe-real-cancellation-shape.json`, actual invoice PDF, and `stripe-real-*.png` covering decline/challenge/success/repeat rejection/portal/card update/invoice/cancellation/missing app warning. Browser scripts were executed through persistent Node REPL with Playwright; no session bearer URLs/cookies/client secrets saved to evidence. Initial harness waits assumed an iframe title/heading not used by Stripe; inspecting actual DOM corrected selectors. Stripe background network made `networkidle` unsuitable, so subsequent waits use observed page/frame readiness. Those selector/wait corrections are distinct from Q3-D1's real mismatch.

## Q4 E4/E5 independent regression checkpoint

Final affected suite repeated after publishing response-body deadline/ambiguous-write handling, webhook one-MiB body cap/early signature guards, and exact period-end `cancel_at` normalization: **373 passed, one unchanged baseline raster golden failure, no skips**, 27 files. Same Q2 command includes newly discovered `webhookBody.test.ts` through the billing directory. Log `e4-e5-final-focused-tests.log`. Independently inspected bounded raw-body signature/replay tests, real HTTP stalled-body tests and raw Dahlia normalization/DB sync tests. No new implementation failure observed.

Base `0a9af070` plus final working changes, 409-file source/package/web-deploy fingerprint: `137481f32404de0d8c755c9295fe4865363de733cc3c8b673deb794463f47583`, per-file manifest `e4-e5-source-fingerprint.json`. PM committed this source as `1f6a1a1b14f5ae298bd188fa47c3d6dfa11e87f9`; QA compared every saved source file after final build and found no changes.

### Final binary and real cancellation retest

PM restarted both local servers from `.next-launch-release`, BUILD_ID `NNH2Klc26NzUsej_cYYXV` (read independently from disk). **Production public smoke15/15 passed again** at port3901; final output `production-smoke-results.json` and clean `production-release-smoke.log`.

With explicit PM authorization, QA changed **only a tagged metadata field** on its retained test-mode subscription, preserving cancellation/payment semantics. This emitted fresh actual `customer.subscription.updated` event `evt_1UXSEDGaLrbBBaPsupf6Njxp`. Actual Stripe CLI delivery reached the signed final webhook handler, processed once at `2026-11-02T20:53:18.189Z` (UTC), without error. Stripe retained explicit `cancel_at_period_end:false` and `cancel_at==current_period_end`; local row and overview now correctly report true. Browser displays **Cancellation scheduled** and **Access ends** for the exact original end instant, survives reload on desktop and390px mobile, with no horizontal document overflow. Evidence `stripe-real-cancellation-retest.json`, `stripe-real-cancellation-fixed-{desktop,mobile}.png`, updated `stripe-real-browser-results.json` (**9/9 pass**). No processed-event replay was used to manufacture a sync result.

Owned QA browser closed afterward. No production resources, card charges, customer data or subscription semantics were mutated by this retest. Sandbox subscriptions/records remain for owner review; PM owns fixture servers and credential cleanup. Arbitrary custom-date cancellation outside the supported at-period-end portal remains explicitly unsupported separate timestamp semantics.
