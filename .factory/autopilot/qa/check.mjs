import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
const settings = JSON.parse(await fs.readFile('.data/autopilot/local-env.json', 'utf8'));
const args = process.argv.slice(2);
if (!args.length) throw new Error('Specify a local validation command.');
const child = spawn(args[0], args.slice(1), { stdio: 'inherit', env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ...settings } });
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGTERM', () => child.kill('SIGTERM'));
