import { chromium, session, act, call, ws, db, sleep, shot, text, toasts, A, Bz, BASE } from './lib.mjs';
const pool = db(); const b = await chromium.launch();
const ok = (name, pass, detail = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
const own = await session(b, 'dev@radar.local'); const p = own.page;
const adm = await session(b, 'admin.qa@radar.local'); const ap = adm.page;
await p.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' }); await call(p, 'POST', '/api/b/current', { id: A });
// what the owner sees after the restore
await p.goto(BASE + '/social', { waitUntil: 'networkidle' }); await p.waitForTimeout(2000);
let t = await text(p); ok('RES-2 UI: held-back posts say they could not go out on time, with Try again', /couldn.t go out on time/i.test(t) && /Try again/i.test(t), (t.match(/.{0,60}couldn.t go out on time.{0,80}/i) || [''])[0].replace(/\n/g, ' '));
await shot(p, '13-restored-social-held-back', { full: true });
await p.goto(BASE + '/calendar', { waitUntil: 'networkidle' }); await p.waitForTimeout(2000); await shot(p, '14-restored-calendar-review');
let w = await ws(p, A);
ok('RES-2 UI data: overdue scheduled article is in Review', w.calendar.entries.find(e => e.id === 'e_UfAzPEXq').status === 'review');
// background work resumes for the restored business
const hm = d => new Intl.DateTimeFormat('en-GB', { timeZone: w.tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
const x = w.social.accounts.find(a => a.ch === 'x');
let r = await act(p, A, 'social.schedule', { sid: `s:auto-${A}-2026-11-16:x`, date: w.today, time: hm(new Date(Date.now() + 90e3)), acctId: x.id }); console.log('reschedule held-back post', r.status, r.body?.error || r.body?.data?.pub?.status);
r = await act(p, A, 'article.approve', { entryId: 'e_UfAzPEXq' }); console.log('re-approve the held-back article', r.status, r.body?.error || JSON.stringify(r.body?.data));
// event stream: a change by the owner shows in the Admin's open tab
await ap.goto(BASE + '/settings?section=team', { waitUntil: 'networkidle' }); await ap.waitForTimeout(2000);
ok('Admin has the restored business open (Team section)', /pending\.qa@radar\.local/.test(await text(ap)));
r = await act(p, A, 'team.invite', { email: 'third.qa@radar.local', role: 'Viewer' }); console.log('owner invites a member', r.status, r.body?.error || '');
let seen = null; const t0 = Date.now(); for (let i = 0; i < 40; i++) { if (/third\.qa@radar\.local/.test(await text(ap))) { seen = Date.now() - t0; break; } await ap.waitForTimeout(500); }
ok('event stream: the owner\'s change appears in the Admin\'s tab without a reload', seen != null, `after ${seen} ms`); await shot(ap, '15-event-stream-admin-sees-invite');
// settings sections
const errs0 = p.__errors.length; const bad = [];
for (const s of ['gsc', 'publishing', 'social', 'autopilot', 'writing', 'ai', 'calendar', 'team', 'account', 'billing', 'emails', 'delete', 'feedback']) {
  await p.goto(BASE + '/settings?section=' + s, { waitUntil: 'networkidle' }); await p.waitForTimeout(900); const tt = await text(p);
  if (/Application error|Something went wrong|Unhandled/i.test(tt) || tt.length < 300) bad.push(s);
}
ok('Settings: all 13 sections render for the Owner', !bad.length && p.__errors.length === errs0, 'bad: ' + (bad.join(',') || 'none') + ' | console errors: ' + JSON.stringify(p.__errors.slice(errs0)));
await p.goto(BASE + '/settings?section=emails', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
// privacy page
const anon = await (await b.newContext()).newPage(); await anon.goto(BASE + '/privacy', { waitUntil: 'networkidle' }); const pv = await text(anon);
ok('E-3 privacy page: 30-day sentence plus the published-images sentence', /delete the associated data[\s\S]*within 30 days/.test(pv) && /Images inside articles Radar already published stay available so those articles keep working\./.test(pv), (pv.match(/When you delete a business[^.]*\.[^.]*\./) || [''])[0]);
// wait for the resumed work
for (let i = 0; i < 36; i++) {
  await sleep(5000);
  const e = (await pool.query("select status, published_url from calendar_entries where id='e_UfAzPEXq'")).rows[0]; const pb = (await pool.query("select status, remote_url from social_pubs where business_id=$1 and sid=$2", [A, `s:auto-${A}-2026-11-16:x`])).rows[0];
  if (e.status === 'published' && pb.status === 'posted') { ok('RES-2 background work resumes after a restore: the re-approved article publishes and the rescheduled post goes out', true, `${e.published_url} | ${pb.remote_url}`); break; }
  if (i === 35) ok('RES-2 background work resumes after a restore', false, JSON.stringify({ e, pb }));
}
console.log('owner errors', JSON.stringify(p.__errors), 'admin errors', JSON.stringify(ap.__errors));
await b.close(); await pool.end();
