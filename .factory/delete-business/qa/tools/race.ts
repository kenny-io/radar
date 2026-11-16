// QA helper: a restore and the wipe on the same business at the moment its window ends (the product's own functions, same
// process, local database only).  npx tsx .factory/delete-business/qa/tools/race.ts <owner user id> <business id> <offset ms> <order>
import { purgeOne } from '../../../../src/server/jobs/purge';
import { restoreBusiness } from '../../../../src/server/deletion';
import { pool } from '../../../../src/server/db';
const [owner, bid, offset, order] = process.argv.slice(2);
const left = async () => Number((await pool.query('select extract(epoch from (purge_at - now())) * 1000 ms from businesses where id=$1', [bid])).rows[0]?.ms);
for (;;) { const ms = await left(); if (!(ms > Number(offset) + 15)) break; await new Promise(r => setTimeout(r, Math.min(200, Math.max(1, ms - Number(offset) - 10)))); }
const r = () => restoreBusiness(owner, bid).then(x => 'restored', e => 'restore:' + (e?.code || e?.message));
const p = () => purgeOne(bid).then(x => x === 'skipped' ? 'purge:skipped' : 'wiped', e => 'purge threw:' + e?.message);
const out = order === 'purge-first' ? await Promise.all([p(), r()]) : await Promise.all([r(), p()]);
console.log(JSON.stringify(out.sort()));
await pool.end();
