import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({ test: { include: ['.factory/refresh-publishing/qa-contract.test.ts'] }, resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } } });
