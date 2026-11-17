import { chromium, session, call, db, shot, text, toasts, A, BASE } from './lib.mjs';
const pool = db(); const b = await chromium.launch(); const ok = (name, pass, detail = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
const { page: p } = await session(b, 'dev@radar.local');
await p.goto(BASE + '/restore', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
ok('the owner (who still has another business) sees the deleted one on /restore', /Fieldnote/.test(await text(p)));
// the window ends while the page is open: both timestamps move back 8 days (the check constraint holds)
await pool.query("update businesses set deleted_at = deleted_at - interval '8 days', purge_at = purge_at - interval '8 days' where id=$1", [A]);
console.log('aged:', JSON.stringify((await pool.query("select status, deleted_at, purge_at, purge_at <= now() past from businesses where id=$1", [A])).rows[0]));
await p.getByRole('button', { name: 'Restore Fieldnote' }).click();
let tst = []; for (let i = 0; i < 30 && !tst.length; i++) { await p.waitForTimeout(200); tst = await toasts(p).catch(() => []); }
await p.waitForTimeout(800); const t = await text(p);
ok('RES-3 UI: Restore after the window says the 7 days have passed and drops the row', tst.some(x => /can.t be restored\. Its 7 days have passed\./.test(x)) && /Nothing to restore/.test(t) && new URL(p.url()).pathname === '/restore', JSON.stringify(tst));
await shot(p, '30-restore-refused-after-window');
const r = await call(p, 'POST', '/api/b/restore', { id: A });
ok('RES-3 server: restore is refused once purgeAt has passed although the wipe has not run', r.status === 410 && r.body?.code === 'restore_expired', `${r.status} ${JSON.stringify(r.body)}`);
const me = (await call(p, 'GET', '/api/me')).body; ok('RES-1/3 me.deleted no longer lists it', me.deleted.length === 0);
await p.goto(BASE + '/settings?section=delete', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
ok('Settings no longer shows Recently deleted', !/Recently deleted/.test(await text(p)));
ok('the row is still there, still deleted (nothing was wiped by the refused restore)', (await pool.query('select status from businesses where id=$1', [A])).rows[0].status === 'deleted');
const w = await call(p, 'GET', `/api/b/${A}/workspace`); ok('its routes still answer 404 business_deleted', w.status === 404 && w.body?.code === 'business_deleted');
await b.close(); await pool.end();
