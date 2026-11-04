import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({ test: { include: ['.factory/lifecycle-emails/engagement/qa/*.test.ts'], fileParallelism: false }, resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } } });
