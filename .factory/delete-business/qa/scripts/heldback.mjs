import { chromium, session, shot, text, BASE } from './lib.mjs';
const b = await chromium.launch(); const { page: p } = await session(b, 'dev@radar.local');
await p.goto(BASE + '/social', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
await p.getByText('Why calendar based time tracking beat', { exact: false }).last().click(); await p.waitForTimeout(2500);
await p.getByText('LinkedIn', { exact: true }).first().click(); await p.waitForTimeout(1500); const t = await text(p); console.log(p.url().replace(BASE, ''), '|', (t.match(/.{0,80}(couldn.t go out on time|held it back).{0,120}/i) || ['(copy not found)'])[0].replace(/\n/g, ' | '));
console.log('Try again present:', /Try again/.test(t));
await shot(p, '13b-restored-post-held-back-detail', { full: true });
await b.close();
