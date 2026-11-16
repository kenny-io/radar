// DEL-5: no reminder mail about a deleted business. Its due reminders are resolved by the collector instead of being mailed.
import { chromium, session, call, db, sleep, BASE } from './lib.mjs';
const SOLO = '36b937ef-0f06-4768-bcc6-83645883932e';
const pool = db(); const b = await chromium.launch();
const { page } = await session(b, 'solo.qa@radar.local', { password: process.env.QA_PW2 }); await page.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' });
const uid = (await pool.query("select id from users where email='solo.qa@radar.local'")).rows[0].id;
console.log('open reminders before:', JSON.stringify((await pool.query("select kind, resolved_at is not null resolved from engagement_events where business_id=$1", [SOLO])).rows));
console.log('delete', (await call(page, 'POST', `/api/b/${SOLO}/delete`, { domain: 'solobakery.test' })).status);
await pool.query("update engagement_events set eligible_at = now() - interval '1 minute', expires_at = now() + interval '3 days' where business_id=$1 and resolved_at is null", [SOLO]);
const t = new Date().toISOString();
for (let i = 0; i < 16; i++) { await sleep(5000); const open = Number((await pool.query("select count(*) n from engagement_events where business_id=$1 and resolved_at is null and eligible_at <= now()", [SOLO])).rows[0].n); if (!open) break; }
console.log('after a scheduler tick:', JSON.stringify((await pool.query("select kind, resolved_reason, eligible_at > now() deferred from engagement_events where business_id=$1", [SOLO])).rows));
console.log('work_update mails for the owner since:', (await pool.query("select count(*) n from lifecycle_emails where user_id=$1 and type='work_update' and created_at >= $2", [uid, t])).rows[0].n, '| any mail since (besides the delete confirmation):', JSON.stringify((await pool.query("select type, status from lifecycle_emails where user_id=$1 and created_at >= $2 and type <> 'business_deleted'", [uid, t])).rows), '| outbox since:', (await pool.query("select count(*) n from outbox_emails where created_at >= $1", [t])).rows[0].n);
console.log('restore', (await call(page, 'POST', '/api/b/restore', { id: SOLO })).status);
await b.close(); await pool.end();
