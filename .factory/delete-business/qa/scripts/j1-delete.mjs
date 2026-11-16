import fs from 'node:fs';
import { chromium, session, act, call, ws, db, sleep, shot, text, toasts, A, Bz, BASE } from './lib.mjs';
const plan = JSON.parse(fs.readFileSync(new URL('./plan.json', import.meta.url).pathname, 'utf8'));
const pool = db(); const b = await chromium.launch();
const R = []; const ok = (name, pass, detail = '') => { R.push({ name, pass: !!pass, detail }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };
const RAND = '0a0a0a0a-1111-4222-8333-444444444444';

// ── Admin, before the delete
const adm = await session(b, 'admin.qa@radar.local'); const ap = adm.page;
await ap.goto(BASE + '/settings?section=delete', { waitUntil: 'networkidle' }); await ap.waitForTimeout(1500);
const adminSettings = await text(ap);
ok('DEL-1 Admin: Settings does not list "Delete business"', !/Delete business/.test(adminSettings), adminSettings.match(/Workspace[\s\S]{0,60}/)?.[0].replace(/\n/g, ' '));
await shot(ap, '01-admin-settings-no-delete');
let r = await call(ap, 'POST', `/api/b/${A}/delete`, { domain: 'fieldnote.app' });
ok('DEL-1 Admin: direct POST delete with the right domain is refused', r.status === 403, `${r.status} ${JSON.stringify(r.body)}`);
ok('DEL-1 business still active after the Admin attempt', (await pool.query('select status from businesses where id=$1', [A])).rows[0].status === 'active');
await ap.goto(BASE + '/calendar', { waitUntil: 'networkidle' }); await ap.waitForTimeout(1500);
ok('Admin has Fieldnote open on /calendar', /Fieldnote/.test(await text(ap)) && ap.url().endsWith('/calendar'));

// ── Stranger, before the delete (to compare answers later)
const str = await session(b, 'stranger.qa@radar.local'); const sp = str.page; await sp.goto(BASE + '/restore', { waitUntil: 'networkidle' });
r = await call(sp, 'POST', `/api/b/${A}/delete`, { domain: 'fieldnote.app' });
ok('DEL-1 stranger: delete answers plain not found', r.status === 404 && r.body?.code !== 'business_deleted', `${r.status} ${JSON.stringify(r.body)}`);

// ── Owner
const own = await session(b, 'dev@radar.local'); const p = own.page;
const posts = []; p.on('request', q => { if (q.method() === 'POST' && q.url().includes('/delete')) posts.push(q.url()); });
await p.goto(BASE + '/dashboard', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
// make Fieldnote the open business through the switcher
const side = () => p.locator('aside, nav').locator('button').filter({ hasText: /fieldnote\.app|lumenstudio\.test/ }).first();
if (!/fieldnote\.app/.test(await side().innerText())) { await side().click(); await p.waitForTimeout(400); await p.getByText('Fieldnote', { exact: true }).last().click(); await p.waitForTimeout(2500); }
ok('switcher: Fieldnote is the open business', /fieldnote\.app/.test(await side().innerText()));
await p.goto(BASE + '/settings?section=delete', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
ok('DEL-1 Owner: Settings lists "Delete business" with the row copy', /Delete Fieldnote/.test(await text(p)) && /keeps it for 7 days/.test(await text(p)));
await shot(p, '02-owner-settings-delete-row');
const trigger = p.locator('main, .page').getByRole('button', { name: 'Delete business' }).last();
await trigger.click(); await p.waitForTimeout(500);
const dlg = p.getByRole('dialog');
ok('dialog opens, named "Delete Fieldnote?"', (await dlg.getAttribute('aria-label')) === 'Delete Fieldnote?' && (await dlg.getAttribute('aria-modal')) === 'true');
const dtext = await dlg.innerText(); console.log('DIALOG:', dtext.replace(/\n+/g, ' | '));
ok('dialog copy: stops now, 7 days until a date, subscription, published posts, type-domain field', /stops writing, publishing, posting and scanning/.test(dtext) && /keeps it for 7 days, until .+, then wipes it for good/.test(dtext) && /subscription is not affected/.test(dtext) && /Posts already published stay where they are/.test(dtext) && /Type fieldnote\.app to confirm/.test(dtext));
const focusInfo = () => p.evaluate(() => { const a = document.activeElement; const d = document.querySelector('[role=dialog]'); return { tag: a?.tagName, inDialog: !!(d && a && d.contains(a)), label: a?.id ? document.querySelector(`label[for="${a.id}"]`)?.innerText : null, text: a?.innerText || '' }; });
let f = await focusInfo();
ok('keyboard: focus moves into the dialog, onto the labelled field', f.tag === 'INPUT' && f.inDialog && /Type fieldnote\.app to confirm/.test(f.label || ''), JSON.stringify(f));
const submit = dlg.getByRole('button', { name: 'Delete business' });
ok('Delete is disabled while the field is empty', await submit.isDisabled());
await p.keyboard.type('fieldnote.com');
ok('DEL-2 wrong domain: Delete stays disabled', await submit.isDisabled());
await p.keyboard.press('Enter'); await p.waitForTimeout(700);
ok('DEL-2 wrong domain: Enter does nothing (dialog open, no request)', (await dlg.count()) === 1 && posts.length === 0);
await shot(p, '03-dialog-wrong-domain');
let inside = true; const stops = [];
for (let i = 0; i < 6; i++) { await p.keyboard.press('Tab'); f = await focusInfo(); stops.push(f.tag + ':' + (f.text || f.label || '').slice(0, 16)); inside = inside && f.inDialog; }
for (let i = 0; i < 3; i++) { await p.keyboard.press('Shift+Tab'); f = await focusInfo(); inside = inside && f.inDialog; }
ok('keyboard: Tab and Shift+Tab stay inside the dialog', inside, stops.join(' → '));
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
f = await focusInfo();
ok('keyboard: Esc closes the dialog and focus returns to the Delete business button', (await dlg.count()) === 0 && f.tag === 'BUTTON' && /Delete business/.test(f.text), JSON.stringify(f));
ok('nothing was deleted by the cancelled dialog', (await pool.query('select status from businesses where id=$1', [A])).rows[0].status === 'active' && posts.length === 0);
// server-side domain check, as the owner
r = await call(p, 'POST', `/api/b/${A}/delete`, { domain: 'fieldnote.com' });
ok('DEL-2 server refuses a wrong domain', r.status === 400 && r.body?.code === 'domain_mismatch', `${r.status} ${JSON.stringify(r.body)}`);
r = await call(p, 'POST', `/api/b/${A}/delete`, { domain: 'www.fieldnote.app' });
ok('DEL-2 server refuses "www." + domain (no stripping)', r.status === 400 && r.body?.code === 'domain_mismatch', `${r.status}`);
r = await call(p, 'POST', `/api/b/${A}/delete`, {});
ok('DEL-2 server refuses a missing domain', r.status === 400, `${r.status} ${JSON.stringify(r.body)?.slice(0, 120)}`);
ok('still active after refused requests', (await pool.query('select status from businesses where id=$1', [A])).rows[0].status === 'active');
// reopen by keyboard, type the domain with spaces and capitals
await p.keyboard.press('Enter'); await p.waitForTimeout(500);
ok('keyboard: Enter on the button opens the dialog again', (await dlg.count()) === 1);
await p.keyboard.type('  FieldNote.APP  ');
ok('DEL-2 right domain with spaces and capitals enables Delete', await submit.isEnabled());
// a job that is running when the delete lands
const running = await act(p, A, 'article.draft', { entryId: plan.E.E4 }); console.log('article.draft E4 started', running.status, JSON.stringify(running.body?.data));
const before = (await pool.query('select rev from businesses where id=$1', [A])).rows[0].rev;
const t0 = Date.now();
await Promise.all([p.waitForURL(u => u.pathname === '/dashboard', { timeout: 30000 }), p.keyboard.press('Enter')]);
let tst = []; for (let i = 0; i < 30 && !tst.length; i++) { await p.waitForTimeout(200); tst = await toasts(p).catch(() => []); }
ok('DEL-3 owner lands on /dashboard with the toast', tst.some(t => /^Fieldnote deleted\. You can restore it until .+\.$/.test(t.trim())), JSON.stringify(tst));
await p.waitForTimeout(1500); await shot(p, '04-after-delete-lands-on-other-business');
ok('DEL-3 exactly one delete request was sent', posts.length === 1, String(posts.length));
ok('DEL-3 the open business is now Lumenstudio', /lumenstudio\.test/.test(await side().innerText()), (await side().innerText()).replace(/\n/g, ' '));
await side().click(); await p.waitForTimeout(500);
const swText = await text(p); await shot(p, '05-switcher-without-deleted');
ok('DEL-4 the deleted business is gone from the switcher', !/Fieldnote/.test(swText));
await p.keyboard.press('Escape');
console.log('owner page errors', JSON.stringify(p.__errors));
// ── Admin's open tab
let moved = null; for (let i = 0; i < 40; i++) { if (!ap.url().endsWith('/calendar')) { moved = Date.now() - t0; break; } await ap.waitForTimeout(500); }
await ap.waitForLoadState('domcontentloaded').catch(() => {}); let at = []; for (let i = 0; i < 30 && !at.length; i++) { await ap.waitForTimeout(200); at = await toasts(ap).catch(() => []); }
await ap.waitForTimeout(1200); await shot(ap, '06-admin-tab-moved-out');
const atext = await text(ap);
ok('DEL-4 Admin\'s open tab leaves the deleted business by itself', moved != null, `after ${moved} ms → ${ap.url()}`);
ok('DEL-4 Admin sees "That business was deleted." and no error screen', at.some(t => /That business was deleted\./.test(t)) && !/error|went wrong|not found|404/i.test(atext.slice(0, 600)), JSON.stringify(at) + ' | ' + atext.slice(0, 160).replace(/\n/g, ' '));
console.log('admin page errors', JSON.stringify(ap.__errors));
// ── Database
const row = (await pool.query("select status, rev, deleted_at, purge_at, extract(epoch from (purge_at - deleted_at)) / 3600 as hours, purge_at - deleted_at = interval '168 hours' as exact from businesses where id=$1", [A])).rows[0];
ok('DEL-3 marked deleted; purge_at is exactly 168 hours after deleted_at; rev bumped', row.status === 'deleted' && row.exact === true && Number(row.hours) === 168 && row.rev > before, JSON.stringify(row));
const q = (await pool.query("select kind, ref, status, result from jobs where business_id=$1 and (ref='qa-future-queued' or (kind='article.draft' and ref=$2)) order by created_at desc", [A, plan.E.E4])).rows;
console.log('jobs at delete:', JSON.stringify(q));
ok('DEL-5 the queued job was closed as skipped', q.find(j => j.ref === 'qa-future-queued')?.status === 'done' && q.find(j => j.ref === 'qa-future-queued')?.result?.skipped === 'deleted');
// ── Direct requests
const routes = [['GET', `/api/b/${A}/workspace`], ['POST', `/api/b/${A}/act`, { action: 'article.get', input: { entryId: plan.E.E1 } }], ['GET', `/api/b/${A}/events`], ['GET', `/api/b/${A}/media?url=` + encodeURIComponent(`/api/files/${A}/hero/x.png`)], ['POST', `/api/b/${A}/support`, { message: 'hello' }], ['POST', `/api/b/${A}/delete`, { domain: 'fieldnote.app' }], ['POST', '/api/b/current', { id: A }]];
for (const [who, pg] of [['owner', p], ['admin', ap]]) {
  const out = []; let all = true;
  for (const [m, u, body] of routes) { const x = await call(pg, m, u, body); out.push(`${u.replace(A, 'A').split('?')[0].replace('/api/b/', '')}=${x.status}/${x.body?.code}`); all = all && x.status === 404 && x.body?.code === 'business_deleted' && x.body?.error === 'Business wasn’t found.'; }
  ok(`DEL-4 ${who}: workspace, act, events, media, support, delete, current all answer 404 business_deleted`, all, out.join(' '));
}
{ const out = []; let same = true;
  for (const [m, u, body] of [...routes, ['POST', '/api/b/restore', { id: A }]]) {
    const x = await call(sp, m, u, body); const y = await call(sp, m, u.replaceAll(A, RAND), body && JSON.parse(JSON.stringify(body).replaceAll(A, RAND)));
    out.push(`${u.replace(A, 'A').split('?')[0].replace('/api/b/', '')}=${x.status}/${x.body?.code}`); same = same && x.status === y.status && JSON.stringify(x.body) === JSON.stringify(y.body) && x.body?.code !== 'business_deleted';
  }
  ok('DEL-4 stranger: every answer is identical to a business id that never existed', same, out.join(' ')); }
r = await call(ap, 'POST', '/api/b/restore', { id: A });
ok('RES-3 Admin cannot restore (same answer as no such business)', r.status === 404 && r.body?.code === 'restore_not_found', `${r.status} ${JSON.stringify(r.body)}`);
ok('still deleted after the Admin restore attempt', (await pool.query('select status from businesses where id=$1', [A])).rows[0].status === 'deleted');
// ── me
const me = (await call(p, 'GET', '/api/me')).body; const meA = (await call(ap, 'GET', '/api/me')).body; const meS = (await call(sp, 'GET', '/api/me')).body;
ok('DEL-4 owner me: not in businesses, in deleted; current is Lumenstudio', !me.businesses.some(x => x.id === A) && me.deleted.length === 1 && me.deleted[0].id === A && me.currentId === Bz, JSON.stringify({ b: me.businesses.map(x => x.name), d: me.deleted.map(x => [x.name, x.purgeAt]), cur: me.currentId }));
ok('DEL-4 admin me: not in businesses, deleted is empty', !meA.businesses.some(x => x.id === A) && meA.deleted.length === 0, JSON.stringify({ b: meA.businesses.length, d: meA.deleted.length }));
ok('stranger me: nothing about it', meS.businesses.length === 0 && meS.deleted.length === 0);
// file url stays public during the window (decision A)
const cover = (await pool.query("select data->'img'->>'url' u from articles where entry_id=$1", [plan.E.E1])).rows[0].u;
r = await p.request.get(BASE + cover); ok('decision A: the published cover is still served during the window', r.status() === 200, cover.replace(A, 'A') + ' → ' + r.status());
// ── invite link to the deleted business
const inv = (await pool.query("select substring(text from 'http[^ \\n]+') l from outbox_emails where \"to\"='pending.qa@radar.local'")).rows[0].l;
const anon = await b.newContext(); const ip = await anon.newPage(); await ip.goto(inv, { waitUntil: 'networkidle' }); await ip.waitForTimeout(800);
const itext = await text(ip); await ip.screenshot({ path: new URL('../', import.meta.url).pathname + 'x.png' }).catch(() => {});
ok('DEL-8 an invite link to the deleted business is an invalid invite', /invalid|no longer|isn.t valid|expired|not valid/i.test(itext) && !/Fieldnote/.test(itext), ip.url().replace(/invites\/.*/, 'invites/…') + ' | ' + itext.slice(0, 200).replace(/\n/g, ' '));
// ── jobs enqueued after the delete must never run
await pool.query("insert into jobs (kind, payload, business_id, ref, status, run_at, max_attempts) values ('brief.scan', '{}', $1, 'qa-after-delete-scan', 'queued', now(), 1), ('social.send', $2, $1, 'qa-after-delete-send', 'queued', now(), 1), ('publish.entry', $3, $1, 'qa-after-delete-publish', 'queued', now(), 1)", [A, JSON.stringify({ sid: `s:${plan.packs.auto}:x` }), JSON.stringify({ entryId: plan.E.E2 })]);
fs.writeFileSync(new URL('./j1-delete.result.json', import.meta.url).pathname, JSON.stringify({ at: new Date().toISOString(), deletedAt: row.deleted_at, purgeAt: row.purge_at, R }, null, 1));
console.log(`\n${R.filter(x => x.pass).length} passed, ${R.filter(x => !x.pass).length} failed; now ${new Date().toISOString()}`);
await b.close(); await pool.end();
