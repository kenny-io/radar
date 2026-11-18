# Release integration — E4

Integrated into `/Users/ekene/.codex/worktrees/radar-multiplatform-release/radar-push`, branch `kenny/multiplatform-publishing`, from current production base `3c3ded28945394df71fc49c41a4d8d066b445662`.

Tested delivery revision: `e81d816bc628c9d3be7a2658df94e1394a0224b3`. No source/config/public changes remained after the PM's commit. Engineer manifest covers 784 tracked source/public/config files, SHA256 `f40c53a5be60b866f0e4f46f4f2c18937994cecdacacc990dbca3b98433822db`; full manifest `/tmp/radar-multiplatform-release-engineer-fingerprint.json`.

## Feature-only extraction

The original checkout remained read-only. Restored its pre-feature tracked baseline from HEAD `f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49` plus `/tmp/radar-multiplatform-preexisting.patch` in a temporary directory. Derived only the subsequent feature delta and merged it three ways into current main. Ported 35 tracked file deltas and 13 explicitly selected new feature files. Inventory: `/tmp/radar-multiplatform-release-file-inventory.json`; original feature delta: `/tmp/radar-multiplatform-feature-only.patch`.

Only `social/generate.ts` and `social/publish/send.ts` conflicted. Retained current-main shared image generation/crop prompts, custom writing instructions, engagement reminder hooks, transactional scheduling and deleted-business guards. No package, lockfile, Next configuration, TypeScript configuration, migration or migration-journal change. Current Autopilot coordinator, daily email cadence and lifecycle runtime modules are unchanged.

Current-main integration adds four bounded files: Autopilot settings copy, platform instruction fixtures, Autopilot regression coverage and shared-image regression coverage. The settings explain automatic Instagram eligibility and TikTok/YouTube per-post requirements.

## Publishing boundaries

Instagram/TikTok/YouTube code, Unified Login provenance/account picker, media upload, privacy/audience/disclosure controls and durable accepted-operation recovery are included. Provider creates additionally run an ephemeral last-moment guard for current attempt ownership, active business, connected/nonexpired account, publishing flag and current Autopilot activation. This guard is never serialized. It runs immediately before Instagram container creation/media publication, TikTok initialization and YouTube upload; accepted-reference denials preserve the locked operation rather than claiming nothing was published.

Regressions prove that deleting a business prevents accepted-operation resumption, and that deletion during Instagram's status request prevents the following `media_publish`. Existing accepted references stay intact and cannot be automatically initialized again.

## Verification

Environment: Node `22.18.0`; exact `npm ci` dependencies; synthetic local PostgreSQL database `radar_multiplatform_release_tests` at localhost:54329; development stubs, publishing enabled, billing off, local-only encryption key. Repository migrations applied to this new isolated database. No production database/account or customer Autopilot setting was modified.

- Before port: `npm run typecheck` passed; 84/84 focused baseline tests passed. Logs `/tmp/radar-multiplatform-release-baseline-typecheck.log` and `/tmp/radar-multiplatform-release-baseline-tests.log`.
- Integrated final typecheck passed. Log `/tmp/radar-multiplatform-release-typecheck-final.log`.
- Integrated final focused suite: **257/257 passed in 15 files**, `--maxWorkers=4`. Includes all social publishing tests, shared rules/UI logic, custom writing instructions, actual shared image/crop behavior, Autopilot program/cadence, engagement follow-through and business deletion. Log `/tmp/radar-multiplatform-release-focused-final.log`.
- `git diff --check` passed. Source/config/public match the tested delivery commit.

Focused command (with the local environment above):

```sh
npm test -- src/server/services/social/publish src/lib/socialPublish.test.ts src/features/social/channels/logic.test.ts src/server/services/social/instructions.test.ts src/server/services/social/packImage.test.ts src/server/services/social/social.test.ts src/server/services/autopilot/autopilot.db.test.ts src/server/services/lifecycle/engagementPublishing.test.ts src/server/deletion/delete.db.test.ts --maxWorkers=4
```

Added meaningful current-main integration regressions: one image-model generation across the three new platforms with correct preview sizes/JPEG output; new-platform custom instruction requests; automatic Instagram scheduling while TikTok/YouTube without required choices/media go to the owner; and the deleted-business/provider boundaries above.

## Baseline test stability

An existing Autopilot test was time-dependent after 23:30 UTC: the daily-email fallback correctly emitted the first message before the generated pack arrived, leaving its later item for the next day. Reproduced the identical failure against an unmodified current-main archive; log `/tmp/radar-multiplatform-release-baseline-autopilot.log`. Fixed only that test's clock to noon, retaining every assertion; production cadence is unchanged and separate boundary cases remain covered.

An existing image test performs twelve real canvas renders and exceeded its five-second timeout while release build/browser/test workers competed for CPU. Its unfinished work then polluted the next fixture. Set only that case's timeout to 30 seconds, retaining its assertions and ensuring it finishes before the next fixture starts. Final bounded suite passed both cases.

## Handoff

Ready for independent release QA, architect build and PM-controlled delivery. Engineer performed no browser operation, real OAuth/post, credential change, commit, push, merge or deployment. Live platform acceptance/app review remains distinct from mocked-provider and local-browser verification. Provider setup/restrictions and local-only SUAT disconnect behavior are documented in `docs/SOCIAL_PUBLISHING.md`.

## Broad-suite triage requested by PM

The broad suite ran while build/browser verification competed for resources and multiple suites invoked global crons in one database. PM is independently rerunning its failed files sequentially.

- **OpenRouter raster golden is pre-existing:** reproduced against an unmodified archive of current main `3c3ded28945394df71fc49c41a4d8d066b445662`, Node22 with the same exact dependencies. Expected branded-image hash `f883614e6a7dfb07`, actual `91d5409f50974af7`, exactly the release-suite mismatch. Golden assertions were preserved. Baseline log `/tmp/radar-multiplatform-release-baseline-purge-golden.log` (89 passed, 1 known golden failure across two files).
- **Purge seed-count failure does not persist in isolation:** unchanged-main purge suite passed 16/16; tested release purge suite also passed 16/16 with `--maxWorkers=1`. Release log `/tmp/radar-multiplatform-release-purge-solo.log`. The concurrent broad run added one job and one cron mark to an otherwise untouched kept-business fixture; this is consistent with another suite's global cron scanning that fixture. No purge or other unrelated production code was changed.
