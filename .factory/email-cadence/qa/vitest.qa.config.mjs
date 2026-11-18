// QA probes for the email cadence correction. Run from the repository root:
//   DATABASE_URL=postgres://postgres@127.0.0.1:55433/<fresh db> npx vitest run --config .factory/email-cadence/qa/vitest.qa.config.mjs --no-file-parallelism
import { defineConfig } from 'vitest/config';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../../..');
export default defineConfig({ root, test: { include: ['.factory/email-cadence/qa/**/*.probe.test.ts'] }, resolve: { alias: { '@': path.resolve(root, 'src') } } });
