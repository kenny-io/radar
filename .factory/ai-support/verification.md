# Verification

4 November 2026, Asia/Dubai. Baseline before support edits: npm run typecheck passed; npm test: 740 passed, 197 skipped, one existing branded-image golden failure in src/server/ai/openrouter.qa.test.ts (expected f883614e6a7dfb07, actual 91d5409f50974af7). Same baseline failure is already independently reproduced at clean HEAD in .factory/signup-security/verification.md. No snapshot modified.

## Feature checks

- Developer focused support tests20/20 passed; starter/refund assertions3/3 rerun passed. Integrated typecheck passed. UI mechanical detector returned[]; scoped whitespace checks passed.
- Independent QA focused20/20, actual API7/7 matrices, actual Chrome7/7 scenarios passed. See qa/report.md for criteria/evidence mapping. Separate migrated local database, no live credentials. Core ask and handoff used real local route/AI stub/outbox; first-failure and delayed-response cases use labelled response fixtures.
- Desktop1440x950 and mobile390x844 light/dark screenshots inspected independently and by PM. Keyboard/focus, no overflow, loading, retry, explicit handoff, navigation persistence, refresh clearing and stale-business response rejection verified.
- PM reviewed route authentication/membership/origin/body boundary, AI context/grounding and mail transaction/idempotency. Insert errors normalized before route logging so transcripts cannot be included in raw database errors.
- Exact QA runtime working-tree fingerprint: b9a1147081512961799e52336bc4bb9effb09d208efbc2afc722310f13c17446; per-file hashes retained ignored in .data/ai-support/tested-files.json. No source commit created in the shared dirty checkout.

Final integrated serial suite (`npx vitest run --fileParallelism=false`):760 passed,200 skipped, one unchanged image golden failure in src/server/ai/openrouter.qa.test.ts. Log: ignored .data/ai-support/final-tests-serial.log. The initial parallel full run during concurrent optimized compilation timed out in that existing scenario and caused three follow-on failures in the same file; the serial run reduces these to the documented raster baseline. No test expectation changed. The runtime hashes still match all ten independently tested files.

Integrated production build passed (`npm run build`, production NODE_ENV, isolated local database and no live keys), generating /api/b/[bid]/support successfully. Log: ignored .data/ai-support/build.log. Build output isolated in ignored .next-support-build; removed only its automatically added tsconfig include. Final npm run typecheck after cleanup passed (.data/ai-support/final-typecheck.log).

Independent production-mode Chrome/API smoke2/2 passed at localhost:3822 against that build: production ignores the development flag; missing AI credentials return the human-help offer; missing mail credentials return503 without outbox capture or false success, retaining the conversation. Evidence: ignored .data/ai-support/production-results.json. Zero application exceptions.

No production services mutated or actual support emails sent. Live model quality/latency and actual Resend inbox receipt/replies remain activation checks in docs/SUPPORT.md; local capture success is explicitly labelled in the UI. Implementation is uncommitted and undeployed.
