import fs from 'node:fs';
import { db, A, Bz } from './lib.mjs'; import { files, mentions, world } from './wipe-lib.mjs';
const SOLO = '36b937ef-0f06-4768-bcc6-83645883932e', P = 'e109d5fa-e0b2-4bfb-9dc6-c98a933e2037';
const pool = db();
const before = { at: new Date().toISOString(), files: files(), mentions: await mentions(pool, A), world: await world(pool, { B: Bz, Solo: SOLO, P }),
  counts: (await pool.query("select (select count(*) from events) events, (select count(*) from events where business_id=$1) events_a, (select count(*) from ai_calls) ai_calls, (select count(*) from ai_calls where business_id=$1) ai_calls_a, (select coalesce(sum(cost_usd),0) from ai_calls) cost, (select count(*) from proposals) proposals, (select count(*) from live_links) live_links", [A])).rows[0],
  props: (await pool.query("select left(business_id::text,8) biz, direction, partner_business_id is not null has_partner, decision from proposals order by 1,2")).rows };
fs.writeFileSync(new URL('./wipe-before2.json', import.meta.url).pathname, JSON.stringify(before, null, 1));
console.log('mentions before:', JSON.stringify(before.mentions)); console.log('counts before:', JSON.stringify(before.counts)); console.log('files:', Object.keys(before.files).length);
console.log('due:', JSON.stringify((await pool.query("select id, domain, purge_at from businesses where status='deleted'")).rows));
await pool.end();
