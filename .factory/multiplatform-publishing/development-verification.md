# Prior development verification

Historical evidence from the original source checkout, before porting onto current production main. Release validation is recorded in release-qa.md, release-architecture.md and release.md.

# Verification

Environment: macOS, Node22, repository base f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49, branch kenny/signup-security, existing dirty working tree retained. Dedicated local PostgreSQL16 databases radar_multiplatform_tests and radar_multiplatform_qa on localhost54329; development stubs, billing off, test encryption key, synthetic verified role fixtures. No live providers or production database changed.

Baseline before implementation: `npm run typecheck` passed; existing shared publishing/UI/adapter tests73/73 passed. Logs `/tmp/radar-multiplatform-baseline-typecheck.log`, `/tmp/radar-multiplatform-baseline-tests.log`.

Developer checks:
- Provider mocked-HTTP suite52/52 passed, including actual request bodies, tokens/scopes, processing, forbidden/missing status reads, explicit terminal failures, ambiguous create503 and tracking-persistence failures. `/tmp/radar-multiplatform-provider-tests.log`.
- Final core corrections74/74 passed, including accepted-reference preservation, status authentication refresh, byte limits, real container validation, consent invalidation and X/LinkedIn regressions. `/tmp/radar-multiplatform-final-corrections.log`.
- Core integrated107/107 passed before final corrections; real FFmpeg MP4/WebM accepted; fake headers, AVIF/HEIC refused. `/tmp/radar-multiplatform-core-final.log`.
- Integrated typecheck and whitespace diff checks passed repeatedly; independent final typecheck passed. PM final typecheck passed after removing only this task’s generated Next include paths; tsconfig.json matches the pre-task dirty patch exactly.

Independent QA: see qa-report.md and machine-readable qa/*results.json for exact scenarios and final fingerprint. Desktop1440x1000 and mobile390x844 in real Chromium; no live account publication. PM visually inspected YouTube-ready desktop and TikTok mobile screenshots. Final independent QA passed: 27 browser scenarios, 8 DB/provider integration checks, 7 HTTP security checks and 162/162 focused tests. Source fingerprint 95709ba9bd7bfedcce3cb2b27dd3afc6be9ef749c3c84ca566a790fae1f10199 (543 files), stable before/after checks.

Broad suite: initial1228 passed/65 skipped/6 failed. One expected aspect-ratio table was extended for the new platforms. Two publishing failures came from overlapping test-run storage cleanup; fixtures now use per-run directories. Final complete rerun: 1245 passed, 65 skipped, 3 unrelated failures across 124 files. All publishing tests passed. Evidence `/tmp/radar-multiplatform-full-final.log`.

Unrelated failures independently reproduced: existing OpenRouter raster golden expected f883614e6a7dfb07 vs actual 91d5409f50974af7 (already documented in .factory/daily-social-drafts/verification.md), and two existing free-check visibility tests (weeklyEmail default and digest wording) in service.db.test.ts. The latter source/test files are outside this feature and were left intact; standalone run8 passed/2 failed, `/tmp/radar-multiplatform-existing-visibility.log`.

Production build: initial in-place `.next-multiplatform-build` run was stopped after read-only process sampling proved it was crawling unrelated nested `.claude/worktrees` dependencies. This was not counted as a pass. Final source-only build in `/tmp/radar-multiplatform-production.nIUMpF`, sanitized environment and existing node_modules symlink, PASSED exit0 on Node22.18.0: compilation10.6s, lint/type validation,53/53 static pages, optimization and traces. Artifact BUILD_ID `bYHh7CfP3X-GUqjixwtKF`; log `/tmp/radar-multiplatform-isolated-build.log`. All587 source/config/public files independently match checkout and build copy SHA256 `f42b1be78f0b54fed7dba12763f6642b88db073be56c1b05cf0ff9128cb61547`. Build processes exited normally. No source deployment/merge requested.

Live OAuth and real publication are UNRUN: require developer app credentials, approved permissions, public HTTPS media hosting, TikTok verified domain/prefix/audit and owned authorized test accounts. Setup documented in docs/SOCIAL_PUBLISHING.md and .env.example.

Final async safety: `SendError.confirmedUnpublished` defaults false. After an accepted provider reference, only an explicit terminal provider state may fail as unpublished and permit another attempt. HTTP403/404/auth/network read failures retain the reference. Final independent regression proves a definitive/auth synthetic 403 cannot unlock a second initialization. YouTube preflight counts 5000 UTF-8 bytes and rejects angle brackets; TikTok uses UTF-16 counts (2,200 video/4,000 photo, optional photo title90).

Closure: final `npm run typecheck` passed (`/tmp/radar-multiplatform-final-typecheck.log`), `git diff --check` passed, QA fingerprint remained unchanged after generated-config cleanup. No requested implementation work remains. Preserved all unrelated changes, did not commit/merge/deploy. Three unrelated broad-suite failures remain documented above.

## Q2: Unified Login compatibility follow-up

Independent QA completed 2026-11-19 (Asia/Dubai). See Q2report.md. Eight real-Chrome picker/security scenarios plus six independent mocked/DB contract checks passed; six-file regression suite99/99 passed, final typecheck and git diff --check passed. Verified explicit account choice, empty assets, keyboard/mobile, encrypted user/business-scoped pending references, forbidden viewer/foreign access, callback state/user/replay protection, pinned mode/config/Graph host, client_business_id instead of system-user/owner IDs, cursor pagination, stable reconnect identity, Never/finite SUAT expiry without legacy refresh/revoke, durable same-container Meta publication and saved-version legacy compatibility.

Final tested source/config SHA256 `1522a63402d75eb756abd7bbf204468654d4146c04c9ae39c3a2b35b6621ae39` (546 files; manifest `/tmp/radar-instagram-unified-qa/fingerprint.json`). All evidence/scripts/screenshots are in `/tmp/radar-instagram-unified-qa/`. QA server stopped,3840 clear. Exact original dirty tsconfig restored from the saved pre-task patch; typecheck passed after cleanup. Live Meta consent/OAuth/new-app target-user access and real publication remain unrun. No deployment or real posts were performed by QA. Earlier Q1 fingerprint/build evidence predates this compatibility patch and is not a substitute for these follow-up results.
