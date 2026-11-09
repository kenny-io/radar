# State

| Task | Owner | Status | Covers | Next |
| --- | --- | --- | --- | --- |
| OPT-A1 architecture and ownership split | factory-architect | active | all | architecture.md |
| OPT-E1 idle spend | factory-engineer | planned | IS-1..7 | after A1 |
| OPT-E2 lighter saves | factory-engineer | planned | LS-1..4 | after A1 |
| OPT-E3 billing edges + first session | factory-engineer | planned | BE-1..4, FS-1..4 | after A1 |
| OPT-E4 review loop + activity | factory-engineer | planned | RL-1..6 | after E2 integrates |
| OPT-Q1 independent QA | factory-qa | planned | all | after integration |
| OPT-P1 integration and delivery | PM | active | all | brief written; baseline recorded |

Baseline at `2d41a801`: `npm run typecheck` passes; `npm test` 1076 passed, 371 skipped (DB tests without
`DATABASE_URL`), 1 failed (`src/server/ai/openrouter.qa.test.ts` golden snapshot, pre-existing).
Local Postgres: `localhost:54329` (user `postgres`). Review database `radar_opt_review_20261110` is seeded
(dev@radar.local, email marked verified by hand).
