import { chromium, session, call, db, sleep, A, BASE } from './lib.mjs';
const pool = db(); const b = await chromium.launch();
const { page } = await session(b, 'dev@radar.local'); await page.goto(BASE + '/restore', { waitUntil: 'domcontentloaded' });
const [x, y] = await Promise.all([call(page, 'POST', '/api/b/restore', { id: A }), call(page, 'POST', '/api/b/restore', { id: A })]);
const at = new Date().toISOString();
console.log('RES-4 two restores at once:', x.status, JSON.stringify(x.body), '|', y.status, JSON.stringify(y.body), 'at', at);
console.log('row', JSON.stringify((await pool.query('select status, deleted_at, purge_at, rev from businesses where id=$1', [A])).rows[0]));
console.log('restore events', (await pool.query("select count(*) from events where business_id=$1 and kind='action.business.restore'", [A])).rows[0].count, '(one per real restore: 2 expected so far)');
const dump = async tag => {
  console.log(`── ${tag} ${new Date().toISOString()}`);
  console.log((await pool.query("select id, date, status, published_url from calendar_entries where business_id=$1 and (status <> 'proposed' or id in ('e_eHhBP7qn','e_uzjdECec','e_GYxVbPWe')) order by date", [A])).rows.map(r => `${r.id}|${r.date.toISOString?.().slice(0,10) || r.date}|${r.status}|${r.published_url || ''}`).join('\n'));
  console.log((await pool.query("select right(sid,16) s, status, stage, err_code, err, err_detail, remote_url, retry_at from social_pubs where business_id=$1 order by due_at", [A])).rows.map(r => Object.values(r).join('|')).join('\n'));
  console.log('jobs since restore:', JSON.stringify((await pool.query("select kind, ref, status, left(result::text,70) r from jobs where business_id=$1 and created_at >= $2 order by created_at", [A, at])).rows));
  console.log('ai_calls since restore:', (await pool.query("select count(*) from ai_calls where business_id=$1 and created_at >= $2", [A, at])).rows[0].count, '| notifications:', JSON.stringify((await pool.query("select kind, left(payload::text,80) p from notifications where business_id=$1 and created_at >= $2", [A, at])).rows), '| mails:', (await pool.query("select count(*) from lifecycle_emails where created_at >= $1", [at])).rows[0].count, (await pool.query("select count(*) from outbox_emails where created_at >= $1", [at])).rows[0].count);
};
await dump('right after restore');
for (let i = 1; i <= 4; i++) { await sleep(62000); await dump(`after ~${i} scheduler tick(s)`); }
await b.close(); await pool.end();
