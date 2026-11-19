# Local independent QA commands

Use explicit Node22 PATH from this worktree. The isolated runners use dedicated localhost Postgres and blank real credentials. Browser app3851 runs in an isolated source snapshot, with ignored QA-only fixture/session/env metadata.

```sh
node .factory/generated-social-media/qa/setup.mjs
node .factory/generated-social-media/qa/server.mjs
node .factory/generated-social-media/qa/browser.mjs
node --import tsx .factory/generated-social-media/qa/browser-extra.mjs
node --import tsx .factory/generated-social-media/qa/browser-states.mjs
node --import tsx .factory/generated-social-media/qa/browser-source.mjs
node .factory/generated-social-media/qa/run.mjs node --import tsx .factory/generated-social-media/qa/render.mts
node .factory/generated-social-media/qa/run.mjs node --import tsx .factory/generated-social-media/qa/cache.mts
node .factory/generated-social-media/qa/run.mjs node --import tsx .factory/generated-social-media/qa/reuse.mts
node .factory/generated-social-media/qa/run.mjs node --import tsx .factory/generated-social-media/qa/resources.mts
node .factory/generated-social-media/qa/run-db.mjs npm test -- --config .factory/generated-social-media/qa/vitest.config.mjs --maxWorkers=1
node .factory/generated-social-media/qa/run.mjs npm run typecheck
git diff --check
git diff --quiet HEAD -- tsconfig.json next-env.d.ts
```

The final report lists the exact developer-test selection and actual results. These are stateful harnesses: setup creates fresh synthetic business/session fixtures; browser.mjs creates a carousel; render.mts explicitly seeds historical0.88Brian cache and writes metadata consumed by browser-extra/cache/reuse/resources. This is not a fresh paid model/voice/R2 production claim. resources.mts terminates only the advisory-lock backend belonging to its own local QA database to check cancellation. run-db.mjs uses a separate local QA database. Command inventory does not imply every command ran on every intermediate source version.
