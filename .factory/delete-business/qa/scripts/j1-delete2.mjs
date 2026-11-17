import fs from 'node:fs';
import { chromium, session, call, db, A, BASE } from './lib.mjs';
const pool = db(); const b = await chromium.launch();
const { page } = await session(b, 'dev@radar.local'); await page.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' });
// two delete requests at the same moment (two clicks / two tabs)
const [x, y] = await Promise.all([call(page, 'POST', `/api/b/${A}/delete`, { domain: 'fieldnote.app' }), call(page, 'POST', `/api/b/${A}/delete`, { domain: 'FIELDNOTE.APP' })]);
console.log('two deletes at once:', x.status, JSON.stringify(x.body?.data || x.body), '|', y.status, JSON.stringify(y.body?.data || y.body));
const z = await call(page, 'POST', `/api/b/${A}/delete`, { domain: 'fieldnote.app' }); console.log('a third, later:', z.status, z.body?.code);
console.log('row', JSON.stringify((await pool.query("select status, deleted_at, purge_at, purge_at - deleted_at = interval '168 hours' exact from businesses where id=$1", [A])).rows[0]));
console.log('delete mails', JSON.stringify((await pool.query("select status, event_key from lifecycle_emails where type='business_deleted' order by created_at")).rows));
console.log('now', new Date().toISOString());
await b.close(); await pool.end();
