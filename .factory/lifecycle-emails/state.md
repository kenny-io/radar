# State

| Task | Owner | Status | Next |
| --- | --- | --- | --- |
| EMAIL-A1 audit/design | factory-architect | verified | architecture.md |
| EMAIL-E1 template/durable transport | factory-engineer | verified | 31 focused checks pass; independent in-process dispatcher |
| EMAIL-E2 auth/recovery | factory-engineer | verified | 28 auth checks pass, including independently discovered stale-claim defect fixed |
| EMAIL-E3 billing/readiness wiring | factory-engineer | verified | 74 focused checks pass; eight new lifecycle scenarios |
| EMAIL-Q1 independent verification | factory-qa | verified | 45/45 dev +45/45 optimized production browser;190 focused tests; two defects closed; all owned servers stopped |
| EMAIL-P1 integration/launch handoff | PM | review | [PR25](https://github.com/kenny-io/radar/pull/25), source57b69edb. Build/typecheck/diff pass; full suite920 pass/65 external skips/one unchanged raster baseline failure. Await owner approval for auto-deploying main |

Isolated existing worktree, branch `kenny/lifecycle-emails`. Test database `radar_lifecycle_20261103` created on local Postgres port54329. No production writes, real recipients or deployment in this task so far. Verified connected Resend: Thally sending domain enabled/verified; 50,000 monthly limit,338 used, no daily cap,10 requests/second. No Radar hosted templates found; Thally templates belong to Thally and are preserved.

Controlled provider smoke: actual application queue and dispatcher sent only welcome and reset fixtures to Resend's documented simulator. Both provider records report delivered; both sent once with durable acknowledgment. The separate local simulator account and encrypted payloads were deleted. This does not establish human inbox placement. Production remains unchanged; main merge requires owner's approval under existing repository policy.

Release candidate verified. No runtime configuration changes required. Apply migration0009 on web predeploy and ship matching web/worker source. No customer backfill, announcement campaign, billing change or live payment mutation. Remaining launch checks are in launch-readiness.md. The only unrelated worktree modification is the existing search-indexing log, preserved and unstaged.

Delivery checkpoint: implementation commit `57b69edba3f570c371a877cdfd1cdfbc2c5f5e4a`, [PR25](https://github.com/kenny-io/radar/pull/25). No GitHub status checks are configured/reported for this head; local and independent evidence above supplies verification. Production remains successful at `f9eb6178`; no merge/deployment of this release has occurred. Next action is the owner's merge/deploy decision, then live health/recovery/email smoke without changing billing.

Copy refinement: all ten messages now follow the concrete, conversational voice of Radar's marketing pages. Source fingerprint `8da069a6563db18e50d9c9c5b7a1f2fcdfcbe1f5ef42646b80379b972cb50f04`; unchanged template tests15/15 and independent viewport renders20/20 passed. Updated copy, rendered previews and screenshots are included in PR25. No delivery workflow change, new campaign, provider send, merge or deployment. See copy-refinement.md and copy-review.md; original full-flow evidence remains tied to its original revision.

Journey correction supersedes the prior welcome/founder drafts: authenticated guest analysis and business name now travel into the transactional welcome; the primary message continues from the already-created Business Profile, with a truthful neutral fallback for direct/unfinished signup. Workspace-ready describes activation, not profile creation. Founder copy now uses the owner's supplied launch-script rationale and an offer to help by reply. See journey-alignment.md and qa/journey-alignment/. Password/Google context, existing guest-claim and template checks31/31 passed; independent boundary probes2/2 and updated viewport renders22/22 passed. Current source fingerprint `2a853cd54a02a6b2e567b225ce148ba207757d50cec362a1e4c6ec428d5d8824`. No emails, merge or deployment in this pass.


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
