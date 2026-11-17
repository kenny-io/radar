import fs from 'node:fs';
import { chromium, session, act, call, ws, db, sleep, shot, text, Bz, BASE } from './lib.mjs'; import { files, mentions, world } from './wipe-lib.mjs';
const SOLO = '36b937ef-0f06-4768-bcc6-83645883932e', P = 'e109d5fa-e0b2-4bfb-9dc6-c98a933e2037';
const pool = db(); const b = await chromium.launch(); const ok = (name, pass, detail = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
const own = await session(b, 'dev@radar.local'); const p = own.page; const solo = await session(b, 'solo.qa@radar.local', { password: process.env.QA_PW2 }); await solo.page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
await p.goto(BASE + '/dashboard', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
// E-2: add the same domain again while the deleted one is inside its window
await p.locator('aside, nav').locator('button').filter({ hasText: 'solobakery.test' }).first().click(); await p.waitForTimeout(400);
await p.getByText(/add (a )?business/i).first().click();
const dlg = p.locator('[role=dialog]').last(); await dlg.locator('input').first().fill('lumenstudio.test'); await dlg.getByRole('button', { name: 'Analyze website' }).click();
await p.waitForTimeout(3000);
const draft = (await pool.query("select id from businesses where domain='lumenstudio.test' and status='onboarding'")).rows[0]?.id;
let r = await call(p, 'POST', `/api/b/${draft}/delete`, { domain: 'lumenstudio.test' });
ok('DEL-8 a business that is still being set up cannot be deleted this way', r.status === 409 && r.body?.code === 'not_active', `${r.status} ${JSON.stringify(r.body)}`);
for (let i = 0; i < 20; i++) { await p.waitForTimeout(2500); if (!(await dlg.count())) break; const next = dlg.getByRole('button', { name: /^(review what radar found|looks right|skip for now|save profile)/i }).last(); if (await next.count() && await next.isEnabled()) await next.click(); }
await p.waitForTimeout(3000);
const rows = (await pool.query("select id, status from businesses where domain='lumenstudio.test' order by created_at")).rows;
ok('E-2 adding the same domain during the window makes a new business; the deleted one is still there', rows.length === 2 && rows[0].id === Bz && rows[0].status === 'deleted' && rows[1].status === 'active', JSON.stringify(rows));
const NEW = rows[1].id;
let me = (await call(p, 'GET', '/api/me')).body; ok('E-2 the deleted one is still offered for restore', me.deleted.some(x => x.id === Bz) && me.businesses.some(x => x.id === NEW));
await sleep(8000);   // let the new business's first-run jobs settle
r = await call(p, 'POST', '/api/b/restore', { id: Bz }); ok('E-2 / decision F: the deleted one restores next to the newer business on the same domain', r.status === 200 && r.body?.data?.open === true, JSON.stringify(r.body));
me = (await call(p, 'GET', '/api/me')).body; ok('both businesses on the domain are active for the owner', me.businesses.filter(x => x.domain === 'lumenstudio.test').length === 2, me.businesses.map(x => x.domain + ':' + x.role).join(', '));
ok('DEL-6 after the restore the other account sees the waiting proposal again', (await ws(solo.page, SOLO)).backlinks.inbound.length === 1);
// second wipe victim: Lumenstudio went through real onboarding (crawl pages, AI visibility, Daily Brief, logo, a published article)
await sleep(3000);
r = await call(p, 'POST', `/api/b/${Bz}/delete`, { domain: 'Lumenstudio.Test' }); console.log('delete again', r.status, r.body?.data?.deletedAt);
await pool.query("update businesses set deleted_at = deleted_at - interval '169 hours', purge_at = purge_at - interval '169 hours' where id=$1", [Bz]);
const before = { files: files(), mentions: await mentions(pool, Bz), world: await world(pool, { New: NEW, Solo: SOLO, P }), kept: (await pool.query("select a.data->'img'->>'url' u from articles a join calendar_entries e on e.id=a.entry_id where a.business_id=$1 and e.status='published'", [Bz])).rows.map(r => r.u.replace('/api/files/', '')), NEW };
fs.writeFileSync(new URL('./wipe-before3.json', import.meta.url).pathname, JSON.stringify(before, null, 1));
console.log('mentions of the second victim before:', JSON.stringify(before.mentions)); console.log('its files:', Object.keys(before.files).filter(k => k.startsWith(Bz) && !k.endsWith('.type')).map(k => k.replace(Bz + '/', '')).join(', '), '| expected kept:', before.kept.map(k => k.replace(Bz + '/', '')).join(', '));
await pool.query("insert into jobs (kind, payload, ref, status, run_at, max_attempts) values ('business.purge', '{}', 'qa-second-wipe', 'queued', now(), 1)");
for (let i = 0; i < 40; i++) { if (!(await pool.query('select 1 from businesses where id=$1', [Bz])).rows.length) break; await sleep(1500); }
const job = (await pool.query("select status, result from jobs where ref='qa-second-wipe'")).rows[0]; console.log('job:', JSON.stringify(job));
const m = await mentions(pool, Bz); ok('PUR-2 second wipe (real onboarding data): no row in any table mentions the id', Object.keys(m).length === 0 && job.result.wiped === 1, JSON.stringify(m));
const now = files(); const left = Object.keys(now).filter(k => k.startsWith(Bz + '/') && !k.endsWith('.type'));
ok('only the published cover is left under its prefix', JSON.stringify(left.sort()) === JSON.stringify(before.kept.sort()), left.map(k => k.replace(Bz + '/', '')).join(', '));
const changed = Object.keys(before.files).filter(k => !k.startsWith(Bz + '/') && now[k] !== before.files[k]); ok('no file outside its prefix changed (the newer business on the same domain included)', changed.length === 0, changed.join(',') || `${Object.keys(before.files).filter(k => k.startsWith(NEW)).length} files of the same-domain business intact`);
const nb = (await pool.query("select status, (select count(*) from calendar_entries where business_id=$1) e, (select count(*) from crawl_pages where business_id=$1) c, (select count(*) from members where business_id=$1) m from businesses where id=$1", [NEW])).rows[0];
ok('the newer business on the same domain is intact', nb.status === 'active' && Number(nb.e) === 30 && Number(nb.c) === 19 && Number(nb.m) === 1, JSON.stringify(nb));
me = (await call(p, 'GET', '/api/me')).body; ok('the owner keeps the account, the same-domain business and the Admin seat elsewhere', me.businesses.length === 2 && me.deleted.length === 0, me.businesses.map(x => x.domain + ':' + x.role).join(', '));
console.log('billing row:', JSON.stringify((await pool.query("select stripe_customer_id, status, comp from billing_accounts")).rows));
await b.close(); await pool.end();
