import { defineConfig } from 'vitest/config';
import path from 'node:path';
// QA probes for safe logo and brand-colour reading. Run from the worktree root:
//   npx vitest run --config .factory/safe-logo-decode/qa/vitest.config.ts
// e2e.db.qa.test.ts needs DATABASE_URL (a migrated throwaway database) and skips itself without it.
// No host is contacted: the crawler's fetch is replaced by a table of paths, or the development stub site answers.
export default defineConfig({
  test: { include: ['.factory/safe-logo-decode/qa/*.qa.test.ts'], testTimeout: 180_000, hookTimeout: 120_000, fileParallelism: false },
  resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
});
