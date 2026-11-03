# Radar email logo correction


## Brand correction and complete review gallery

The owner identified the generic concentric-circle character as an incorrect logo. All ten templates now use `public/brand/radar-mark-email.png`, a 96px PNG rasterized directly from the existing `radar-mark.svg` by `scripts/generate-email-brand.ts`, displayed at28px. The white image background preserves the dark mark in recoloring email clients; adjacent live Radar text remains visible with images disabled. The single asset uses the application origin, with no tracking or account tokens. This file must ship with the templates; it is not yet on production.

The complete offline-capable gallery is `previews/index.html`. Only the gallery embeds the logo bytes; actual outgoing HTML uses the first-party HTTPS image. All ten previews were regenerated without copy changes or provider sends. Template tests16/16, local Chrome viewport checks20/20 (390/600px, correct loaded image and no overflow), and typecheck passed. These local renders fulfill the production image URL from the deployable file; they are not live-site or email-client inbox proof. Screenshots and executable renderer are in `qa/brand-correction/`. The prior source fingerprint predates this logo correction. No merge/deployment or billing change.
