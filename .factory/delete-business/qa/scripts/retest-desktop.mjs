// Desktop unchanged: at 1280 px, lay each row out as fixed (f315d3db) and as it was before (date nowrap, ordinary spaces) in the same page, and compare every box.
import { chromium, call, db, BASE, SHOTS } from './lib.mjs';
const NEW = 'f02d9cd4-5790-489b-a35b-db92c54212e0', SOLO = '36b937ef-0f06-4768-bcc6-83645883932e'; const HERE = new URL('.', import.meta.url).pathname;
const pool = db(); const b = await chromium.launch();
const uid = (await pool.query("select id from users where email='dev@radar.local'")).rows[0].id;
const mk = async (name, domain, purge) => { const { rows: [x] } = await pool.query("insert into businesses (owner_id, domain, status, deleted_at, purge_at, profile) values ($1, $2, 'deleted', now(), $4, $3) returning id", [uid, domain, JSON.stringify({ domain, business: { name }, brand: {} }), purge]); await pool.query("insert into members (business_id, user_id, email, role, status) values ($1, $2, 'dev@radar.local', 'Owner', 'active')", [x.id, uid]); return x.id; };
const fx = [await mk('Northumberland and Westmorland Heritage Furniture Restoration Cooperative Ltd', 'northumberland-westmorland-heritage-furniture-restoration-cooperative.example.co.uk', '2026-11-26 03:32:00+00'), await mk('Lived', 'lived.co', '2026-11-25 14:05:00+00')];
const ctx = await b.newContext({ storageState: `${HERE}state-dev_radar_local.json`, viewport: { width: 1280, height: 900 }, timezoneId: 'America/New_York' }); const p = await ctx.newPage();
await p.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' }); console.log('delete', (await call(p, 'POST', `/api/b/${NEW}/delete`, { domain: 'lumenstudio.test' })).status); await call(p, 'POST', '/api/b/current', { id: SOLO });
for (const [path, name] of [['/settings?section=delete', 'Settings'], ['/restore', '/restore']]) {
  await p.goto(BASE + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  const out = await p.evaluate(() => {
    const boxes = () => [...document.querySelectorAll('li')].filter(li => li.querySelector('.dot-sep')).map(li => [li, li.querySelector('.small'), ...li.querySelectorAll('.dot-sep > span > span'), li.querySelector('button')].map(e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(v => Math.round(v * 100) / 100).join(','); }).join(' | '));
    const fixed = boxes(); const dates = [...document.querySelectorAll('.dot-sep > span > span:nth-child(2)')]; const text = dates.map(d => d.textContent);
    dates.forEach(d => { d.textContent = d.textContent.replace(/ /g, ' '); d.style.whiteSpace = 'nowrap'; });
    const before = boxes(); dates.forEach((d, i) => { d.textContent = text[i]; d.style.whiteSpace = ''; });
    return { fixed, before, text };
  });
  const same = out.fixed.every((x, i) => x === out.before[i]);
  console.log(`${same ? 'PASS' : 'FAIL'} ${name} @1280: every row lays out exactly as before the fix (${out.fixed.length} rows; row, name, domain, date and button boxes compared)`);
  if (!same) out.fixed.forEach((x, i) => { if (x !== out.before[i]) console.log('  fixed :', x, '\n  before:', out.before[i]); });
  console.log('  dates:', JSON.stringify(out.text.map(t => t.replace(/ /g, '⍽'))));
  console.log('  sideways scroll:', await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
  await p.screenshot({ path: `${SHOTS}/55-retest-desktop-1280-${name.replace(/\W/g, '') || 'x'}.png` });
}
console.log('restore', (await call(p, 'POST', '/api/b/restore', { id: NEW })).status);
await pool.query('delete from businesses where id = any($1)', [fx]);
console.log(JSON.stringify((await pool.query("select domain, status from businesses order by created_at")).rows));
await b.close(); await pool.end();
