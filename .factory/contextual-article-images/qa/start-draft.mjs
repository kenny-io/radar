// T4 QA: queue a draft the way the D-1 cron does (no browser, no web server), against QA's database.
//   node .factory/contextual-article-images/qa/start-draft.mjs <entryId>
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const settings = JSON.parse(await fs.readFile('.data/contextual-article-images/qa/local-env.json', 'utf8'));
const fixture = JSON.parse(await fs.readFile('.data/contextual-article-images/qa/fixture.json', 'utf8'));
const code = `import { startDraft } from './src/server/services/drafting/start.ts'; import { pool } from './src/server/db/index.ts'; const id = await startDraft(${JSON.stringify(fixture.businessId)}, ${JSON.stringify(process.argv[2])}, 'cron'); console.log('queued', id, new Date().toISOString()); await pool.end();`;
const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ...settings }, encoding: 'utf8' });
process.stdout.write(r.stdout); process.stderr.write(r.stderr.split('\n').filter(l => !/ExperimentalWarning|--trace-warnings/.test(l)).join('\n'));
