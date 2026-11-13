import { defineConfig } from 'vitest/config';
import path from 'node:path';
// The same scenarios through the BASE checkout's detectBrand (in-process decode, so good files only):
//   QA_BASE_CHECKOUT=<path to a checkout of the base revision with node_modules> npx vitest run --config .factory/safe-logo-decode/qa/vitest.base.config.ts
const base = process.env.QA_BASE_CHECKOUT; if (!base) throw new Error('QA_BASE_CHECKOUT is not set');
export default defineConfig({
  test: { include: ['.factory/safe-logo-decode/qa/*.base.test.ts'], testTimeout: 180_000, hookTimeout: 120_000, fileParallelism: false, pool: 'forks' },
  resolve: { alias: { '@': path.join(base, 'src') } },
});
