// A member who is saving when the business is deleted: with the event stream blocked, only the failed save can move the tab out.
import { chromium, session, call, shot, text, toasts, BASE } from './lib.mjs';
const SOLO = '36b937ef-0f06-4768-bcc6-83645883932e';
const b = await chromium.launch(); const ok = (name, pass, detail = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
const adm = await session(b, 'dev@radar.local'); const p = adm.page;      // Admin of Solobakery
await p.route('**/api/b/*/events', r => r.abort());
await p.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' }); await call(p, 'POST', '/api/b/current', { id: SOLO });
await p.goto(BASE + '/settings?section=feedback', { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
ok('Admin has Solobakery open', /solobakery\.test/.test(await text(p)));
const owner = await session(b, 'solo.qa@radar.local', { password: process.env.QA_PW2 }); await owner.page.goto(BASE + '/settings', { waitUntil: 'domcontentloaded' });
const ta = p.locator('main textarea, .page textarea').first(); await ta.fill('QA: typed while the owner deletes the business.');
console.log('owner deletes', (await call(owner.page, 'POST', `/api/b/${SOLO}/delete`, { domain: 'solobakery.test' })).status);
const btn = p.locator('main, .page').getByRole('button', { name: /send|submit|request/i }).last(); console.log('clicking:', await btn.innerText());
const t0 = Date.now(); await btn.click();
let moved = null; for (let i = 0; i < 40; i++) { if (!p.url().includes('/settings')) { moved = Date.now() - t0; break; } await p.waitForTimeout(250); }
await p.waitForLoadState('domcontentloaded').catch(() => {}); let at = []; for (let i = 0; i < 30 && !at.length; i++) { await p.waitForTimeout(200); at = await toasts(p).catch(() => []); }
await p.waitForTimeout(1000);
ok('DEL-4 a save made after the delete moves the member out with the one message, no error toast', moved != null && at.length === 1 && /That business was deleted\./.test(at[0]), `after ${moved} ms → ${p.url().replace(BASE, '')} toasts ${JSON.stringify(at)}`);
await shot(p, '16-member-saving-moved-out');
console.log('restore', (await call(owner.page, 'POST', '/api/b/restore', { id: SOLO })).status);
await b.close();
