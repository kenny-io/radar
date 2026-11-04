# Signup security release QA

Prepared 4 November 2026 (Asia/Dubai). Worktree `/Users/ekene/.codex/worktrees/signup-security/radar-push`, branch `kenny/signup-security-hardening`, starting HEAD `f322e5972a01c8b1cb744d4462ebba8ed3ed34e7`. User authorized merge/deployment, safe existing-account migration, and live signup/email verification. QA owns this record and `qa/release-public.mjs`; no application implementation or deployment mutations.

## Release acceptance scope

All live checks began only after PM-confirmed deployed revisions. The public harness requires `QA_DEPLOYED_COMMIT=<40-char SHA>` and records deployment provenance from PM; it does not claim a public page reveals a Git SHA. Actual installed Chrome via Playwright, anonymous desktop1440px and mobile390px contexts.

Read-only live acceptance scope: password-free signup, default rate-only UI/no SDK, invalid-input validation before/after hydration without auth API submissions, recovery/Google-conflict guidance, confirmation GET/privacy headers/explicit action and synthetic fragment scrub/reopen, protected anonymous app/API boundaries, no browser exceptions or unintended mutations. Screenshots contain no real credentials. No live payment, analysis, publishing, real Google consent, CAPTCHA or account credential entry through browser.

PM/engineer own the uniquely scoped production signup/email test and connected Gmail inbox receipt check. QA may independently inspect sanitized evidence or an explicitly provided private test fixture session after PM authorization. A provider accepted/delivered event alone is not proof of inbox receipt. Any signup/confirmation/credential mutation requires a separate bounded PM assignment before QA performs it.

## Deployed public acceptance — passed

PM confirmed merge source `582e0eb74522881d9f772c8add6fab6f0bacbfa3` running on both successful Railway deployments: web `d6cf14cb-f1bb-49a5-8fe0-0d4c23dcb075`, worker `685c8e06-0620-4576-8d77-690b5f7387c6`; only those instances active, migrations applied, health200. Deployment/source provenance is PM's actual Railway metadata evidence, paired here with independently observed public asset/header markers.

Ran `QA_DEPLOYED_COMMIT=582e0eb74522881d9f772c8add6fab6f0bacbfa3 QA_PHASE=deployed node .factory/signup-security/qa/release-public.mjs` at **20:44:10–20:44:23 Asia/Dubai on November4** (16:44:10–16:44:23UTC). **6/6 browser groups passed:**

- Desktop1440px/mobile390px signup has Name/email only, confirmation explanation, enabled hydrated controls, no Turnstile SDK/widget dependency and no horizontal overflow. QA visually inspected the actual live mobile signup screenshot.
- Empty signup/signin validation works without auth POSTs; Google-collision guidance exposes password-free inbox-recovery entry. No real Google consent or login attempted.
- Confirmation GET200 uses `no-referrer`, `no-store`, `noindex`; explicit confirmation form appears for a synthetic43-character fragment fixture, with no POST/activation. Initial and refresh/same-tab reopening scrub fragment and nested Next history. No real token consumed.
- Anonymous dashboard/settings/trial redirect to signup; anonymous `/api/me`401.
- Holding9 JS requests per auth page proves disabled SSR input/Google/submit controls; releasing scripts enables controlled validation without native submission.
- Zero application mutations, challenge SDK requests, browser exceptions or unexpected page HTTP failures observed.

Private ignored evidence: `.data/signup-security/release-qa/deployed-public-results.json`, `deployed-public.log`, `deployed-signup-{1440,390}.png`, `deployed-confirmation-mobile.png`. JSON includes timestamps and public script/header markers. Fresh Chrome contexts were closed by the harness. No production account/email/payment/analysis/publishing mutation was performed by QA.

## Final running artifact acceptance — passed

A concurrent support-timeout release advanced main to `085f1d88a83868b61c8cb0665dabea87f82180d3`. PM confirmed both current Railway deployments SUCCESS: web `d06b23b4-ada3-4020-9120-edb23fe8b9d0`, worker `2bad20bb-4a57-4495-9a9c-afecf7c7160a`. Architect independently compared582e0eb7→085f1d88: only support API/answer/tests/docs changed; **all signup/auth/session/migration/UI source remained identical**. The actual signup/email/confirmation proof below was executed against582e0eb7 and remains applicable to the current auth-equivalent artifact.

Independently reran the same public Chrome harness with `QA_DEPLOYED_COMMIT=085f1d88a83868b61c8cb0665dabea87f82180d3 QA_PHASE=final` at **20:53:15–20:53:27 Asia/Dubai on November4** (16:53:15–16:53:27UTC). **6/6 groups passed again**, with zero application mutations, challenge SDK requests, browser exceptions or unexpected page HTTP failures. Private evidence: `final-public-results.json`, `final-public.log`, `final-signup-{1440,390}.png`, `final-confirmation-mobile.png` under `.data/signup-security/release-qa/`. Contexts closed; no additional signup/email/credential mutation.

Architect's final production cohort audit on085f1d88 reports the same5 verified Google identities/IDs, full-row hashes unchanged for6 businesses/6 memberships/2 billing accounts, all6 original sessions revoked, one new legitimate session allowed, zero verification tokens and the same migration hash. This is independently executed architect evidence, reviewed/attributed here rather than claimed as a QA database rerun.

## Independent inbox receipt — passed

Read Gmail message `1a1a772b39f2e108` directly through connected `gmail_read_email(format=metadata)` after PM supplied the uniquely scoped production-test message ID. The connector metadata also includes a snippet; QA deliberately excluded snippet/raw/body/token content from outputs and saved records. Independently observed `INBOX` label, expected Radar confirmation subject and sender, the unique test recipient alias, and Gmail internal receipt time **20:44:33 Asia/Dubai on November4** (16:44:33UTC). `Authentication-Results` reports **SPF pass, DKIM pass, DMARC pass**. This is direct mailbox receipt proof, separately from a provider accepted/delivered event. No Gmail label or message mutation occurred. Recipient address and token-bearing content are omitted from this tracked record.

## Live account activation evidence — independently reviewed, passed

Independently inspected only the stage and boolean/count execution evidence from private `.data/signup-security/release/live-test-state.json`, and reviewed the assertions in `qa/release-live-account.mjs`. QA did not read or emit the private password, confirmation token, session cookie or connection credentials, and did not repeat production credential mutations.

Executed engineer evidence establishes:

- Unique signup returns pending confirmation, sets no authenticated session, denies anonymous protected access, stores one hashed token and redacts production outbox content; no business or billing record created.
- PM captured the confirmation credential privately from the **actual Gmail received-message preview**. Executed confirmation code matched its SHA-256 to the stored token and verified the same user ID. QA's independent Gmail metadata receipt above supports actual inbox arrival. The provider read/capture helper was not executed successfully; **no outbound provider-body/RFC correlation is claimed**.
- Explicit confirmation returns200 and a Secure/HttpOnly/SameSite=Lax session; authenticated `/api/me` returns the expected test user. Replay returns400 `verification_invalid`.
- Signout revokes access (`/api/me`401); ordinary password signin returns a fresh session and the same account. Final signout leaves zero test sessions and tokens. No business, membership or billing data is created by this flow.

This is independent review of executed engineer/API evidence combined with QA's own inbox/public-browser proof, not a second independent mutation run or a claimed live browser password entry.

## Disposable fixture cleanup and live quota proof — passed

Reviewed `qa/release-cleanup-account.mjs` and selected sanitized final state. Cleanup completed **20:51:55 Asia/Dubai** (16:51:55UTC): stage `cleaned`, exact identity/name/full created-at matched, zero commercial/session/token/OAuth guards checked inside the transaction. Exactly one synthetic user, its one signup event and its one redacted outbox row were deleted; zero businesses or billing rows deleted and zero fixture users remain. Private state no longer contains password/session fields; engineer removed the consumed-token receipt field. Actual Gmail receipt was retained. No customer/business/member/billing record was touched.

PM additionally exercised the exact verified-or-removed fixture's mailbox quota; sanitized `live-rate-proof.json` records resend statuses **200,200,429** after the original signup, confirming3/address/hour. Requests for the already verified/deleted fixture sent no additional email. This is PM execution evidence reviewed by QA, not a QA-issued production resend.

## Release recommendation

**No open requested acceptance gaps identified in the observed scope.** Final current-artifact public Chrome6/6, direct independent inbox metadata, reviewed actual activation/signin/signout/replay evidence and guarded cleanup all pass. Earlier local independent migration/legacy-recovery/quota/security tests and browser flows remain documented in `qa.md`; architect's independent production cohort preservation/readback is documented in `release-architecture.md`, not attributed to QA execution.

Real Google consent was not rerun, and real Turnstile challenge/hostname acceptance was not performed. Default live protection is rate-only per user direction; optional Turnstile must remain disabled until its separate external acceptance is completed. Passing these checks does not imply absolute prevention of all signup abuse. No additional live browser or credential mutation was needed after the source-stable release.
