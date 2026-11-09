# LC2 independent QA report

Recommendation: accept the observed main-branch feature for the authorized PR update. No open material defect remains in the tested scope. No merge, deployment, production migration or external email send was performed. Passing these checks is bounded evidence, not proof of all behavior.

## Exact tested integration and environment

Workspace: `/Users/ekene/.codex/worktrees/radar-weekly-education/radar-push`; branch `kenny/weekly-education`; baseline HEAD `f616862c7dcefb1aabec9155972466f7b3aeaf36` plus the frozen integrated LC2 working-tree changes. Final source fingerprint after PM restored the generated tsconfig include: `7612426fe3a009c85a5eb1b9dd8add02729f463a6086edcb4e38d61ac3797e08` over 599 files, defined in `source-fingerprint.json` and enumerated in `source-files.json`. QA made no feature implementation changes.

Node 22.18.0, local PostgreSQL 15 at 127.0.0.1:54329, fresh isolated database `radar_lifecycle_refinement_qa_20261109`, migrations through 0013. Actual Google Chrome automation used ordinary synthetic verified password owners, a fresh signup and a Viewer invitee, never an admin bypass. Dev application: `http://localhost:3950`. Optimized application: `http://localhost:3951`, NODE_ENV=production and dev stubs disabled, build `.next-lifecycle-refinement`, BUILD_ID `C1S8bizZyLvuOZ63lrg6L`. No worker ran. Application servers had an empty Resend key and a nonfunctional local Stripe key. Unit provider calls were mocked. Both QA application servers are stopped. Final local fixture counts: users 0, businesses 0, outbox 0, guide states 0.

## Acceptance coverage

| Acceptance criterion | Result | Evidence |
|---|---|---|
| LC2-01 seven drafts have real scheduling or explicit existing-event mappings, without duplicate welcomes/founder/course steps | Passed | First-observation timing, one-time guide state and concurrency cases; architecture and revised inventory agree on five replacements/aliases plus two new guides. Workspace-ready stays retired. |
| LC2-02 verified cohorts, current relevance, default-on preferences, optout/exit, no historic burst or replay | Passed | Old/new owners, pretrial/workspace/lapsed, guest/unverified/member exclusions, any owned article workflow, GSC completed local-day boundaries, accepted organic prerequisite, paused/resumed pending row, terminal no-reenrollment. |
| LC2-03 shared cap, daylight/priority, stable retries and in-flight migration | Passed | Essential → weekly → guide → founder ordering, strict optional cap, existing education regression suite, stable old welcome/course envelopes, attempted guide key/body, optout after lookup, acknowledgement transaction rollback, expiry with unavailable GSC, FK cleanup and 12→13 upgrade. |
| LC2-04 useful factual copy, legacy semantics and actual sender integration | Passed | 28 families; concrete baseline/current review in `copy-review.md`; actual confirmation, invitation and backlink sender capture, escaping, token lifetime, recipient and role checks. |
| LC2-05 real rendered/access/browser behavior | Passed | 42 browser checks, 2 billing-gate arrivals, 6 optimized checks, 112 renders across 56 variants and 3 bounded stress cases. |
| LC2-06 independent verification and reproducible evidence | Passed | Independent 23 tests, separate developer 56-test rerun, migration/readiness probes, exact fingerprint and evidence files. |

Results are distinct counts, not one combined assertion total:

- Independent test harness: **23/23 passed** (12 policy, 8 delivery, 3 actual legacy transport tests), `independent-tests.log`.
- Existing developer regression rerun on this QA database: **56/56 passed** (guides 15, dispatch 14, education 27), `developer-tests.log`.
- Real browser ordinary-user scenarios: **42/42 passed**, `browser-results.json`, screenshots and `browser.log`. Covers keyboard save/refresh, defaults and category independence, read/write failure handling and stale reads, anonymous unsubscribe/form/one-click and forged token, feature/guide authorization and tenant boundaries, sign-in return, canceled/no-business preferences, real signup confirmation and Viewer invitation flows. Viewer generation is denied.
- Billing CTA sanity: **2/2 passed**, `billing-browser-results.json`. Past-due/canceled actual email links reach a usable restart/management screen; zero payment POSTs and unchanged account state. Portal/payment actions were not invoked.
- Optimized build smoke: **6/6 passed**, `optimized-smoke.json`. Actual production-mode sign-in, enforced billing fixture, keyboard preference persistence, authorized article-guide calendar arrival, public refresh article and zero generation/payment POSTs.
- Frozen actual-renderer catalogue: **112/112 passed**, **56 variants / 28 families**, at 390px and 600px. `renders/results.json` includes metadata, measurements, preheaders and PNGs. Hidden preheaders remain hidden; documents fit their viewport. Five plaintext-only sender families use a labeled viewer, not invented HTML mail. Representative final screenshots were visually inspected.
- Long bounded inputs: **3/3 passed** at 390px, `stress/results.json`: course business/offering/audience, invitation names and local-report prompt. Original failing overflow screenshots are preserved.
- Independent migration executions: clean and 12→13 upgrade both passed (`migration-proof.json`). No migration enrollment burst; old course progress, explicit false preference, attempted payload/key/timestamp unchanged; direct pending-row deletion restricted and account cascade succeeds.
- Worker readiness probes: **2/2 passed**, current schema accepted and previous schema refused (`startup-probes.log`). No worker was started.
- Separate local AI report companion: **39/39 tests passed** in five files, `companion-tests.log`; actual with-miss/no-miss HTML and long-prompt rendering included above. LC2-only patch SHA256 `ef8f571115fef39c79b0db0ae13f5d4eeee203f78509e563405cd34690d45022`.

Failed: **0 open acceptance failures**. LC2-05-D1 (P2 mobile overflow) was independently reproduced, fixed by the PM and retested with identical input and assertions; see `defects.md`. The companion no-miss preheader claim was corrected and independently retested. No source assertion or limit was weakened.

Blocked / unverified: real recipient sends, provider acceptance/delivery, inbox-client rendering, production migration and live scheduling were intentionally outside authorization. The companion is local-only and is not part of the main runtime acceptance: original-checkout verified-user schema integration, migration collision, real database queue and browser integration remain unverified. No companion release recommendation is implied.

Not applicable: migration-driven backfill/enrollment is deliberately absent; retired workspace-ready delivery remains removed; internal support/feature forwards were outside the user-facing rewrite.

## Reproduction and evidence

Use Node 22 and the isolated QA DATABASE_URL above, a dummy local RADAR_SECRET_KEY and RADAR_EDUCATION_EMAILS=1. Provider unit traffic is mocked. Do not supply a live provider key. Run serially because dispatch tests share a database advisory lock:

```sh
npx vitest run --config .factory/lifecycle-refinement/qa/vitest.config.ts
npx vitest run src/server/services/lifecycle/guides.test.ts src/server/services/lifecycle/dispatch.test.ts src/server/services/lifecycle/education.test.ts --no-file-parallelism
node --import tsx .factory/lifecycle-refinement/qa/migrations.mjs
node --import tsx .factory/lifecycle-refinement/qa/browser.ts
node --import tsx .factory/lifecycle-refinement/qa/billing-browser.ts
node --import tsx .factory/lifecycle-refinement/qa/optimized-smoke.ts
QA_COMPANION_ROOT=/Users/ekene/Downloads/design_handoff_radar/radar-push node --import tsx .factory/lifecycle-refinement/qa/render-all.ts
node --import tsx .factory/lifecycle-refinement/qa/stress-render.ts
python3 .factory/lifecycle-refinement/qa/fingerprint.py
```

Browser harnesses require their documented local server URL and an installed Google Chrome. Optimized smoke uses NEXT_DIST_DIR=.next-lifecycle-refinement and port 3951; development uses port 3950. `plan.md` records intended behavior and failure modes; `before-source/` and `before-previews/` preserve the baseline, and `copy-review.md` records the concrete before/after assessment.

A preliminary browser pass used 127.0.0.1 while invitation redirects used localhost, correctly triggering origin validation. The canonical localhost rerun passed 42/42 without changing an auth guard. The diagnostic `invite-browser-results.json` is not final acceptance evidence. An interrupted concurrent test invocation left synthetic fixtures; these were removed only from the isolated QA database, then the final 23 and 56 tests ran serially. No assertion was changed to accommodate setup errors.

PM reported the full frozen-source suite as 1,193 passing, 65 external skips and one unchanged image golden mismatch. This QA independently reran the affected suites above. The same image hash mismatch was independently reproduced during the preceding weekly release review on clean main-family source (expected f883614e6a7dfb07, received 91d5409f50974af7); image source and golden are unchanged in LC2. It is classified as an existing baseline failure, not a newly passing full suite.
