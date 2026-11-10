import fs from 'node:fs';
import { spawn } from 'node:child_process';
const config = JSON.parse(fs.readFileSync('.data/refresh-publishing/report-ui/local-env.json', 'utf8'));
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ...config };
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--port', '3851'], { stdio: 'inherit', env });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code || 0; });
