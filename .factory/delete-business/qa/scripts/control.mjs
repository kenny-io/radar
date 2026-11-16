// Positive control: while Fieldnote is deleted with overdue work, the same worker publishes a due article of an active business.
import { chromium, session, act, ws, db, waitJobs, sleep, A, Bz, BASE } from './lib.mjs';
const pool = db(); const b = await chromium.launch();
const { page } = await session(b, 'dev@radar.local'); await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
let w = await ws(page, Bz); const e = w.calendar.entries[0];
let r = await act(page, Bz, 'blog.saveConnection', { type: 'wordpress', fields: { url: 'https://lumenstudio.test', user: 'radar-qa', pass: 'stub-app-password' }, mode: 'review' }); console.log('conn', r.status, r.body?.error || '');
r = await act(page, Bz, 'calendar.approve', { entryId: e.id }); console.log('approve topic', r.status, r.body?.error || '');
r = await act(page, Bz, 'article.draft', { entryId: e.id }); console.log('draft', r.status, r.body?.error || '');
await sleep(2500); await waitJobs(pool, Bz, 120000);
r = await act(page, Bz, 'calendar.move', { entryId: e.id, date: w.today }); console.log('move to today', r.status, r.body?.error || '');
r = await act(page, Bz, 'article.approve', { entryId: e.id }); console.log('approve', r.status, r.body?.error || JSON.stringify(r.body?.data), 'at', new Date().toISOString());
for (let i = 0; i < 30; i++) {
  await sleep(5000);
  const c = (await pool.query('select status, published_url from calendar_entries where id=$1', [e.id])).rows[0];
  if (c.status === 'published') { console.log('CONTROL published at', new Date().toISOString(), c.published_url); break; }
}
const a = (await pool.query("select id, status from calendar_entries where business_id=$1 and status in ('scheduled','publishing','published') order by date", [A])).rows;
const p = (await pool.query("select right(sid,14) s, status from social_pubs where business_id=$1 and due_at <= now()", [A])).rows;
console.log('deleted business at the same moment: entries', JSON.stringify(a), '| overdue pubs', JSON.stringify(p));
console.log('jobs for the deleted business since its delete:', (await pool.query("select count(*) from jobs where business_id=$1 and created_at >= '2026-11-16 15:22:55.4+00'", [A])).rows[0].count);
await b.close(); await pool.end();
