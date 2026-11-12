// QA-1 browser smoke, step 2: the app in its supported development mode against the QA database.
//   node .factory/sandbox-publisher/qa/browser-serve.mjs web      (Next dev server on the port in local-env.json)
//   node .factory/sandbox-publisher/qa/browser-serve.mjs worker   (job worker, for the retry scenario)
// The child gets only PATH, HOME, TMPDIR and the QA settings: nothing from the developer's shell or .env.local.
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
const settings = JSON.parse(await fs.readFile('.data/sandbox-publisher/qa/browser/local-env.json', 'utf8'));
const which = process.argv[2] === 'worker' ? 'worker' : 'web';
const args = which === 'web' ? ['node_modules/next/dist/bin/next', 'dev', '-p', settings.PORT] : ['--import', 'tsx', 'src/worker/main.ts'];
const child = spawn(process.execPath, args, { stdio: 'inherit', env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ...settings } });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill('SIGTERM'));
