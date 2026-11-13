import { defineConfig } from 'vitest/config';
import path from 'node:path';
// T4 QA probes for real subject covers. Run from the worktree root:
//   npx vitest run --config .factory/real-subject-covers/qa/vitest.config.ts
// The *.db.qa.test.ts files need DATABASE_URL (a migrated throwaway database) and skip themselves without it.
// No third-party host is contacted: `fetch` is replaced, or the server is a local one made by the test, or the dev stub site answers.
export default defineConfig({
  test: { include: ['.factory/real-subject-covers/qa/*.qa.test.ts'], testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false },
  resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
});
