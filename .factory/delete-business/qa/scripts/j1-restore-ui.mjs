import fs from 'node:fs';
import { chromium, session, act, call, ws, db, sleep, shot, text, toasts, A, Bz, BASE } from './lib.mjs';
import { snapshot } from './snap.mjs';
const plan = JSON.parse(fs.readFileSync(new URL('./plan.json', import.meta.url).pathname, 'utf8'));
const pool = db(); const b = await chromium.launch();
const ok = (name, pass, detail = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
const own = await session(b, 'dev@radar.local'); const p = own.page;
// what the delete left untouched
const otherNow = await snapshot(pool, Bz);
const diffO = Object.keys(plan.beforeOther).filter(k => JSON.stringify(plan.beforeOther[k]) !== JSON.stringify(otherNow[k]));
ok('DEL-6 the owner\'s other business is unchanged by the delete (every table, row for row)', diffO.every(k => ['jobs', 'events', 'notifications', 'ai_calls', 'businesses'].includes(k)), 'tables that differ: ' + (diffO.join(', ') || 'none') + ' (jobs/events/notifications/ai_calls are its own background work since the snapshot)');
ok('DEL-6 billing rows unchanged', plan.beforeBilling === (await pool.query("select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) h from billing_accounts t")).rows[0].h);
const during = await snapshot(pool, A);
const diffD = Object.keys(plan.before).filter(k => JSON.stringify(plan.before[k]) !== JSON.stringify(during[k]));
console.log('while deleted, tables of the business that differ from before:', diffD.map(k => `${k} ${JSON.stringify(plan.before[k])}→${JSON.stringify(during[k])}`).join(' ; '));
await p.goto(BASE + '/settings?section=delete', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
const st = await text(p);
ok('RES-1 Settings (other business open) shows Recently deleted with name, domain, wipe date and Restore', /Recently deleted/.test(st) && /Fieldnote/.test(st) && /fieldnote\.app/.test(st) && /Will be wiped on .+ at /.test(st), st.match(/Recently deleted[\s\S]{0,200}/)?.[0].replace(/\n/g, ' | '));
ok('the delete row above it is for the open business (Lumenstudio)', /Delete Lumenstudio/.test(st));
await shot(p, '07-settings-recently-deleted');
const btn = p.getByRole('button', { name: 'Restore Fieldnote' });
ok('Restore button is labelled "Restore Fieldnote"', (await btn.count()) === 1);
const posts = []; p.on('request', q => { if (q.method() === 'POST' && q.url().endsWith('/api/b/restore')) posts.push(1); });
await btn.focus();
await Promise.all([p.waitForURL(u => u.pathname === '/dashboard', { timeout: 30000 }), p.keyboard.press('Enter')]);
let tst = []; for (let i = 0; i < 30 && !tst.length; i++) { await p.waitForTimeout(200); tst = await toasts(p).catch(() => []); }
ok('RES-2 restore lands on /dashboard with "Fieldnote restored."', tst.some(t => t.trim() === 'Fieldnote restored.'), JSON.stringify(tst));
await p.waitForTimeout(1500);
const side = p.locator('aside, nav').locator('button').filter({ hasText: /fieldnote\.app|lumenstudio\.test/ }).first();
ok('RES-2 the restored business opens', /fieldnote\.app/.test(await side.innerText()));
await side.click(); await p.waitForTimeout(400); const sw = await p.evaluate(() => document.body.innerText);
ok('RES-2 both businesses are in the switcher again', /Lumenstudio/.test(sw) && /Fieldnote/.test(sw)); await shot(p, '08-after-restore-switcher'); await p.keyboard.press('Escape');
const row = (await pool.query('select status, deleted_at, purge_at, rev from businesses where id=$1', [A])).rows[0];
ok('RES-2 row is active with no timestamps', row.status === 'active' && row.deleted_at === null && row.purge_at === null, JSON.stringify(row));
const after = await snapshot(pool, A);
const diff = Object.keys(plan.before).filter(k => JSON.stringify(plan.before[k]) !== JSON.stringify(after[k]));
console.log('after restore, tables that differ from before the delete:', diff.map(k => `${k} ${JSON.stringify(plan.before[k])}→${JSON.stringify(after[k])}`).join(' ; '));
ok('RES-2 content, settings, connections, tokens, team and roles are the same rows as before the delete', diff.every(k => ['jobs', 'events', 'lifecycle_emails', 'businesses', 'notifications', 'engagement_events'].includes(k)), 'identical: ' + Object.keys(plan.before).filter(k => !diff.includes(k) && plan.before[k].n).map(k => `${k}(${plan.before[k].n})`).join(', '));
// the pages
const w = await ws(page(), A); function page() { return p; }
ok('RES-2 workspace: articles, calendar, team, connections, social accounts are back', w.calendar.entries.length === 30 && w.team.length === 3 && w.blog.conns.length === 1 && w.social.accounts.length === 3 && Object.keys(w.articles).length >= 4, JSON.stringify({ entries: w.calendar.entries.length, team: w.team.map(t => t.role + ':' + t.status), conns: w.blog.conns.length, accounts: w.social.accounts.length, articles: Object.keys(w.articles).length, blogTime: w.blog.time }));
for (const [path, re, name] of [['/calendar', /Freelance invoice template/, '09-restored-calendar'], ['/settings?section=team', /admin\.qa@radar\.local[\s\S]*Admin/, '10-restored-team'], ['/settings?section=publishing', /WordPress|fieldnote\.app/, '11-restored-publishing'], ['/social', /Three signs|calendar based/i, '12-restored-social']]) {
  await p.goto(BASE + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500); const t = await text(p);
  ok(`RES-2 ${path} shows the restored data`, re.test(t), t.slice(0, 0)); await shot(p, name);
}
// the Admin gets it back too
const adm = await session(b, 'admin.qa@radar.local'); await adm.page.goto(BASE + '/dashboard', { waitUntil: 'networkidle' }); await adm.page.waitForTimeout(1500);
ok('RES-2 the Admin has the business back, as Admin', /Fieldnote/.test(await text(adm.page)) && (await ws(adm.page, A)).role === 'Admin', adm.page.url());
ok('exactly one restore request', posts.length === 1, String(posts.length));
console.log('errors', JSON.stringify(p.__errors));
// RES-4: restoring again is harmless
const again = await call(p, 'POST', '/api/b/restore', { id: A }); ok('RES-4 restoring an already restored business answers success and changes nothing', again.status === 200 && (await pool.query('select rev from businesses where id=$1', [A])).rows[0].rev === row.rev, `${again.status} ${JSON.stringify(again.body)}`);
console.log('restored at', new Date().toISOString());
await b.close(); await pool.end();
