import { chromium, session, act, call, ws, db, sleep, shot, text, toasts, Bz, BASE } from './lib.mjs';
const SOLO = '36b937ef-0f06-4768-bcc6-83645883932e';
const pool = db(); const b = await chromium.launch(); const ok = (name, pass, detail = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
// the solo owner invites the developer account as Admin of their business; the developer accepts while signed in
const solo = await session(b, 'solo.qa@radar.local', { password: process.env.QA_PW2 }); await solo.page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
let r = await act(solo.page, SOLO, 'team.invite', { email: 'dev@radar.local', role: 'Admin' }); console.log('invite dev as Admin of Solobakery', r.status, r.body?.error || '');
const inv = (await pool.query("select substring(text from 'http[^ \\n]+') l from outbox_emails where \"to\"='dev@radar.local' and subject like '%invited%' order by created_at desc limit 1")).rows[0].l;
const own = await session(b, 'dev@radar.local', { dark: true }); const p = own.page;
await p.goto(inv, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
ok('team invite accepted by a signed-in user: Solobakery opens', /Solobakery/.test(await text(p)));
await call(p, 'POST', '/api/b/current', { id: Bz });
// a proposal in the other account that names Lumenstudio and waits for a decision (DEL-6: hidden while deleted)
await pool.query("insert into proposals (business_id, direction, partner_business_id, data) values ($1, 'in', $2, $3)", [SOLO, Bz, JSON.stringify({ partner: 'Lumenstudio', domain: 'lumenstudio.test', anchor: 'web design', target: 'https://lumenstudio.test/', from: 'https://solobakery.test/blog/b', before: 'See ', after: ' for more.' })]);
const inbound = async () => (await ws(solo.page, SOLO)).backlinks.inbound.length;
const inBefore = await inbound();
// the dialog: dark desktop, busy state, a failed request, two presses of Enter
await p.goto(BASE + '/settings?section=delete', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
ok('dark appearance is applied', /oklch\(0\.1|rgb\((1?\d|2\d), /.test(await p.evaluate(() => getComputedStyle(document.body).backgroundColor)), await p.evaluate(() => getComputedStyle(document.body).backgroundColor));
await p.locator('main, .page').getByRole('button', { name: 'Delete business' }).last().click(); await p.waitForTimeout(400);
const dlg = p.getByRole('dialog'); await shot(p, '40-desktop-dark-dialog');
let n = 0; let mode = 'fail';
await p.route(`**/api/b/${Bz}/delete`, async route => { n++; if (mode === 'fail') { await sleep(1200); return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Radar couldn’t finish this. Try again.', code: 'internal' }) }); } if (mode === 'mismatch') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'That doesn’t match. Type the business’s domain to confirm.', code: 'domain_mismatch' }) }); return route.continue(); });
await p.keyboard.type('lumenstudio.test'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter'); await p.waitForTimeout(350);
const busy = await p.evaluate(() => { const d = document.querySelector('[role=dialog]'); const bs = [...d.querySelectorAll('button')]; return { ariaBusy: d.querySelector('form')?.getAttribute('aria-busy'), readOnly: d.querySelector('input').readOnly, disabled: bs.map(x => x.innerText.trim() + ':' + x.disabled) }; });
await p.keyboard.press('Escape'); await p.waitForTimeout(200);
ok('busy state: field read-only, both buttons disabled, Esc does not close it while the request runs', busy.ariaBusy === 'true' && busy.readOnly && busy.disabled.every(x => x.endsWith('true')) && (await dlg.count()) === 1, JSON.stringify(busy)); await shot(p, '41-desktop-dark-dialog-busy');
await p.waitForTimeout(1500);
ok('Enter twice sends one request', n === 1, String(n));
const alertText = await dlg.locator('[role=alert]').innerText().catch(() => '');
ok('a failed delete keeps the dialog open and shows the server\'s message', alertText === 'Radar couldn’t finish this. Try again.' && (await dlg.getByRole('button', { name: 'Delete business' }).isEnabled()), alertText); await shot(p, '42-desktop-dark-dialog-error');
ok('nothing was deleted by the failed request', (await pool.query('select status from businesses where id=$1', [Bz])).rows[0].status === 'active');
mode = 'mismatch'; await p.keyboard.press('Enter'); await p.waitForTimeout(600);
const fe = await p.evaluate(() => { const d = document.querySelector('[role=dialog]'); const i = d.querySelector('input'); const e = i.getAttribute('aria-describedby'); return { invalid: i.getAttribute('aria-invalid'), msg: e ? document.getElementById(e)?.innerText : null, role: e ? document.getElementById(e)?.getAttribute('role') : null }; });
ok('a server "does not match" answer shows under the field, tied to it for assistive tech', fe.invalid === 'true' && /doesn.t match/.test(fe.msg || '') && fe.role === 'alert', JSON.stringify(fe));
mode = 'real'; await Promise.all([p.waitForURL(u => u.pathname === '/dashboard', { timeout: 30000 }), p.keyboard.press('Enter')]);
let tst = []; for (let i = 0; i < 30 && !tst.length; i++) { await p.waitForTimeout(200); tst = await toasts(p).catch(() => []); } await p.waitForTimeout(1500);
ok('the owner of a deleted business who is Admin elsewhere lands on that business', tst.some(t => /^Lumenstudio deleted\./.test(t)) && /Solobakery/.test(await text(p)), JSON.stringify(tst));
// Admin of the open business, with a deleted business of their own
await p.goto(BASE + '/settings?section=delete', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500); const st = await text(p);
ok('RES-1 an Admin with their own deleted business finds Recently deleted in Settings, and no delete row for the business they do not own', /Recently deleted/.test(st) && /Lumenstudio/.test(st) && !/Delete Solobakery/.test(st) && !(await p.locator('main, .page').getByRole('button', { name: 'Delete business' }).count()), st.match(/Recently deleted[\s\S]{0,120}/)?.[0].replace(/\n/g, ' | '));
await shot(p, '43-dark-admin-with-own-deleted-business');
r = await call(p, 'POST', `/api/b/${SOLO}/delete`, { domain: 'solobakery.test' }); ok('DEL-1 that Admin cannot delete the business they have open', r.status === 403, String(r.status));
// links in mail sent before the delete
const hop = await p.request.get(`${BASE}/api/b/current?id=${Bz}&next=%2Fcalendar`, { maxRedirects: 0 });
ok('DEL-4 an old mail link to the deleted business redirects to the dashboard, not an error page', hop.status() === 303 && new URL(hop.headers().location).pathname === '/dashboard', `${hop.status()} → ${hop.headers().location}`);
await p.goto(BASE + '/email-preferences', { waitUntil: 'networkidle' }); await p.waitForTimeout(800); const ep = await text(p);
ok('DEL-4 account email settings do not list the deleted business', !/lumenstudio\.test/.test(ep) && /solobakery\.test/.test(ep), (ep.match(/[a-z]+\.test/g) || []).join(','));
ok('DEL-6 the other account no longer sees the waiting proposal that names the deleted business', inBefore === 1 && (await inbound()) === 0, `inbound ${inBefore} → ${await inbound()}`);
console.log('errors', JSON.stringify(p.__errors));
await b.close(); await pool.end();
