import { execFile } from 'node:child_process'; import { promisify } from 'node:util';
import { db } from './lib.mjs'; import { mkbiz, state } from './mkbiz.mjs';
const run = promisify(execFile); const W = '/Users/ekene/Downloads/design_handoff_radar/radar-push/.claude/worktrees/radar-delete-business-36eee1';
const pool = db(); const owner = (await pool.query("select id from users where email='solo.qa@radar.local'")).rows[0].id;
const cases = [[150, 'restore-first'], [150, 'purge-first'], [40, 'restore-first'], [40, 'purge-first'], [12, 'restore-first'], [12, 'purge-first'], [4, 'restore-first'], [4, 'purge-first'], [0, 'restore-first'], [0, 'purge-first'], [-6, 'restore-first'], [-6, 'purge-first']];
const one = async ([offset, order], i) => {
  const id = await mkbiz(pool, 'solo.qa@radar.local', `race-${i}`, '9 seconds');
  const { stdout } = await run('npx', ['tsx', '.factory/delete-business/qa/tools/race.ts', owner, id, String(offset), order], { cwd: W, env: process.env });
  const s = await state(pool, id);
  const consistent = (s.status === 'active' && s.rows === 5 && s.files === 'hero/draft.png,hero/kept.png,logo/logo.png') || (s.status === 'gone' && s.rows === 0 && s.files === 'hero/kept.png');
  return `${consistent ? 'PASS' : 'FAIL'} offset ${String(offset).padStart(4)} ms ${order.padEnd(13)} → ${stdout.trim().split('\n').pop()} → ${JSON.stringify(s)}`;
};
for (let i = 0; i < cases.length; i += 3) for (const line of await Promise.all(cases.slice(i, i + 3).map((c, j) => one(c, i + j)))) console.log(line);
await pool.end();
