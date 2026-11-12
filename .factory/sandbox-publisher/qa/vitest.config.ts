import { defineConfig } from 'vitest/config';
import path from 'node:path';
// QA-1 probes for the sandbox publisher. Run from the repository root:
//   npx vitest run --config .factory/sandbox-publisher/qa/vitest.config.ts
// Live files (*.live.qa.test.ts) skip themselves unless their RADAR_QA_* switch is set.
export default defineConfig({
  test: { include: ['.factory/sandbox-publisher/qa/*.qa.test.ts'], testTimeout: 30_000 },
  resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
});
