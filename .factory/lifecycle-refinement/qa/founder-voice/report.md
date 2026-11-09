# Founder voice independent QA

Recommendation: accept the observed correction for the authorized PR update. No open material acceptance failure was found. This report covers the frozen source below; it does not approve a later main revision, deployment, real recipient send or the separate report feature’s release.

## Exact integration and environment

Workspace `/Users/ekene/.codex/worktrees/radar-weekly-education/radar-push`, branch `kenny/weekly-education`, baseline HEAD `5f7c56ab56cdd60099b032e8003dc178c05d4708` plus the frozen founder-voice working-tree changes. Final source SHA256 **ec983db607f8540a6dbadf6fda21c088a4fc11e13a436d7c41e12402095d1d8e**, **617 files**, after PM restored generated tsconfig changes. `source-fingerprint.json` defines the scope; `source-files.json` enumerates every file. This is new evidence, not a claim that an earlier fingerprint covers this change.

Node 22.18.0, local PostgreSQL 15 at 127.0.0.1:54329, fresh database `radar_founder_voice_qa_20261110`, 16 migrations through 0015. No worker ran. Unit provider traffic was mocked; the web server had an empty Resend key, a nonfunctional local Stripe key and a fictional configured sender. Actual Google Chrome used an ordinary verified synthetic password owner, with enforced production billing through a local complimentary fixture. Optimized app `http://localhost:3951`, NODE_ENV=production, dev stubs off, artifact `.next-founder-voice`, BUILD_ID **CiMpQWcgFPwNpn-YQxGIH**. QA server is stopped. Final users, businesses, lifecycle outbox and general outbox counts are all zero.

## Acceptance coverage

| Criterion | Result |
|---|---|
|FV-01 personal voice / factual help|Passed. Reviewed all actual main builders and the separate report formatter against final 68 variants. Singular founder attribution, useful next actions, Ekene/Founder, Radar signoff and founder reply destination. No fabricated personal inspection or guaranteed outcome claim observed. Third-party invitations/partner decisions retain their actual actor. `copy-review.md`.|
|FV-02 founder sender / retry safety|Passed. Exact `Ekene from Radar <configured mailbox>` and `team@thally.io` Reply-To on new user mail, including actual confirmation/invitation/backlink transport capture. Bare/named configuration and header rejection checked. New general rows snapshot identity before POST and preserve complete body/key through failure and configuration change. Attempted lifecycle envelopes stay frozen. Historical NULL metadata retains legacy From/no added Reply-To. Internal service/support forwards preserve their distinct identity.|
|FV-03 retire trial-ending reminder|Passed. Direct enqueue and subscription sync/extensions do not create it. Due/future/attempted/malformed/expired pending reminders and stale claims suppress as `retired_type` with zero provider calls and unchanged key/payload/attempt history. Even absent delivery credentials do not prevent retirement. Recent live claims are not stolen; accepted/logged/failed history remains unchanged. Previously retired malformed workspace notices are covered too.|
|FV-04 subscription facts / necessary amounts|Passed. Subscription-start confirmation helps the reader use Radar, retains end-date, automatic continuation and card-credit facts, and removes routine prices/cancellation nudge. Receipt preserves an actual amount/currency and invoice identifier when present; missing amount is not invented. Failed-subscription notice omits repetitive prices. Requested cancellation/ended-state facts and controls remain accurate.|
|FV-05 numbered catalogue / rendering / verification|Passed. 28 active families,68 active variants and29 reserved family slots. #5 is a retired notice without active body/CTA/iframe; all other id/reference pairs equal the baseline.136 mobile/desktop renders and11 real-browser catalogue checks pass, plus6 optimized app checks.|

## Fresh results and evidence

- **22/22 independent tests**, `independent-tests.log`:13 retirement cases,6 sender/retry cases and3 actual legacy transport suites. Harness files are owned by QA only.
- **97/97 affected developer tests**,9 files, `developer-tests.log`: founder identity16, templates24, dispatch, education copy, billing lifecycle, support transport, signup/verification and Autopilot overlap. Actual fake-provider tests verify metadata/identity while preserving existing safeguards.
- **42/42 companion tests**,6 files, independently rerun in the original checkout; `companion-tests.log`.
- **136/136 renders**,68 active variants at 390px and 600px; `renders/results.json`, PNGs and `render.log`. Actual HTML and labeled plaintext viewers were used; hidden preheaders, heading/logo checks where applicable and overflow checks pass. `preview-files.json` hashes final artifacts. Final representative screenshots were visually inspected for founder story, subscription start/receipt/payment failure, Viewer invitation, manual article guide and no-miss report.
- **11/11 real-browser catalogue checks**, `catalogue-browser.json`: mobile reading/index, keyboard alternate expansion, complete Markdown variants, visible founder metadata, stable references, gallery categories and the reserved non-email #5 notice.
- **6/6 optimized app checks**, `optimized-smoke.json`: ordinary production signin, configured billing gate, keyboard preference save/refresh, authorized actual article-guide CTA, public refresh guide and no generation/payment POST. This is browser evidence, not just HTTP probing.
- **Clean and 14→15 migration upgrades plus no-op reruns passed**, `migration-proof.json`. All prior SQL/journal entries unchanged; old outbox body/history unchanged; new nullable sender_meta is not backfilled.
- **2/2 actual readiness probes**, `readiness.json`: current 0015 accepted, previous 0014 refused. No worker launched.

The PM’s final full-suite run records **1,256 passed, 65 external skips and one unchanged raster golden mismatch** across 114 files. The mismatch remains expected f883614e6a7dfb07 versus actual 91d5409f50974af7, already independently reproduced on clean main-family source during earlier release QA. Image source/golden are unaffected by this correction. The affected suites above were independently rerun; this is not a claim of a fully passing global suite.

## Compatibility and limits

Failed: **0 open new material failures**. Diagnostic fixture errors were corrected without product changes: the all-family metadata harness initially used a reset URL from the wrong origin and omitted a required work section. Final 22 pass with valid synthetic inputs. No feature assertion or input limit was weakened. QA requested alignment of the previously retired workspace type with the early retirement path; the engineer applied it and independent malformed-row coverage passes.

A truly in-flight provider request or already accepted message cannot be recalled. The new dispatcher preserves live claims and stops safe stale-lease recovery without a new POST. Old lifecycle attempts and old NULL-metadata general rows intentionally retain their original identity/body for retry compatibility; founder presentation applies to new snapshots. No rekey, historical body rewrite or delivery claim is implied.

The separate original-checkout report remains **local-only**. Exact six-file companion patch SHA256 **d4a1d17ff843bd8ab5afe907837112c7a4a3515881ab0c81ddcb1b23843411a6**. Its pure identity helper is byte-identical to main. New immutable report jobs snapshot sender identity; old jobs without the field retain legacy transport. The original helper’s optional sender override is supported only for those immutable report-job snapshots, not as a generic durable identity guarantee. Main’s stronger sender_meta migration is not imported there. Verified-mailbox/schema integration, migration numbering and real queue/browser release gates remain. Unit/render evidence does not approve that feature’s release.

Blocked / intentionally unverified: production migration, live scheduling, real provider acceptance/delivery and inbox-client compatibility. No customer message or production write occurred. Unchanged main integration authentication/tenant/course/cap behavior reuses prior scoped evidence, not a new 42-check browser claim. Retiring a trial reminder does not cancel or alter any subscription. Internal team forwards are not part of the founder customer-copy rewrite.

## Reproduction

Use Node 22, the isolated QA database, dummy RADAR_SECRET_KEY, empty RESEND_API_KEY and synthetic sender configuration. Normal unit fixture environment uses RADAR_DEV_STUBS=1 and RADAR_BILLING=off; explicit scenarios control their own gate. Run serially:

```sh
npx vitest run --config .factory/lifecycle-refinement/qa/founder-voice/vitest.config.ts
node .factory/lifecycle-refinement/qa/founder-voice/migrations.mjs
node --import tsx .factory/lifecycle-refinement/qa/founder-voice/readiness.ts
node --import tsx .factory/lifecycle-refinement/qa/founder-voice/render-all.ts
node --import tsx .factory/lifecycle-refinement/qa/founder-voice/catalogue-browser.ts
node --import tsx .factory/lifecycle-refinement/qa/founder-voice/optimized-smoke.ts
python3 .factory/lifecycle-refinement/qa/founder-voice/fingerprint.py
```

Optimized smoke requires the stated artifact/port and local complimentary fixture setup in its script. The 9 affected developer files are listed in `developer-tests.log`; companion 6 are listed in `companion-tests.log`. Earlier evidence remains under `qa/main-integration/` and `qa/report.md` with its own exact source scope.
