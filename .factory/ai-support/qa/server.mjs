import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
const environment = JSON.parse(await fs.readFile('.data/ai-support/local-env.json', 'utf8'));
if (environment.RADAR_DEV_STUBS !== '1' || new URL(environment.APP_URL).hostname !== 'localhost') throw Error('Local stubs required');
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', '3820'], { stdio: 'inherit', env: { ...process.env, ...environment } });
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGTERM', () => child.kill('SIGTERM'));
