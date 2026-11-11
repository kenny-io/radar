import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
const source = JSON.parse(await fs.readFile('.data/ai-support/local-env.json', 'utf8'));
if (new URL(source.DATABASE_URL).hostname !== 'localhost') throw Error('Local database required');
await fs.access('.next-support-build/BUILD_ID');
const environment = { ...source, NODE_ENV: 'production', APP_URL: 'http://localhost:3822', NEXT_DIST_DIR: '.next-support-build' };
for (const name of ['RESEND_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY', 'STRIPE_SECRET_KEY']) environment[name] = '';
// RADAR_DEV_STUBS remains set deliberately: production must ignore it.
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3822'], { stdio: 'inherit', env: { ...process.env, ...environment } });
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGTERM', () => child.kill('SIGTERM'));
