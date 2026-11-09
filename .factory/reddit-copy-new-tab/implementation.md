# New-tab correction implementation — R9

Implemented in native release worktree `/Users/ekene/.codex/worktrees/reddit-copy-release/radar-push`, branch `kenny/reddit-copy-new-tab`, fresh main base `8bc73298a9d9273a172e2806afa138e66e932794`.

Only the three scoped source/test files below changed. DailyBrief changes are limited to the helper import and recovery toast; independent image-progress work and existing keyboard/variant/edit behavior are preserved. Historical feature release records and unrelated working-tree changes were left untouched. No schema, dependency, configuration, server brevity, git-ref, commit or deployment changes were performed by this engineer.

## Behavior

The helper validates the thread destination, starts clipboard access immediately, then reserves an `about:blank` tab in the same gesture call stack. It clears that tab's opener before awaiting clipboard or persistence. External Reddit navigation uses the reserved tab's `location.replace` only after both succeed. Radar's location is never changed.

A denied/unavailable clipboard or failed save closes the reserved tab, keeping existing recovery handling. A blocked/throwing popup, user-closed tab, unsafe opener assignment or navigation exception leaves the successful copy/save intact and requests an explicit **Open Reddit** toast action. That fresh gesture opens the validated destination with `noopener,noreferrer`. Invalid/missing destinations copy and save without reserving a tab. Existing duplicate-copy protection, manual “I posted it” and selected edited response semantics remain intact.

## Validation

- **141/141 focused tests passed**, eight files: `npm test -- src/features/brief/redditCopy.test.ts src/lib/promptClipboard.test.ts src/lib/socialPublish.test.ts src/features/social/channels/logic.test.ts src/server/services/brief/replyBrevity.test.ts src/server/services/brief/plan.test.ts src/server/services/brief/rules-figures.test.ts src/server/services/brief/cap.test.ts`.
- **31 helper/URL tests passed** within that run: synchronous clipboard-before-popup ordering; opener removal; delayed clipboard and save; exact response; clipboard denied/unavailable; persistence false/rejection; invalid destinations; popup null/exception; combined popup throw plus rejected clipboard; user-closed tab; failed navigation; opener assignment failure; cleanup exception preservation. Original-window navigation remains unused.
- **Typecheck passed:** `npm run typecheck`, log `/tmp/radar-reddit-new-tab-typecheck.log`.
- **Scoped diff check passed.**
- **Production build passed:** real `npm run build` exit 0, optimized compile/type validation/page data/all 36 static pages/optimization/traces completed. Log `/tmp/radar-reddit-new-tab-build.log`. Sanitized environment, intentionally unreachable local build-only database, local APP_URL/build-only key, telemetry off, no production or provider credentials. Existing dependencies reused; no environment files copied.

Independent browser QA owns real popup/clipboard focus, top/footer/C, edited variants, repeated copies, mobile and recovery-action checks. Live Reddit scrolling/authenticated posting is outside this deterministic local implementation check.

## Source fingerprints

| File | SHA256 |
| --- | --- |
| `src/features/brief/DailyBrief.tsx` | `676d5264f414dccf50f1fc574eef2353e708c67639eaa0922df4e4ddcec8b706` |
| `src/features/brief/redditCopy.ts` | `067c96e255af40889ca7e6e15a1e3ea276b2509e081a4d7dfd80c026ddf2fed0` |
| `src/features/brief/redditCopy.test.ts` | `9354c25ce924dd8d59ef10ab57398dd3a0d71cf2946031ebc271d192a2e93fd3` |

Combined SHA256 of sorted `path + space + fileHash + newline` rows: `35338f1ee61172c747e4616ecb78504a999fb06c7eea3f7bf69b174509f4e09d`.
