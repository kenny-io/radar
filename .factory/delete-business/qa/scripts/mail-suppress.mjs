import { chromium, session, call, db, BASE } from './lib.mjs';
const SOLO = '36b937ef-0f06-4768-bcc6-83645883932e';
const pool = db(); const b = await chromium.launch();
const { page } = await session(b, 'solo.qa@radar.local', { password: process.env.QA_PW2 }); await page.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' });
const d = await call(page, 'POST', `/api/b/${SOLO}/delete`, { domain: 'solobakery.test' }); console.log('delete', d.status, d.body?.data?.deletedAt, 'nextId', d.body?.data?.nextId);
console.log('mail row while the worker is down:', JSON.stringify((await pool.query("select status, event_key from lifecycle_emails where type='business_deleted' and business_id=$1 order by created_at desc limit 1", [SOLO])).rows));
const r = await call(page, 'POST', '/api/b/restore', { id: SOLO }); console.log('restore', r.status, JSON.stringify(r.body?.data));
await b.close(); await pool.end();
