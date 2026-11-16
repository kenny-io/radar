import { chromium, session, call, shot, db, BASE } from './lib.mjs';
const SOLO = '36b937ef-0f06-4768-bcc6-83645883932e';
const pool = db(); const b = await chromium.launch();
const s0 = await session(b, 'solo.qa@radar.local', { password: process.env.QA_PW2 }); await s0.page.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' });
console.log('delete solo', (await call(s0.page, 'POST', `/api/b/${SOLO}/delete`, { domain: 'solobakery.test' })).status);
{ const { page: p } = await session(b, 'solo.qa@radar.local', { password: process.env.QA_PW2, width: 360, height: 760, mobile: true });
  await p.goto(BASE + '/restore', { waitUntil: 'networkidle' }); await p.waitForTimeout(900); await shot(p, '27-phone-360-restore-page-button-cut-off');
  const m = await p.evaluate(() => { const li = document.querySelector('li'); const kids = [...li.children].map(c => ({ tag: c.tagName, w: Math.round(c.getBoundingClientRect().width), min: getComputedStyle(c).minWidth, flex: getComputedStyle(c).flex })); const date = [...li.querySelectorAll('span')].find(s => /Will be wiped/.test(s.innerText) && getComputedStyle(s).whiteSpace === 'nowrap'); return { li: Math.round(li.getBoundingClientRect().width), kids, dateW: date && Math.round(date.getBoundingClientRect().width), dateText: date?.innerText }; });
  console.log('/restore at 360:', JSON.stringify(m)); await p.context().close(); }
console.log('restore solo', (await call(s0.page, 'POST', '/api/b/restore', { id: SOLO })).status);
// the same row inside Settings (app shell): the developer account deletes its own business and opens the one it is Admin of
const NEW = (await pool.query("select id from businesses where domain='lumenstudio.test' and status='active'")).rows[0].id;
const d0 = await session(b, 'dev@radar.local'); await d0.page.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' });
console.log('delete dev business', (await call(d0.page, 'POST', `/api/b/${NEW}/delete`, { domain: 'lumenstudio.test' })).status);
for (const w of [375, 360]) { const { page: p } = await session(b, 'dev@radar.local', { width: w, height: 812, mobile: true, dark: w === 375 });
  await p.goto(BASE + '/settings?section=delete', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  const m = await p.evaluate(() => { const btn = [...document.querySelectorAll('button')].find(x => x.getAttribute('aria-label')?.startsWith('Restore ')); const r = btn?.getBoundingClientRect(); return { iw: window.innerWidth, sw: document.documentElement.scrollWidth, btnRight: r && Math.round(r.right), btnLeft: r && Math.round(r.left), text: document.body.innerText.match(/Recently deleted[\s\S]{0,110}/)?.[0].replace(/\n/g, ' | ') }; });
  console.log(`Settings → Recently deleted at ${w}:`, JSON.stringify(m), m.btnRight > m.iw ? 'BUTTON CUT OFF' : 'fits'); await shot(p, `28-phone-${w}-settings-recently-deleted`); await p.context().close(); }
console.log('restore dev business', (await call(d0.page, 'POST', '/api/b/restore', { id: NEW })).status);
await b.close(); await pool.end();
