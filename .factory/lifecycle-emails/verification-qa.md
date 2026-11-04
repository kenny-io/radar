# Independent lifecycle QA — November 3, 2026

Workspace `/Users/ekene/.codex/worktrees/radar-seo-ai-discovery/radar-push`, branch `kenny/lifecycle-emails`, HEAD `963a2d597b96bb7f9e37b33cc485d87ac22a5e5b` plus integrated working-tree changes. Final source fingerprint: **`3beebabab50b13b7629a49df808231ee6e52cc6b8232f55220817e3c432b2d50`**,476 files covering `src/**`, `next.config.ts` and `drizzle/**`; manifest scope in `qa/source-fingerprint.json`. The final tiny worker failure-backoff change was checked by an additional3/3 worker tests; it does not change the web artifact tested below.

## Environment and boundaries

Dedicated local PostgreSQL databases `radar_lifecycle_qa_20261103` and `radar_lifecycle_qa_prod_20261103`, port54329. Migrations0000–0009 applied. Fresh Google Chrome contexts used the installed Chrome executable, with fictional `@test.local` accounts created through the signup UI and deleted afterward. No customer browser sessions, production writes, human email recipients, provider sends or payment mutations by QA.

Development app: `http://localhost:3931`, Next dev and stubs. Optimized artifact: `.next-lifecycle-release`, served at `http://localhost:3932` with genuine `NODE_ENV=production`, a local-only encryption key and no email provider/worker. Production runtime intentionally exercised actual password authentication and secure cookies on trusted localhost; it did not enable development stubs or call external providers. General backend suites used the PM's isolated local fixture database; transport tests scope their own users.

## Acceptance coverage

| Criteria | Result | Independent evidence |
| --- | --- | --- |
| AC1 ten templates, truthful copy and safe destinations | Pass observed | All10 previews at600px and390px: one H1, language, no overflow, app-hosted/mailto links. Visual inspection of recovery and welcome/founder examples. Invoice/billing tests use actual fetched amounts. Actual billing CTA opens Billing and survives refresh. |
| AC2 signup/founder timing and exclusions | Pass observed | Password signup in browser queues exactly welcome+founder. Backend tests verify concurrent creation, Google new/returning-user, guests, delay and optional preference suppression. |
| AC3 transactional workspace/billing lifecycle | Pass observed | Independent suite covers trial/reminder/workspace replay, rollback, correct fetched$49 invoice facts, zero-dollar trial exclusion, stale paid/failure invoices, old subscription isolation and cancel→resume→cancel. |
| AC4 reliability and worker capacity | Pass observed | DB dispatcher tests cover claims, competing workers, dedupe, frozen retries, provider ACK, permanent errors, retry expiry, credentials and stale eligibility. Independent real HTTP stalled-body test returns to queue in~10s with no false provider ACK. Actual general worker held all4 slots running; separate lifecycle loop logged mail in129ms while all4 remained occupied. |
| AC5 secure, usable password recovery | Pass after fixes | UI reset request by Enter; encrypted fragment link; GET not consumed; referrer/cache/index controls; mismatch, used/missing/expired link; old sessions401; no auto-login; old password401; new password UI sign-in. Independent stale-proof/draft mutation reproducer now passes. Same-document new links and stale in-flight response race now pass. |
| AC6 browser, mobile, stubs and regression checks | Pass observed | **45/45 development +45/45 optimized production browser checks**, no page errors. Independent auth/billing/lifecycle **190/190** tests across21 files; additional real-body/stale-proof **2/2**, final worker **3/3**, actual occupied-worker integration **1/1**. No provider network in these checks. |
| AC7 reviewable delivery/live release | PM-owned, not yet verified by QA | QA recommends review and authorized delivery after PM integrated build/type/full-suite checks. No merge/deployment by QA. Live site recovery/email workflow remains to be verified after release. |

## Defects closed

Q1 P1: stale password proof was rejected only after guest/account drafts had been mutated. Independent database reproducer failed before the PM's proof-under-lock fix and passed afterward; permanent engineer regression added.

Q2 P2: a fresh fragment link opened in an already-visible reset page was ignored. Engineer added hashchange parsing and generation protection. The exact browser scenario, expired-link case and delayed-response race passed in both environments. See `qa/defects.md`. No open product defect found by this pass.

## Commands and evidence

`DATABASE_URL=<isolated fixture database> RADAR_DEV_STUBS=1 npm test -- src/server/auth src/server/billing src/server/services/lifecycle` →190passed, no skips/failures; `/tmp/radar-lifecycle-qa-final-focused.log`.

`DATABASE_URL=<dedicated QA database> RADAR_DEV_STUBS=1 npx vitest run --config .factory/lifecycle-emails/qa/qa.vitest.config.ts` →2passed; `/tmp/radar-lifecycle-qa-extra.log`. Source scripts: `qa/{stale-signin.test.ts,body-timeout.test.ts}`.

`node --import tsx .factory/lifecycle-emails/qa/browser.ts` with the documented per-environment local DB/APP_URL/QA_BASE/QA_OUTPUT values →45passed in each environment. Evidence: `qa/browser-results.json`, `qa/production/browser-results.json`, screenshots in those directories. The client in-flight race deliberately intercepts one request with a delayed synthetic200 response; ordinary recovery and revocation checks use actual backend routes.

`node --import tsx .factory/lifecycle-emails/qa/worker-capacity.ts` with local QA database and stubs →1passed; `qa/worker-capacity-results.json`.

`npm test -- src/server/services/lifecycle/worker.test.ts` after final backoff change →3passed; `/tmp/radar-lifecycle-qa-worker-final.log`.

Both owned app servers were stopped after verification. Next auto-generated tsconfig includes are left for the PM's coordinated cleanup; QA did not revert other changes.

## Limits and recommendation

No Gmail/Outlook/Apple Mail client rendering, actual OAuth consent, real customer inbox receipt or live post-deployment recovery verified by this pass. PM separately performed a Resend simulator smoke; accepted/delivered simulator events do not establish a human mailbox's receipt. Existing backup/monitoring/provider launch items remain outside this code QA. Recommend proceeding to review/authorized deployment with no open observed code defect, followed by live smoke and an owner-controlled inbox check before claiming the launch email system fully verified.
