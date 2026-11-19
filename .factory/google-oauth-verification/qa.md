# Q6 independent YouTube lifecycle QA

19 November 2026. **Recommend release of the tested lifecycle and upload-origin candidate.** All selected independent local checks pass, including the final test-typing correction. No unresolved implementation defect observed. PM owns final build/deployment evidence and normal web/worker rollout checks; this bounded verification does not establish Google approval, hosting backup deletion or correctness in every provider configuration.

## Exact candidate and environment

Workspace `/Users/ekene/.codex/worktrees/radar-youtube-lifecycle/radar-push`, branch `kenny/youtube-lifecycle`. Tested HEAD `9e6c204a77851cb3eb43be7c338e35af00ce2ea5` plus PM's null-clock correction, upload-route origin correction and new route test (including its final typing correction). Base `a8956315d30c64c0427b2c962bbf06f90cb8bf83`. Final 30 changed source/script/doc files SHA256 **`c0bb2ec7ce6904acb5cb16bad94ae0dc01b52b6f973887943cebece57a98e0d8`**, sorted relative path + NUL + bytes + NUL. Per-file manifest [qa/fingerprint.json](qa/fingerprint.json). A later commit that only records this same source does not change this content fingerprint.

Read A6 architecture, E6 integration, changed lifecycle/guard/caller/provider/job/projection/UI code and developer tests. QA wrote only records and independent harness files outside source. No production requests/mutation, real grants/revocations/uploads, customer preferences, credentials or implementation edits.

Node v22.18.0; local Chromium via Playwright using ordinary synthetic verified owner session at `http://localhost:3846`. Dedicated migrated Postgres databases `radar_youtube_lifecycle_qa` (browser fixtures) and `radar_youtube_lifecycle_qa_db` (DB harness/tests) on localhost54329. Synthetic Owner/Editor/Viewer/Outsider and foreign business fixtures. External credentials blank; controlled provider hooks/adapters or dev stubs only. Ignored `.data/youtube-lifecycle-qa` contains local runtime/session fixtures and is not a release artifact. QA server stopped after completion; port3846 no longer listening. `tsconfig.json` and `next-env.d.ts` identical to HEAD.

## Results

**Passed: 16/16 independently authored real-DB scenarios** in [qa/database-results.json](qa/database-results.json):

- Scoped removal of account, pending grants, receipt/legacy projection/event API canaries; owner video/caption/options, foreign tenant and X account preserved. Remote revoke sees already committed local cleanup.
- Permanent identifier-free no-resend survives reconnect and manual/scheduled/automatic upsert/claim/recovery paths without provider initialization. Unsent tombstone requires explicit approval; automatic action cannot clear it.
- Barrier races at upload completion, processing status read and old-generation profile read cannot restore deleted API data or overwrite replacement grant.
- Definitive revocation removes scoped data; configuration holds persist and block claiming, recover only after valid profile verification; transient429/500/503 preserve token generation/freshness; API401 triggers refresh/read retry.
- Exact28-day boundary despite new updatedAt/token rotation, stale read suppression, receipt-only expiry retaining fresh account/posted fact, unstamped recent legacy initialization, explicit malformed/null clock fail-closed after fix.
- Encrypted global revoke intent and24-hour expiry/terminal token wipe; immediate soft-delete cleanup and reconnect-required restore.
- Actual registered global queue executes13 held accounts across two durable batches with publishing off/billing on, also removes deleted-business connection; observed maximum two checks concurrently and zero uploads.
-207 disconnected old receipt rows drained across three expiry batches without deleting fresh connection. Trusted contact dry-run/apply confirmation and tenant validation; aggregate report contains no identities.

**Passed: 10/10 actual browser scenarios** in [qa/browser-results.json](qa/browser-results.json):

- Ordinary MP4 attachment and explicit YouTube title/visibility/audience survive refresh.
- Visible configuration-pause explanation and disabled posting; actual Settings disconnect removes API copies and persists after refresh.
- Posted local history shows generic label/explanation and disabled stale YouTube link. Uncertain upload exposes no retry/schedule; actual OAuth reconnect does not resurrect it, owner direct action returns409.
- Preserved unsent video/caption/options; explicit Schedule modal approval clears needsApproval and persists after refresh.
-390px mobile unknown-history page has no horizontal overflow; Copy text accepts keyboard focus. Keyboard Enter opens actual connection dialog. Viewer writes403 and foreign tenant404 preserve connection.
- Actual X and LinkedIn UI posting with synthetic providers still succeeds; public lifecycle disclosure renders; zero unhandled browser exceptions.

**Passed: 104/104 tests across eight files**, independently executed after the correction. Includes the37 lifecycle tests and relevant existing publishing/deletion/restore/purge regressions. This supplements the independently authored harness; these are developer test files, not104 new QA-authored cases. In particular the selected DB suite checks failed enqueue dedup recovery, pending-only grant handling, old OAuth-start rejection, terminal/crash retry wipe, snapshot canaries and actual contact procedure. Provider tests exercise real parsing/classification and body-consumption abort budgets with synthetic fetch. No unrelated baseline failure encountered in this selection.

**Passed:** final post-upload-patch/server-stop Node22 typecheck, `git diff --check`, source config cleanliness.

**Passed: 8/8 additional independently authored real-DB upload-route cases**, with actual session/member/media/persistence and only the Next cookie context mocked: configured public APP_URL Origin plus Railway-internal req.url uploads real MP4 successfully; forged forwarded host/proto cannot authorize an evil Origin; internal and opaque Origin rejected; cross-site requests rejected even without Origin; intentional no-Origin API client allowed under existing guard contract; Viewer403/foreign404/anonymous401. See `qa/origin.test.mjs` and `qa/vitest.config.mjs`.

**Passed: 16/16 additional upload-route/auth regression tests across two files** after the route test's typing correction. Together with the earlier104 this is120/120 developer tests across10 files, supplemented by24 independently authored DB/route scenarios and10 browser scenarios. The complete10-scenario browser suite was rerun against the upload-route correction and passed, including actual ordinary MP4 upload. Lifecycle source was unchanged by that route correction; its16-case independent DB results remain applicable.

**Failed:** none on final candidate. One real P2 acceptance defect was found and corrected: `trustedClock(null, recentCreatedAt, now)` previously treated explicit malformed/null metadata as absent, so stale projection/expiry failed open. Reproduction: encrypted `youtube.profileFetchedAt:null`, `authorizationCheckedAt:now`, recent account creation; expiry retained row. PM limited fallback to undefined and added regression. Independent DB retest now removes the malformed account while recent unstamped legacy account remains valid. Initial harness exact-text/boolean mismatches were corrected without changing product acceptance or production source.

PM separately identified the production upload-origin defect: public browser Origin was compared to reverse-proxy internal req.url. The bounded route patch uses the existing APP_URL-bound/cross-site guard. QA independently verified the real persistence/security cases above; no pre-fix baseline reproduction is claimed for that suite. Final QA typecheck also caught TS2352 in the newly ported route test's inferred header union; PM explicitly typed the case table and removed the cast. The16 affected tests and final typecheck now pass; this was a test compilation blocker, with no runtime acceptance weakening.

**Blocked/not performed:** live Google authorization/revoke/upload and real production data cleanup (outside QA authorization); deployed global age/backlog/registration observations await rollout. Backups and Google verification/upload-audit approvals cannot be established locally. Full screen-reader audit and mobile OS provider-consent behavior were not performed; mobile page layout and keyboard checks above are bounded smoke coverage. No new account-deletion UX exists; contact CLI and existing business deletion cover the approved scope. No migration/scope/dependency change requires migration QA.

## Reproduction and evidence

[qa/acceptance-plan.md](qa/acceptance-plan.md) records the preimplementation failure-mode matrix. Scripts: `qa/setup.mjs`, `qa/run.mjs`, `qa/run-db.mjs`, `qa/database.mts`, `qa/browser.mjs`, `qa/server.mjs`, `qa/origin.test.mjs`, `qa/vitest.config.mjs`. All commands run in this workspace with Node22 PATH; setup creates only dedicated local databases.

```sh
node .factory/google-oauth-verification/qa/run-db.mjs node --import tsx .factory/google-oauth-verification/qa/database.mts
node .factory/google-oauth-verification/qa/server.mjs
node --import tsx .factory/google-oauth-verification/qa/browser.mjs
node .factory/google-oauth-verification/qa/run-db.mjs npm test -- src/server/services/social/publish/youtubeRetention.db.test.ts src/server/services/social/publish/youtubeLifecycle.test.ts src/lib/youtubeLifecycle.test.ts src/server/services/social/publish/publish.test.ts src/server/services/social/publish/multiplatform.db.test.ts src/server/deletion/delete.db.test.ts src/server/deletion/restore.db.test.ts src/server/jobs/purge.db.test.ts --maxWorkers=1
node .factory/google-oauth-verification/qa/run-db.mjs npm test -- --config .factory/google-oauth-verification/qa/vitest.config.mjs --maxWorkers=1
node .factory/google-oauth-verification/qa/run-db.mjs npm test -- 'src/app/api/b/[bid]/social-video/route.test.ts' src/server/auth/requests.test.ts --maxWorkers=1
node .factory/google-oauth-verification/qa/run.mjs npm run typecheck
git diff --check
git diff --quiet HEAD -- tsconfig.json next-env.d.ts
```

Logs: `/tmp/radar-youtube-lifecycle-independent-db-final.log`, `/tmp/radar-youtube-lifecycle-independent-browser.log`, `/tmp/radar-youtube-lifecycle-qa-focused.log`, `/tmp/radar-youtube-lifecycle-qa-typecheck.log`, `/tmp/radar-youtube-lifecycle-qa-origin-integration.log`, `/tmp/radar-youtube-lifecycle-qa-origin-regressions.log`. Earlier null-clock failure retained in `/tmp/radar-youtube-lifecycle-independent-db.log`.

Screenshots in `qa/`: `configuration-hold-desktop.png`, `history-scrubbed-desktop.png`, `no-resend-desktop.png`, `approved-schedule-desktop.png`, `no-resend-mobile.png`. QA visually inspected desktop scrubbed history and mobile no-resend evidence. Evidence contains synthetic names/content only. PM owns final build, merge/deploy and authorized production read-only verification; rollback must preserve tombstones and privacy maintenance as A6 specifies.
