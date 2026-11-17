// Retest of D1 and D2 on f315d3db: Recently deleted in Settings and on /restore at 320, 360, 375 and 1280 px.
import fs from 'node:fs';
import { chromium, call, db, toasts, text, BASE, SHOTS } from './lib.mjs';
const SOLO = '36b937ef-0f06-4768-bcc6-83645883932e', NEW = 'f02d9cd4-5790-489b-a35b-db92c54212e0';
const HERE = new URL('.', import.meta.url).pathname;
const pool = db(); const b = await chromium.launch(); let fails = 0;
const ok = (name, pass, detail = '') => { if (!pass) fails++; console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };
const open = async (who, w, o = {}) => { const ctx = await b.newContext({ storageState: `${HERE}state-${who.replace(/[^a-z0-9]/gi, '_')}.json`, viewport: { width: w, height: w < 500 ? 780 : 900 }, timezoneId: 'America/New_York', colorScheme: o.dark ? 'dark' : 'light', ...(w < 500 ? { hasTouch: true, isMobile: true } : {}) }); const page = await ctx.newPage(); page.__errors = []; page.on('pageerror', e => page.__errors.push(e.message)); return page; };
// fixtures: one real business deleted through the app per owner, plus a deleted fixture with a long name and domain and a late-evening wipe time
const uid = async e => (await pool.query('select id from users where email=$1', [e])).rows[0].id;
const fixture = async (owner, name, domain) => { const { rows: [x] } = await pool.query("insert into businesses (owner_id, domain, status, deleted_at, purge_at, profile) values ($1, $2, 'deleted', now(), '2026-11-26 03:32:00+00', $3) returning id", [await uid(owner), domain, JSON.stringify({ domain, business: { name }, brand: { primary: '#1F4D3A', secondary: '#F2B544' } })]); await pool.query("insert into members (business_id, user_id, email, role, status) values ($1, $2, $3, 'Owner', 'active')", [x.id, await uid(owner), owner]); return x.id; };
await pool.query("delete from businesses where domain like '%heritage-furniture%' or domain like '%kapitaen%'");
const fx1 = await fixture('dev@radar.local', 'Northumberland and Westmorland Heritage Furniture Restoration Cooperative Ltd', 'northumberland-westmorland-heritage-furniture-restoration-cooperative.example.co.uk');
const fx2 = await fixture('solo.qa@radar.local', 'Donaudampfschifffahrtsgesellschaftskapitänsmützenfabrik', 'donaudampfschifffahrtsgesellschaftskapitaensmuetzenfabrik-international.example.com');
{ const p = await open('dev@radar.local', 1280); await p.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' }); const d = await call(p, 'POST', `/api/b/${NEW}/delete`, { domain: 'lumenstudio.test' }); console.log('dev deletes Lumenstudio through the app:', d.status, d.body?.data?.purgeAt, d.body?.code || ''); await p.context().close(); }
{ const p = await open('solo.qa@radar.local', 1280); await p.goto(BASE + '/restore', { waitUntil: 'domcontentloaded' }); await p.context().close(); }

/** Everything measurable about the rows of "Recently deleted" on the page. */
const measure = p => p.evaluate(() => {
  const iw = window.innerWidth, sw = document.documentElement.scrollWidth; const R = e => e.getBoundingClientRect();
  const lineOf = (node, from, to) => { const r = document.createRange(); r.setStart(node, from); r.setEnd(node, to); return [...r.getClientRects()]; };
  const rows = [...document.querySelectorAll('li')].filter(li => [...li.querySelectorAll('button')].some(x => (x.getAttribute('aria-label') || '').startsWith('Restore '))).map(li => {
    const btn = li.querySelector('button'); const br = R(btn); const hit = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
    const dot = li.querySelector('.dot-sep'); const facts = [...dot.querySelectorAll(':scope > span > span')]; const dateEl = facts[1]; const domEl = facts[0]; const nameEl = li.querySelector('.small');
    const tn = dateEl.firstChild; const t = tn.textContent; const at = t.lastIndexOf(' at');
    // the lines the date is laid out on: one rect per line box for the whole text, and for the "at 10:32 PM" tail
    const tops = rs => [...new Set(rs.map(r => Math.round(r.top)))]; const whole = lineOf(tn, 0, t.length), tail = lineOf(tn, at + 1, t.length);
    const words = []; for (const m of t.matchAll(/[^ ]+/g)) { const rs = lineOf(tn, m.index, m.index + m[0].length); words.push([m[0], Math.round(rs[0].top)]); }
    const lines = []; for (const [w, y] of words) { const l = lines.find(x => x.y === y); if (l) l.t += ' ' + w; else lines.push({ y, t: w }); }
    const clip = R(dot); const right = Math.max(...whole.map(r => r.right));
    const over = [...li.querySelectorAll('*')].filter(e => R(e).width > 0 && (R(e).right > iw + 0.5 || R(e).left < -0.5)).map(e => e.tagName + '.' + (e.className || '').toString().split(' ')[0]);
    return { name: nameEl.innerText.slice(0, 28), li: [Math.round(R(li).left), Math.round(iw - R(li).right)], btn: [Math.round(br.left), Math.round(br.right), Math.round(br.width), Math.round(br.height)], btnOnScreen: br.left >= 0 && br.right <= iw && br.top >= 0, btnHit: hit === btn || btn.contains(hit), date: t, spaces: [...t].filter(c => /\s/.test(c)).map(c => c.charCodeAt(0).toString(16)).join(' '), dateLines: lines.map(l => l.t), dateCut: right > clip.right + 0.5 || right > iw, tailOneLine: tops(tail).length === 1, tail: t.slice(at + 1), sameLineAsDomain: Math.round(R(domEl).top) === Math.round(whole[0].top), domainLines: new Set([...lineOf(domEl.firstChild, 0, domEl.firstChild.textContent.length)].map(r => Math.round(r.top))).size, nameRight: Math.round(R(nameEl).right), over };
  });
  const h1 = document.querySelector('h1, h2'); const para = document.querySelector('p.sub'); const pr = para && R(para);
  return { iw, sw, rows, para: pr ? [Math.round(pr.left), Math.round(iw - pr.right)] : null };
});
const check = (where, w, m, margin) => {
  ok(`${where} @${w}: no sideways scroll`, m.sw <= m.iw, `scrollWidth ${m.sw}, viewport ${m.iw}`);
  for (const r of m.rows) {
    ok(`${where} @${w} "${r.name}": wipe line whole, not cut`, !r.dateCut && /^Will be wiped on \w{3}, \w{3} \d{1,2} at\s\d{1,2}:\d{2}\s(AM|PM)$/.test(r.date), JSON.stringify(r.dateLines));
    ok(`${where} @${w} "${r.name}": "${r.tail.replace(/\s/g, ' ')}" stays on one line`, r.tailOneLine, 'space characters in the date: ' + r.spaces);
    ok(`${where} @${w} "${r.name}": Restore button fully on screen and not covered`, r.btnOnScreen && r.btnHit && r.btn[2] >= 60, `x ${r.btn[0]}–${r.btn[1]}, ${r.btn[2]}×${r.btn[3]} px`);
    ok(`${where} @${w} "${r.name}": side margins ${margin} px both sides, nothing past the edge`, Math.abs(r.li[0] - margin) <= 1 && Math.abs(r.li[1] - margin) <= 1 && !r.over.length, `left ${r.li[0]}, right ${r.li[1]}${r.over.length ? ', past the edge: ' + r.over.join(',') : ''}; domain on ${r.domainLines} line(s)`);
  }
};
const results = {};
// ── Settings → Delete business → Recently deleted (the developer account, Admin of the open business)
for (const w of [320, 360, 375, 1280]) {
  const p = await open('dev@radar.local', w, { dark: w === 360 }); await p.goto(BASE + '/settings?section=delete', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  const m = await measure(p); results['settings' + w] = m; ok(`Settings @${w}: two rows listed`, m.rows.length === 2, m.rows.map(r => r.name).join(' | '));
  if (w < 500) check('Settings', w, m, 16);
  else { ok('Settings @1280: domain and wipe date on one line with the dot between, button at the right', m.rows.every(r => r.sameLineAsDomain && r.dateLines.length === 1 && !r.dateCut && r.btnOnScreen) && m.sw <= m.iw, JSON.stringify(m.rows.map(r => [r.dateLines, r.btn])));
    const same = await p.evaluate(() => [...document.querySelectorAll('.dot-sep > span > span:nth-child(2)')].map(e => { const c = e.cloneNode(true); c.textContent = e.textContent.replace(/ /g, ' '); c.style.whiteSpace = 'nowrap'; e.parentElement.appendChild(c); const a = e.getBoundingClientRect().width, b = c.getBoundingClientRect().width; c.remove(); return [a, b]; }));
    ok('Settings @1280: the date is exactly as wide as before the fix (same text with ordinary spaces, no wrap)', same.every(([a, b]) => Math.abs(a - b) < 0.01), JSON.stringify(same)); }
  await p.screenshot({ path: `${SHOTS}/50-retest-settings-${w}.png` }); if (p.__errors.length) ok(`Settings @${w}: no page errors`, false, p.__errors.join(';'));
  // /restore for the same account
  await p.goto(BASE + '/restore', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000); const r = await measure(p); results['restoreDev' + w] = r;
  if (w < 500) { check('/restore (2 rows)', w, r, 24); ok(`/restore @${w}: the paragraph has the same margins`, r.para && Math.abs(r.para[0] - 24) <= 1 && r.para[1] >= 23, JSON.stringify(r.para)); }
  else ok('/restore @1280: one line per row, 560 px column centred, button at the right', r.rows.every(x => x.sameLineAsDomain || x.domainLines > 1) && r.rows.every(x => !x.dateCut && x.btnOnScreen) && Math.abs(r.rows[0].li[0] - r.rows[0].li[1]) <= 400, JSON.stringify(r.rows.map(x => [x.li, x.dateLines, x.btn])));
  await p.screenshot({ path: `${SHOTS}/51-retest-restore-two-rows-${w}.png` });
  if (w === 375) {   // restore from Settings at phone width
    await p.goto(BASE + '/settings?section=delete', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
    await Promise.all([p.waitForURL(u => u.pathname === '/dashboard', { timeout: 30000 }), p.getByRole('button', { name: 'Restore Lumenstudio' }).tap()]);
    let t = []; for (let i = 0; i < 30 && !t.length; i++) { await p.waitForTimeout(200); t = await toasts(p).catch(() => []); } await p.waitForTimeout(1200);
    ok('Settings @375: tapping Restore lands on the dashboard with the toast, business open', t.some(x => x.trim() === 'Lumenstudio restored.') && /lumenstudio\.test/i.test(await p.evaluate(() => document.body.innerText + document.title)) || (t.some(x => x.trim() === 'Lumenstudio restored.') && (await call(p, 'GET', '/api/me')).body.currentId === NEW), JSON.stringify(t) + ' ' + p.url().replace(BASE, ''));
    await p.screenshot({ path: `${SHOTS}/52-retest-settings-375-restored.png` });
    await call(p, 'POST', `/api/b/${NEW}/delete`, { domain: 'lumenstudio.test' });   // back to deleted for the remaining widths
    await call(p, 'POST', '/api/b/current', { id: SOLO });
  }
  await p.context().close();
}
// ── /restore with no business left (the solo owner deletes their only business through the app)
{ const p = await open('solo.qa@radar.local', 1280); await p.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' }); console.log('solo deletes Solobakery through the app:', (await call(p, 'POST', `/api/b/${SOLO}/delete`, { domain: 'solobakery.test' })).status); await p.context().close(); }
for (const w of [320, 360, 375, 1280]) {
  const p = await open('solo.qa@radar.local', w, { dark: w === 320 }); await p.goto(BASE + '/restore', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
  const m = await measure(p); results['restoreSolo' + w] = m; ok(`/restore, no business left @${w}: two rows listed`, m.rows.length === 2, m.rows.map(r => r.name).join(' | '));
  if (w < 500) { check('/restore, no business left', w, m, 24); ok(`/restore @${w}: the paragraph has the same margins`, m.para && Math.abs(m.para[0] - 24) <= 1 && m.para[1] >= 23, JSON.stringify(m.para)); }
  else ok('/restore, no business left @1280: nothing cut, button on screen', m.rows.every(x => !x.dateCut && x.btnOnScreen) && m.sw <= m.iw, JSON.stringify(m.rows.map(x => [x.li, x.dateLines])));
  await p.screenshot({ path: `${SHOTS}/53-retest-restore-no-business-${w}.png` });
  if (w === 320) {
    await Promise.all([p.waitForURL(u => u.pathname === '/dashboard', { timeout: 30000 }), p.getByRole('button', { name: 'Restore Solobakery' }).tap()]);
    let t = []; for (let i = 0; i < 30 && !t.length; i++) { await p.waitForTimeout(200); t = await toasts(p).catch(() => []); } await p.waitForTimeout(1200);
    ok('/restore @320: tapping Restore lands on the dashboard with the toast', t.some(x => x.trim() === 'Solobakery restored.') && new URL(p.url()).pathname === '/dashboard' && (await call(p, 'GET', '/api/me')).body.currentId === SOLO, JSON.stringify(t));
    await p.screenshot({ path: `${SHOTS}/54-retest-restore-320-restored.png` });
    await call(p, 'POST', `/api/b/${SOLO}/delete`, { domain: 'solobakery.test' });
  }
  await p.context().close();
}
// leave the accounts as they were: both real businesses active again, fixtures removed
{ const p = await open('solo.qa@radar.local', 1280); await p.goto(BASE + '/restore', { waitUntil: 'domcontentloaded' }); console.log('restore Solobakery', (await call(p, 'POST', '/api/b/restore', { id: SOLO })).status); await p.context().close(); }
{ const p = await open('dev@radar.local', 1280); await p.goto(BASE + '/restore', { waitUntil: 'domcontentloaded' }); console.log('restore Lumenstudio', (await call(p, 'POST', '/api/b/restore', { id: NEW })).status); await p.context().close(); }
await pool.query('delete from businesses where id = any($1)', [[fx1, fx2]]);
fs.writeFileSync(`${HERE}retest.result.json`, JSON.stringify(results, null, 1));
console.log(`\n${fails} failed`);
await b.close(); await pool.end();
