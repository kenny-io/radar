// Run a command with the QA env only (no inherited secrets). Usage: node run.mjs [KEY=VALUE ...] -- cmd args
import fs from 'node:fs'; import { spawn } from 'node:child_process';
const env = JSON.parse(fs.readFileSync('.data/custom-post-qa/local-env.json', 'utf8'));
const args = process.argv.slice(2); const split = args.indexOf('--'); const over = Object.fromEntries(args.slice(0, split).map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const [cmd, ...rest] = args.slice(split + 1);
const child = spawn(cmd, rest, { stdio: 'inherit', env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ...env, ...over } });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s));
child.on('exit', c => process.exit(c ?? 1));
