# Reproduction commands

Working directory: shared radar-weekly-education/radar-push worktree. Local-only QA DB guard is enforced by independent tests/browser. PostgreSQL admin port54329; never substitute a hosted URL. Node22 path as below. Migration proof creates separate synthetic local DBs; it does not start a worker. Run dispatch suites serially.

```sh
export PATH=/Users/ekene/.nvm/versions/node/v22.18.0/bin:$PATH
export DATABASE_URL=postgres://postgres@127.0.0.1:54329/radar_report_shipping_qa_20261110
export RADAR_SECRET_KEY=local-report-shipping-only
export RADAR_FAILURE_ALERTS=off
export APP_URL=http://localhost:3952
export RADAR_EDUCATION_EMAILS=1
node --import tsx src/server/db/migrate.ts
node --import tsx node_modules/vitest/vitest.mjs run --config .factory/lifecycle-refinement/shipping/qa/report/vitest.config.ts
RADAR_DEV_STUBS=1 node --import tsx node_modules/vitest/vitest.mjs run --no-file-parallelism --maxWorkers=1 src/server/services/visibility src/server/services/lifecycle src/lib/recommendationShare.test.ts src/server/db/workerReady.test.ts
RADAR_DEV_STUBS=1 node --import tsx node_modules/vitest/vitest.mjs run --no-file-parallelism --maxWorkers=1 src/server/services/visibility/digest.integration.test.ts
node --import tsx node_modules/vitest/vitest.mjs run --no-file-parallelism --maxWorkers=1 src/lib/seo.test.ts
node .factory/lifecycle-refinement/shipping/qa/report/migrations.mjs
```

Browser server: same DB/secret/origin; NEXT_DIST_DIR=.next-email-all-release, NODE_ENV=production, RADAR_DEV_STUBS=0, RADAR_BILLING=on, RESEND_API_KEY empty, RADAR_FAILURE_ALERTS=off, MAIL_FROM a fictional `Radar QA <configured-founder@test.local>`, STRIPE_SECRET_KEY local dummy. Start only Next, never worker:

```sh
node node_modules/next/dist/bin/next start -p 3952
```

From a second shell with matching local browser environment:

```sh
QA_REPORT_BUILD=R7jB76Uf9QoaQtlkN8XxE node --import tsx .factory/lifecycle-refinement/shipping/qa/report/browser.ts
node --import tsx .factory/lifecycle-refinement/shipping/qa/report/native-form-cdp-retest.ts
QA_RENDER_IDS=ai-weekly-report,ai-weekly-report-no-miss,ai-weekly-report-no-comparison,ai-weekly-report-no-topic node --import tsx .factory/lifecycle-refinement/shipping/qa/report/render.ts
python3 .factory/lifecycle-refinement/shipping/qa/report/fingerprint.py
```

The first failing build's diagnostic script intentionally records the original behavior; use the CDP retest for the fixed flow. Immutable initial logs and their exact build/source are retained in defects.md. No production request is part of these commands.
