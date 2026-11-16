// QA helper: call the wipe's own functions from a second process (the product code, unchanged; local database only).
//   npx tsx .factory/delete-business/qa/tools/purge.ts one <business id>
//   npx tsx .factory/delete-business/qa/tools/purge.ts due [owner id …]
import { purgeOne, purgeDue } from '../../../../src/server/jobs/purge';
import { pool } from '../../../../src/server/db';
const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'one') console.log('purgeOne →', JSON.stringify(await purgeOne(rest[0])));
  else if (cmd === 'due') console.log('purgeDue →', JSON.stringify(await purgeDue(rest.length ? { ownerIds: rest } : {})));
  else throw new Error('usage: one <id> | due [owner…]');
} catch (e: any) { console.log('THREW:', e?.message || String(e)); }
await pool.end();
