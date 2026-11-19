# Q7 automatic media readiness fix

Frozen bounded implementation on HEAD `11905d5ed9ae27297f7a89f6c2a33d51f508e241`; seven owned source paths, fingerprint `8f2f1a263c95f3ce8eb2c8e6c92817dabd03c5aa4c1adff8644ef24928a7dd0e`. Manifest `/tmp/radar-automatic-media-readiness-fingerprint.json`. Backend M2 planner/material source files and PM/QA/verification records were preserved; no changes to renderer, narration, defaults, voice or source processing. No commit/deployment/production preference edit/provider post by this engineer.

## Defect and fix

QA found that a failed YouTube replacement for revised source correctly kept the old valid video, but standalone scheduling treated that retained attachment as automatic-ready. I also added an actual Instagram reproduction BEFORE extending the fix: revised source → actual Prepare → Generate video → missing voice configuration failure → retained owned JPEG → automatic scheduling returned1 instead of0. Red log `/tmp/radar-a7a-ig-repro.log`; green targeted retest `/tmp/radar-a7a-ig-fixed.log`.

One shared pure `automaticMediaReady` predicate now distinguishes current generated output from retained older output. With an intent present, automatic publication requires status `ready` and `generatedMedia.id === mediaGeneration.id`. Pending/failed/uncertain/cancelled intents and ready planning-only or obsolete attachment identities do not qualify. Legacy posts without a generation intent remain compatible.

YouTube eligibility already feeds both transaction-time scheduling and final beforeCreate authorization; it now uses the shared predicate. Instagram automatic writeScheduled and fresh beforeCreate checks reread the pack under business→pack locks through `mediaReadiness.ts`. No provider network runs under these locks. Existing A6 publication predicates are unchanged. TikTok gains no standing consent or auto scheduling.

All gates are automatic-only. Explicit manual posts/schedules can still use retained old media after failure. Existing approved manual rows are not rewritten. Accepted providerRef work bypasses the new-init gate and resumes observation without a second initialization. Successful exact-intent attachment still qualifies for automatic scheduling.

## Verification performed

- Focused 58/58: 39 actual-DB cases plus19 pure checks. Includes actual failed YT and IG replacements, fresh final-init rejection after provider preparation, ready-ID mismatch, successful exact-intent attachment scheduling, preserved explicit manual scheduling/send and accepted-ref continuation for both platforms.
- Full affected regression batch195/195 across7 suites: shared social rules, defaults/readiness, A6 retention, multiplatform publishing/TikTok consent, real generated-media pipeline and master Autopilot.
- Full Node22 `tsc --noEmit`: exit0, no output. `git diff --check`: clean.
- No UI changes, browser retest or real public provider calls were performed for this bounded fix. Provider adapters execute beforeCreate but synthesize remote responses. Narration failure is intentionally generated with an empty synthetic key, with no paid call. QA owns independent acceptance and has the candidate source.

Commands: `/Users/ekene/.nvm/versions/node/v22.18.0/bin/node /tmp/run-radar-a7a.mjs --no-file-parallelism` followed by the seven affected suite paths. Runner uses ignored whitelisted synthetic env for local DB `radar_media_a7a_tests` only. Logs `/tmp/radar-a7a-obsolete-ig-tests.log` (58), `/tmp/radar-a7a-obsolete-final.log` (195), `/tmp/radar-a7a-obsolete-tsc-final.log` (typecheck).

## Exact owned source changes

- `src/lib/socialPublish.ts`
- `src/lib/youtubeAutomation.ts`
- `src/lib/youtubeAutomation.test.ts`
- `src/server/services/social/publish/mediaReadiness.ts`
- `src/server/services/social/publish/schedule.ts`
- `src/server/services/social/publish/send.ts`
- `src/server/services/social/publish/youtubeAutomation.db.test.ts`

Integrate these files together and preserve both A6 lifecycle/approval/noResend guards and the exact-intent automatic readiness rule. The shared predicate intentionally does not change manual preflight. No migration or environment/configuration change is needed.
