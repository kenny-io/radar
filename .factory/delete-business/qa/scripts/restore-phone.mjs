import { chromium, session, call, shot, BASE } from './lib.mjs';
const SOLO = '36b937ef-0f06-4768-bcc6-83645883932e';
const b = await chromium.launch();
const s0 = await session(b, 'solo.qa@radar.local', { password: process.env.QA_PW2 }); await s0.page.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' });
const d = await call(s0.page, 'POST', `/api/b/${SOLO}/delete`, { domain: 'solobakery.test' }); console.log('delete', d.status);
for (const [w, dark, touch] of [[375, true, true], [375, false, true], [375, false, false], [360, false, true], [414, false, true], [768, false, false]]) {
  const { page: p } = await session(b, 'solo.qa@radar.local', { password: process.env.QA_PW2, width: w, height: 812, mobile: touch, dark });
  await p.goto(BASE + '/restore', { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
  const m = await p.evaluate(() => { const r = e => { const x = e?.getBoundingClientRect(); return x ? { l: Math.round(x.left), r: Math.round(x.right), w: Math.round(x.width) } : null; }; const btn = [...document.querySelectorAll('button')].find(x => /Restore/.test(x.innerText)); const h1 = document.querySelector('h1'); const para = document.querySelector('p.sub'); const wrap = h1?.parentElement; const chain = []; let e = wrap; while (e && e !== document.body) { const cs = getComputedStyle(e); chain.push(`${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ')[0]} w=${Math.round(e.getBoundingClientRect().width)} l=${Math.round(e.getBoundingClientRect().left)} pad=${cs.paddingLeft}/${cs.paddingRight} ov=${cs.overflowX} box=${cs.boxSizing}`); e = e.parentElement; } return { iw: window.innerWidth, sw: document.documentElement.scrollWidth, btn: r(btn), para: r(para), wrap: r(wrap), chain }; });
  console.log(`width ${w}${dark ? ' dark' : ''}${touch ? ' touch' : ''}: viewport ${m.iw}, button ${JSON.stringify(m.btn)}, paragraph ${JSON.stringify(m.para)}, container ${JSON.stringify(m.wrap)} → ${m.btn && m.btn.r > m.iw ? 'BUTTON CUT OFF by ' + (m.btn.r - m.iw) + 'px' : 'fits'}`);
  if (w === 375 && !dark && touch) { console.log(m.chain.join('\n   ')); await shot(p, '26-phone-light-restore-page-clipped'); }
  if (w === 375 && dark) {
    await p.goto(BASE + '/email-preferences', { waitUntil: 'networkidle' }); await p.waitForTimeout(700);
    const e = await p.evaluate(() => { const els = [...document.querySelectorAll('main *, body *')].filter(x => x.children.length === 0 && x.getBoundingClientRect().width > 0); const over = els.filter(x => x.getBoundingClientRect().right > window.innerWidth + 1).length; return { iw: window.innerWidth, over, maxRight: Math.round(Math.max(...els.map(x => x.getBoundingClientRect().right))) }; });
    console.log('  same shell, /email-preferences at 375:', JSON.stringify(e));
  }
  await p.context().close();
}
const r = await call(s0.page, 'POST', '/api/b/restore', { id: SOLO }); console.log('restore', r.status);
await b.close();
