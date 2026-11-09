# Release integration — R6

Integrated only the Reddit copy/header and concise-reply feature into native release worktree `/Users/ekene/.codex/worktrees/reddit-copy-release/radar-push`, base `origin/main` at `d8ac2d3a537c9d970e493d2e3940e8b6aba33c11`. PM created release branch `kenny/reddit-copy-concise-replies` while checks ran. The original dirty checkout at `/Users/ekene/Downloads/design_handoff_radar/radar-push` was read only and preserved. Git refs, PR, merge, deployment and final release records belong to PM.

## Exact integration

Only these six source/test files were copied, byte for byte from the independently reviewed original:

| File | SHA256 |
| --- | --- |
| `src/features/brief/DailyBrief.tsx` | `7bb3433b902a4780096a10e866ab001866139588082f937ac351ed86699efb14` |
| `src/features/brief/redditCopy.ts` | `4202faf3747129ecc1df8518caf2edd2fdbbdcb9a54a8113967b771c850dfd7b` |
| `src/features/brief/redditCopy.test.ts` | `feafb969a59969b2523910a60d2d93626073b83fc48a6e2686973ae1cfd36486` |
| `src/server/services/brief/draft.ts` | `a7a375e7269139f8fdd1577386ba5d46ca68451de41e499a197cf3dc980d487f` |
| `src/server/services/brief/rules.ts` | `f0d397ae1b8355eb5a71a0d732bc163ca44a276898ec77488fceed2845c8980c` |
| `src/server/services/brief/replyBrevity.test.ts` | `a19b44c6be0abccc641741f0f2ca2d5d8566ff09a80e4245f86acc3250065d1a` |

Combined SHA256 of sorted `path + space + fileHash + newline` rows: `45990bde72ad27e75dfebc6f25c3a8b5e5be3b68b7efebda88d8f6fecff3f184`.

Existing clipboard dependency `src/lib/promptClipboard.ts` is byte-identical on release base and source; SHA256 `177acf874ca762d99f7f28ac5265b7b42b0121e33accd7ecd5933ce7e1f8b243`.

Both `package.json` and `package-lock.json` match the original checkout byte for byte. Reused its `node_modules` through an ignored symlink; no dependency or lockfile changes. Copied original feature brief/state/verification and portable QA `.mjs`/`.json`/`.md` records; omitted screenshots and large logs. Original records retain historical source-checkout context; release verification below applies to the main release base. QA owns additional release harnesses/evidence.

## Release-base checks

- **133/133 tests passed**, eight files: `npm test -- src/features/brief/redditCopy.test.ts src/lib/promptClipboard.test.ts src/lib/socialPublish.test.ts src/features/social/channels/logic.test.ts src/server/services/brief/replyBrevity.test.ts src/server/services/brief/plan.test.ts src/server/services/brief/rules-figures.test.ts src/server/services/brief/cap.test.ts`.
- **Typecheck passed:** `npm run typecheck`; log `/tmp/radar-reddit-release-typecheck.log`.
- **Production build passed:** real `npm run build`, exit 0. Optimized compilation, lint/type validation, page-data collection, all 36 static pages, page optimization and build tracing completed. Log `/tmp/radar-reddit-release-build.log`. Only incidental warning: host npm config key `python`.
- Source byte/fingerprint comparison passed after focused checks. No environment files copied; production build receives only host PATH/HOME/TMPDIR plus `NODE_ENV=production`, telemetry off, local APP_URL, local build-only encryption key, and intentionally unreachable local build-only PostgreSQL URL. No production credentials or live-provider keys supplied.

- **Scoped `git diff --check` passed** after the production build. Six source/test files still exactly match the approved original; package/lock and tracked configuration remain unchanged.

No migrations, new environment variables or infrastructure changes are required. No unrelated source, dependency or configuration change was included. Independent release browser checks and deployment verification remain with QA/PM.
