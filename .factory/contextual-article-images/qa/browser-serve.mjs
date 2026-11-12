// T4 QA browser checks, step 2: the app in its supported development mode against QA's database.
//   node .factory/contextual-article-images/qa/browser-serve.mjs web      (Next dev server on port 3217)
//   node .factory/contextual-article-images/qa/browser-serve.mjs worker   (job worker: drafts and body-image jobs)
// The child gets only PATH, HOME, TMPDIR and the QA settings: nothing from the developer's shell or any .env file.
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
const settings = JSON.parse(await fs.readFile('.data/contextual-article-images/qa/local-env.json', 'utf8'));
const which = process.argv[2] === 'worker' ? 'worker' : 'web';
const args = which === 'web' ? ['node_modules/next/dist/bin/next', 'dev', '-p', settings.PORT] : ['--import', 'tsx', 'src/worker/main.ts'];
const child = spawn(process.execPath, args, { stdio: 'inherit', env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ...settings } });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill('SIGTERM'));
