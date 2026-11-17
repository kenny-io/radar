import { chromium, session, call, db, shot, text, toasts, BASE } from './lib.mjs';
const SOLO = '36b937ef-0f06-4768-bcc6-83645883932e';
const pool = db(); const b = await chromium.launch();
const ok = (name, pass, detail = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
const { ctx, page: p } = await session(b, 'solo.qa@radar.local', { password: process.env.QA_PW2, width: 375, height: 812, mobile: true, dark: true });
const overflow = () => p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, dark: getComputedStyle(document.body).backgroundColor }));
await p.goto(BASE + '/dashboard', { waitUntil: 'networkidle' }); console.log('signed in, no business → ', p.url().replace(BASE, ''));
let o; let tst = [];
await p.waitForTimeout(1500);
const t1 = await text(p); const line = await p.locator('.restore-line').innerText().catch(() => '');
ok('E-1 the no-business screen has the restore line and the add-a-business form', /^You deleted Solobakery\. You can restore it until .+\. Restore$/.test(line.replace(/\s+/g, ' ').trim()) && /Analyze website/.test(t1), line.replace(/\s+/g, ' '));
o = await overflow(); ok('phone: no-business screen has no sideways scroll', o.sw <= o.iw + 1, JSON.stringify(o));
await shot(p, '22-phone-dark-no-business-restore-line');
const me = (await call(p, 'GET', '/api/me')).body; ok('me: no businesses, one deleted', me.businesses.length === 0 && me.currentId === null && me.deleted.length === 1);
// keyboard reaches the link
const link = p.locator('.restore-line a'); ok('the Restore link goes to /restore', (await link.getAttribute('href')) === '/restore');
await Promise.all([p.waitForURL(u => u.pathname === '/restore'), link.tap()]); await p.waitForTimeout(1200);
const t2 = await text(p);
ok('RES-1 /restore works with no business left: name, domain, wipe date, Restore', /Restore a business/.test(t2) && /Solobakery/.test(t2) && /solobakery\.test/.test(t2) && /Will be wiped on/.test(t2), t2.replace(/\n/g, ' | ').slice(0, 300));
o = await overflow(); ok('phone: /restore has no sideways scroll', o.sw <= o.iw + 1, JSON.stringify(o));
await shot(p, '23-phone-dark-restore-page');
// signed out → sign-in → back to /restore
await p.goto(BASE + '/onboarding', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
await p.getByText('Sign out').first().tap(); await p.waitForTimeout(2500);
console.log('after sign out:', p.url().replace(BASE, ''));
await p.goto(BASE + '/restore', { waitUntil: 'networkidle' });
ok('RES-1 /restore signed out sends to sign-in and remembers /restore', new URL(p.url()).pathname === '/signin' && new URL(p.url()).searchParams.get('next') === '/restore', p.url().replace(BASE, ''));
const anonRestore = await call(p, 'POST', '/api/b/restore', { id: SOLO }); ok('restore request signed out is refused (401)', anonRestore.status === 401, String(anonRestore.status));
await p.fill('input[type=email]', 'solo.qa@radar.local'); await p.fill('input[type=password]', process.env.QA_PW2);
await Promise.all([p.waitForURL(u => u.pathname === '/restore', { timeout: 30000 }), p.keyboard.press('Enter')]); await p.waitForTimeout(1200);
ok('RES-1 after sign-in the owner is back on /restore with the list', /Solobakery/.test(await text(p)), p.url().replace(BASE, ''));
await ctx.storageState({ path: new URL('./state-solo_qa_radar_local.json', import.meta.url).pathname });
// E-1 the owner can still add a business while one is deleted: checked on the no-business screen above. Restore by keyboard.
const rb = p.getByRole('button', { name: 'Restore Solobakery' });
await rb.focus(); await Promise.all([p.waitForURL(u => u.pathname === '/dashboard', { timeout: 30000 }), p.keyboard.press('Enter')]);
tst = []; for (let i = 0; i < 30 && !tst.length; i++) { await p.waitForTimeout(200); tst = await toasts(p).catch(() => []); }
await p.waitForTimeout(1500);
ok('RES-2 restore from /restore opens the business with "Solobakery restored."', tst.some(t => t.trim() === 'Solobakery restored.') && /Solobakery|solobakery/.test(await text(p)), JSON.stringify(tst));
await shot(p, '24-phone-dark-restored');
await p.goto(BASE + '/restore', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
ok('/restore with nothing deleted says so', /Nothing to restore/.test(await text(p))); await shot(p, '25-phone-dark-nothing-to-restore');
console.log('errors', JSON.stringify(p.__errors));
await b.close(); await pool.end();
