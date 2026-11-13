import { defineConfig } from 'vitest/config';
import path from 'node:path';
// QA probes for safe-provider-image-decode. Run from the worktree root, after make-corpus.mjs and old-decode.mjs:
//   QA_CORPUS=<corpus dir> npx vitest run --config .factory/safe-provider-image-decode/qa/vitest.config.ts
// No provider is called (fetch is replaced), no database is used (the db module is replaced).
export default defineConfig({
  test: { include: ['.factory/safe-provider-image-decode/qa/*.qa.test.ts'], testTimeout: 3_600_000, hookTimeout: 120_000, fileParallelism: false },
  resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
});
