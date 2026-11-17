import { db, sleep, A } from './lib.mjs';
const pool = db(); const at = process.argv[2]; const n = Number(process.argv[3] || 4);
const dump = async tag => {
  console.log(`── ${tag} ${new Date().toISOString()}`);
  console.log((await pool.query("select id, date::text d, status, published_url from calendar_entries where business_id=$1 and (status <> 'proposed' or id in ('e_eHhBP7qn','e_uzjdECec','e_GYxVbPWe')) order by date", [A])).rows.map(r => `${r.id}|${r.d}|${r.status}|${r.published_url || ''}`).join(' ; '));
  console.log((await pool.query("select right(sid,16) s, status, stage, err_code, remote_url from social_pubs where business_id=$1 order by due_at", [A])).rows.map(r => Object.values(r).join('|')).join(' ; '));
  console.log('jobs since restore:', JSON.stringify((await pool.query("select kind, ref, status, left(result::text,70) r from jobs where business_id=$1 and created_at >= $2 order by created_at", [A, at])).rows));
  console.log('ai_calls since restore:', (await pool.query("select count(*) from ai_calls where business_id=$1 and created_at >= $2", [A, at])).rows[0].count, '| notifications:', JSON.stringify((await pool.query("select type, left(payload::text,100) p from notifications where business_id=$1 and created_at >= $2", [A, at]).catch(async () => pool.query("select left(n::text,160) p from notifications n where business_id=$1 and created_at >= $2", [A, at]))).rows), '| new mails:', (await pool.query("select count(*) from lifecycle_emails where created_at >= $1", [at])).rows[0].count, (await pool.query("select count(*) from outbox_emails where created_at >= $1", [at])).rows[0].count);
};
await dump('now');
for (let i = 1; i <= n; i++) { await sleep(62000); await dump(`+${i} min`); }
await pool.end();
