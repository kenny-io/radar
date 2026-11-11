import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
const settings = JSON.parse(await fs.readFile('.data/autopilot/local-env.json', 'utf8'));
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'build'], { stdio: 'inherit', env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ...settings, NODE_ENV: 'production', NEXT_DIST_DIR: '.next-autopilot-build' } });
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGTERM', () => child.kill('SIGTERM'));
