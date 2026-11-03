# Verification

Integrated implementation verified on `kenny/lifecycle-emails`, source fingerprint `3beebabab50b13b7629a49df808231ee6e52cc6b8232f55220817e3c432b2d50` (476 files, `src/**`, `next.config.ts`, `drizzle/**`; see QA manifest). Dedicated local databases only; no production fixtures, live charges or human emails. Production deployment remains pending owner merge approval.

Implementation commit `57b69edba3f570c371a877cdfd1cdfbc2c5f5e4a`; [PR25](https://github.com/kenny-io/radar/pull/25). Final documentation-only delivery checkpoint follows this source commit. GitHub reports no status-check runs for the head; do not describe an unconfigured CI check as passed.

Primary implementation references reviewed: [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys) (24-hour key window) and [OWASP forgot password guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

## Integrated checks

- Initial existing auth/billing baseline:38/38 passed. Final full database-backed suite: **920 passed,65 external-platform skips, one unchanged pre-existing raster golden failure**, across88 files. The sole difference remains `openrouter.qa.test.ts`: expected image hash `f883614e6a7dfb07`, actual `91d5409f50974af7`, matching the earlier production-launch baseline. No golden was changed, no failing test hidden. Command: `DATABASE_URL=<isolated local database> RADAR_DEV_STUBS=1 npm test`; log `/tmp/radar-lifecycle-final-tests.log`.
- Final lifecycle transport/loop checks31/31; auth28/28; billing-focused74/74. Independent auth/billing/lifecycle suite190/190, plus independently derived stale-proof and real stalled-body timeout tests2/2. New tests use actual local Postgres and fake providers; they cannot establish real Stripe email-event delivery.
- Optimized production build passed, `NEXT_DIST_DIR=.next-lifecycle-release`, build ID `t98zcdGosAvaGFXMeF-bd`; log `/tmp/radar-lifecycle-release-build.log`. Typecheck and diff checks passed; generated Next type includes are removed from the deliverable.
- Migration0009 applied on three dedicated local databases, including a fresh genuine production-runtime QA database. It adds only lifecycle mail, password-reset tokens and optional onboarding preferences. Existing production data and billing settings were not modified.

## Independent browser and worker evidence

See `verification-qa.md` and `qa/`. Real isolated Google Chrome: **45/45 dev checks and45/45 optimized production checks**, including20 email viewport cases per run. Core recovery, keyboard submission, desktop/mobile, token removal, GET safety, security headers, session revocation, old/new password behavior, expired/used/missing links, fresh same-tab fragment navigation, stale client-response handling, billing deep link/refresh, explicit optional-email opt-out, no horizontal overflow, and zero page errors all passed.

QA found and closed two defects: stale password authentication could mutate drafts before refusal; fresh reset fragments opened in the same tab were ignored. A permanent auth regression and independent browser retests cover the fixes. QA also held all four real local general-worker job slots busy; the independent mail loop processed its fixture in129ms with all four jobs still running. This is a concurrency proof, not a provider-latency or launch-capacity guarantee.

## Actual email provider smoke

`provider-smoke.ts` restricts its database to a separate local simulator database and its recipient to Resend's documented `delivered+radar-lifecycle-…@resend.dev` simulator. Existing production sending credentials were read into process memory only, never printed or saved. Actual `queueLifecycle` + `dispatchLifecycleBatch` sent welcome and password-reset fixtures once each. Both persisted `sent`, one attempt and provider acknowledgment; the connected Resend readback reported **delivered** for both. IDs: `01a1a1f9-b7b8-718f-a94f-f415efa7ca40` (reset) and `01a1a1f9-b97f-759f-8952-7aec61029985` (welcome). Synthetic accounts and encrypted local payloads were deleted afterward.

This validates the provider request path and simulator behavior. It does not demonstrate a human inbox receipt, spam placement, real paid customer events or new production deployment. No customer or support inbox was mailed. [Resend simulator documentation](https://resend.com/docs/dashboard/emails/send-test-emails).

## Rollout and limits

See `docs/LAUNCH.md` §13 and `launch-readiness.md`: apply0009 before new web serves; deploy matching web/worker source and verify the independent dispatcher. Existing secrets/sender suffice. Worker startup may precede web's migration; the mail loop retains the queue and backs off on transient database/configuration failures. No historical welcome/founder backfill or bulk campaign is scheduled. Legacy invitation/partner transport is unchanged. Monitoring, private offsite backup destination, Google public OAuth verification and one owner-controlled actual inbox receipt remain separately outstanding.

## Subsequent copy refinement

The owner rejected the initial voice as AI-written. All ten messages were revised against Radar's actual homepage and feature-page language; see `copy-refinement.md` and the independent `copy-review.md`. Current source fingerprint `8da069a6563db18e50d9c9c5b7a1f2fcdfcbe1f5ef42646b80379b972cb50f04`; the only runtime source change is the renderer's copy and welcome destination, which now uses the existing dashboard/setup guard. Existing template checks passed15/15 unchanged; independent HTML renders passed20/20 at390/600px, with updated screenshots in `qa/copy-refinement/`. No providers or human recipients were contacted for this pass. Earlier full-flow/build/simulator evidence belongs to its recorded prior revision; it was not rerun or relabeled as current full-flow verification for this copy edit. Merge/deployment approval remains pending on the same PR25.

## Journey correction after owner feedback

The preceding copy fingerprint is historical. The owner clarified that website analysis and Business Profile generation precede signup in the primary journey, and supplied the launch-video script as the founder-story source. See `journey-alignment.md`: signup now captures verified guest-analysis context before claiming it, without importing another visitor's business or relying on request-body fields. The founder note uses the supplied reason and a reply-for-help action. Current frozen source fingerprint `2a853cd54a02a6b2e567b225ce148ba207757d50cec362a1e4c6ec428d5d8824` (476 files).

Focused database/template suite31/31 passed (signup6, claim9, templates16), including password and Google analyzed profiles, direct signup, unfinished/latest versus stale analysis, concurrent dedupe and existing guest transfers. Independent boundary probes2/2 passed: forged body context cannot override cookie ownership, and expired cookies cannot borrow another guest profile. Independent local HTML checks22/22 passed for ten events plus the direct-signup variant at390/600px; latest screenshots and manifest are in `qa/journey-alignment/`. Typecheck and diff checks passed. No provider sends, account-setting/billing changes, merge or deployment. Earlier complete recovery/billing browser evidence remains tied to its recorded prior revision.

The corrected source also passed a fresh optimized production build, `.next-lifecycle-journey`, ID `Dkx2XsEZiU_IuZAm9gOI_`, log `/tmp/radar-lifecycle-journey-build.log`. The Next-generated TypeScript include was removed afterward. There was no additional real-provider send or claim of new end-to-end production-site verification.


## Brand correction and complete review gallery

The owner identified the generic concentric-circle character as an incorrect logo. All ten templates now use `public/brand/radar-mark-email.png`, a 96px PNG rasterized directly from the existing `radar-mark.svg` by `scripts/generate-email-brand.ts`, displayed at28px. The white image background preserves the dark mark in recoloring email clients; adjacent live Radar text remains visible with images disabled. The single asset uses the application origin, with no tracking or account tokens. This file must ship with the templates; it is not yet on production.

The complete offline-capable gallery is `previews/index.html`. Only the gallery embeds the logo bytes; actual outgoing HTML uses the first-party HTTPS image. All ten previews were regenerated without copy changes or provider sends. Template tests16/16, local Chrome viewport checks20/20 (390/600px, correct loaded image and no overflow), and typecheck passed. These local renders fulfill the production image URL from the deployable file; they are not live-site or email-client inbox proof. Screenshots and executable renderer are in `qa/brand-correction/`. The prior source fingerprint predates this logo correction. No merge/deployment or billing change.


## Email presentation refinement and invoice wording

Buttons now use14px text,20px line height and7px×16px padding (34px high versus49.6px), approximately40% less area while retaining readable labels. The long operator sentence is replaced by Privacy/Terms links; Radar by Thally stays in the header, support/reply contacts and optional founder unsubscribe remain. This is a presentation change, not a legal compliance certification; commercial messages have separate sender/address obligations.

Fixed the logo export's actual source of blur: canvas decoded an SVG with only a24px viewBox to a24px image before upscaling. The generator now supplies explicit224×224 dimensions before SVG decoding, displayed at28px (8×). Regenerated all previews and the offline gallery. Template16/16, local viewport/image20/20 and typecheck pass. The local image URL is fulfilled from the deployable local file; no new provider delivery or live deployment claimed.

Billing inspection confirms `BillingSettings` → `PortalButton` → authenticated `openBillingPortal` uses only the signed-in user's persisted Stripe customer and configured portal. Setup enables and validates `features.invoice_history.enabled`. There is no inline invoice list in Radar. Receipt copy now gives the exact Settings → Billing → Manage billing path and says view/download invoice in that flow rather than promising an inline receipt list. Previous launch QA records real sandbox portal/invoice/PDF evidence and production configuration validation; no fresh live portal was opened in this pass. No billing settings or charges changed.


## Redundant workspace-ready email removed

Owner removed the separate workspace-is-open notice because workspace creation is part of signup. The current set contains nine events. Removed the template and `commitDraft` enqueue trigger; kept activation/idempotency and trial/billing behavior. The dispatcher explicitly suppresses any previously frozen `workspace_ready` row before provider contact. The preview generator removes retired HTML/plaintext files and displays nine templates; current brand screenshots were regenerated without the retired message. Older QA snapshots remain historical evidence.

Verification:37/37 local database-backed tests passed (billing lifecycle8, dispatcher14, templates15), including activation/webhook replays without workspace mail and suppression of a previously queued notice with zero provider attempts.18/18 local mobile/desktop render checks and typecheck passed. No provider sends, billing changes, merge or deployment. This supersedes earlier ten-event descriptions.
