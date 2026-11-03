# Radar email logo correction


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
