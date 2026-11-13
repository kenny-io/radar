import { defineConfig } from 'vitest/config';
import path from 'node:path';
// QA's end-to-end run for bounded-page-parse. From the worktree root, with a migrated throwaway database:
//   DATABASE_URL=postgres://… npx vitest run --config .factory/bounded-page-parse/qa/vitest.config.ts
// No host is contacted: the development stub site answers the crawler and the stub extraction stands in for the AI.
export default defineConfig({
  test: { include: ['.factory/bounded-page-parse/qa/*.qa.test.ts'], testTimeout: 180_000, hookTimeout: 120_000, fileParallelism: false },
  resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
});
