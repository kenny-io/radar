import { defineConfig } from 'vitest/config';
import path from 'node:path';
// T4 QA probes for contextual article images. Run from the worktree root:
//   npx vitest run --config .factory/contextual-article-images/qa/vitest.config.ts
// The *.db.qa.test.ts files need DATABASE_URL (a migrated throwaway database) and skip themselves without it.
// No provider is called anywhere: image providers are a mocked `fetch`, text models are the dev stubs.
export default defineConfig({
  test: { include: ['.factory/contextual-article-images/qa/*.qa.test.ts'], testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false },
  resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
});
