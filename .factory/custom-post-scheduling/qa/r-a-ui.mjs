// Retest a384c862: (1) title wrap at 375px and desktop, (2) Viewer Schedule all disabled, (3) Schedule all disabled during uploads.
import assert from 'node:assert/strict';
import { session, check, finish, base, fixture, evidence, files, db, pubs } from './lib.mjs';
const ed = await session('Editor'); const vw = await session('Viewer'); const j = async r => ({ status: r.status(), body: await r.json().catch(() => null) });
const mk = async (input) => (await j(await ed.act('social.createCustom', input))).body.data.packId;
const urlName = await mk({ posts: [{ platform: 'x', text: 'https://example.com/' + 'averyveryverylongunbrokenpathsegment'.repeat(8) }, { platform: 'linkedin', text: 'Short' }] });
const longName = await mk({ name: 'N'.repeat(120), posts: [{ platform: 'linkedin', text: 'Short' }, { platform: 'x', text: 'Short' }] });
const shortName = await mk({ name: 'Thally launch', posts: [{ platform: 'linkedin', text: 'Short LinkedIn text.' }, { platform: 'x', text: 'Short X text.' }, { platform: 'instagram', text: 'Short Instagram text.' }] });
const gid = 'qa-gen-r'; const gpost = t => ({ text: t, style: 'branded', seed: 1, imageUrl: null, copiedAt: null, v: 0 });
await db.query('INSERT INTO social_packs(id,business_id,data) VALUES($1,$2,$3)', [gid, fixture.businessId, { id: gid, name: 'Why most freelancers undercharge in their first year', source: { kind: 'idea', label: 'Baseline idea' }, created: '2026-11-24', style: 'branded', auto: false, order: ['x', 'linkedin'], posts: { x: gpost('Generated X text.'), linkedin: gpost('Generated LinkedIn text.') }, headline: 'Baseline' }]);
const measure = p => p.evaluate(() => { const h = document.querySelector('h1'); const r = h.getBoundingClientRect(); return { docW: document.documentElement.scrollWidth, innerW: innerWidth, h1ScrollW: h.scrollWidth, h1ClientW: h.clientWidth, h1H: Math.round(r.height), h1Right: Math.round(r.right), lineH: parseFloat(getComputedStyle(h).lineHeight), wrap: getComputedStyle(h).overflowWrap }; });
const open = async (p, id) => { await p.goto(`${base}/social?pack=${id}`); await p.locator('h1').first().waitFor(); await p.waitForTimeout(300); };
for (const [w, h, tag] of [[375, 812, '375'], [1440, 1000, '1440']]) {
  await check(`1 Title wrap at ${tag}px: link-first default name and 120-char unbroken name; normal titles unchanged`, async () => {
    const p = ed.p; await p.setViewportSize({ width: w, height: h }); const out = {};
    for (const [k, id] of Object.entries({ urlName, longName, shortName, generated: gid })) {
      await open(p, id); out[k] = await measure(p); await p.screenshot({ path: `${evidence}/r1-${tag}-${k}.png`, fullPage: tag === '375' });
      assert(out[k].docW <= out[k].innerW, `${k}: page ${out[k].docW} > ${out[k].innerW}`); assert(out[k].h1ScrollW <= out[k].h1ClientW + 1, `${k}: h1 overflows itself`); assert(out[k].h1Right <= out[k].innerW, `${k}: h1 right edge ${out[k].h1Right}`);
      if (tag === '1440') { const btns = await p.getByRole('button', { name: /^(Schedule all|Download all)$/ }).evaluateAll(b => b.map(x => { const r = x.getBoundingClientRect(); return { t: x.innerText.trim(), right: Math.round(r.right), w: Math.round(r.width) }; })); out[k].headButtons = btns; assert(btns.every(b => b.right <= innerWidthOf(w) && b.w > 60), JSON.stringify(btns)); }
    }
    for (const k of ['shortName', 'generated']) if (tag === '1440' || k === 'shortName') assert(out[k].h1H <= out[k].lineH * 1.5 + 2, `${k} should be one line: ${out[k].h1H}`);
    await p.goto(base + '/social'); await p.locator('h1').first().waitFor(); out.library = await measure(p); assert(out.library.docW <= out.library.innerW); assert(out.library.h1H <= out.library.lineH * 1.5 + 2, 'library title one line'); await p.screenshot({ path: `${evidence}/r1-${tag}-library.png` });
    await p.goto(base + '/dashboard'); await p.locator('h1').first().waitFor(); out.dashboard = await measure(p); assert(out.dashboard.docW <= out.dashboard.innerW);
    return out;
  }, ed.p);
}
function innerWidthOf(w) { return w; }
await ed.p.setViewportSize({ width: 1440, height: 1000 });
await check('2 Viewer: Schedule all disabled on custom and generated packs; click, force click and keyboard open nothing', async () => {
  const p = vw.p; const out = {};
  for (const [k, id] of [['custom', shortName], ['generated', gid]]) {
    await open(p, id); const b = p.getByRole('button', { name: 'Schedule all', exact: true }); await b.waitFor(); out[k] = { disabled: await b.isDisabled() }; assert(out[k].disabled, k);
    await b.click({ force: true }).catch(() => {}); await b.focus().catch(() => {}); await p.keyboard.press('Enter'); await p.keyboard.press('Space'); await p.waitForTimeout(400);
    out[k].dialogs = await p.getByRole('dialog').count(); assert.equal(out[k].dialogs, 0, k + ' dialog opened');
  }
  await p.screenshot({ path: evidence + '/r2-viewer-schedule-all-disabled.png' }); return out;
}, vw.p);
await check('2 Editor: Schedule all enabled, window opens and schedules 2 posts', async () => {
  const p = ed.p; await open(p, gid); const b = p.getByRole('button', { name: 'Schedule all', exact: true }); assert(await b.isEnabled()); await b.click();
  const m = p.getByRole('dialog', { name: 'Schedule this pack', exact: true }); await m.waitFor(); const go = m.getByRole('button', { name: /^Schedule \d+ posts?$/ }); const label = await go.innerText(); await go.click(); await m.waitFor({ state: 'hidden' });
  let rows = []; for (let i = 0; i < 40 && rows.length < 2; i++) { rows = (await pubs(gid)).filter(r => r.status === 'scheduled'); await p.waitForTimeout(250); } assert.equal(rows.length, 2);
  for (const r of rows) await ed.act('social.unschedule', { sid: r.sid }); return { label, rows: rows.map(r => `${r.platform} ${r.date} ${r.time}`) };
}, ed.p);
const sa = p => p.getByRole('button', { name: 'Schedule all', exact: true });
const holdRoute = async (p, glob, mode) => { let release; const gate = new Promise(r => (release = r)); await p.route(glob, async route => { await gate; if (mode === 'fail') await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'QA forced failure.' }) }); else await route.continue(); }); return () => release(); };
await check('3 Schedule all disabled while an image upload is in flight (held request), across tab switch; re-enabled after success', async () => {
  const p = ed.p; await open(p, shortName); await p.locator('.tabs button').filter({ hasText: /^X$/ }).click(); assert(await sa(p).isEnabled(), 'enabled before');
  const release = await holdRoute(p, '**/social-image', 'ok'); await p.getByLabel('Upload image for X', { exact: true }).setInputFiles(files + '/landscape.jpg');
  await p.getByText('Uploading your image for X…').waitFor(); const during = await sa(p).isDisabled(); await p.screenshot({ path: evidence + '/r3-uploading-schedule-all-disabled.png' });
  await p.locator('.tabs button').filter({ hasText: 'LinkedIn' }).click(); await p.waitForTimeout(300); const afterTab = await sa(p).isDisabled();
  release(); await p.locator('.tabs button').filter({ hasText: /^X$/ }).click(); await p.getByRole('img', { name: 'Your image for X' }).waitFor(); await p.waitForTimeout(400); const after = await sa(p).isEnabled(); await p.unroute('**/social-image');
  assert(during, 'disabled during upload'); assert(afterTab, 'still disabled after switching tab'); assert(after, 're-enabled after upload'); return { during, afterTab, reenabled: after };
}, ed.p);
await check('3 Schedule all re-enabled after a failed (400) image upload', async () => {
  const p = ed.p; await p.locator('.tabs button').filter({ hasText: 'LinkedIn' }).click(); const release = await holdRoute(p, '**/social-image', 'fail');
  await p.getByLabel('Upload image for LinkedIn', { exact: true }).setInputFiles(files + '/landscape.jpg'); await p.getByText('Uploading your image for LinkedIn…').waitFor(); const during = await sa(p).isDisabled();
  release(); const alert = p.locator('section[aria-label="Media for LinkedIn"] [role=alert]'); await alert.waitFor(); await p.waitForTimeout(300); const after = await sa(p).isEnabled(); await p.unroute('**/social-image');
  assert(during); assert(after); return { during, reenabled: after, error: await alert.innerText() };
}, ed.p);
await check('3 Schedule all disabled while an Instagram video upload is in flight; re-enabled after', async () => {
  const p = ed.p; await p.locator('.tabs button').filter({ hasText: 'Instagram' }).click(); const release = await holdRoute(p, '**/social-video', 'ok');
  await p.getByLabel('Upload video for Instagram', { exact: true }).setInputFiles(files + '/clip.mp4'); await p.getByText('Uploading your video for Instagram…').waitFor(); const during = await sa(p).isDisabled();
  const postNow = await p.getByRole('button', { name: 'Post now', exact: true }).isDisabled(); release(); await p.getByLabel('Instagram video preview').waitFor(); await p.waitForTimeout(400); const after = await sa(p).isEnabled(); await p.unroute('**/social-video');
  assert(during); assert(after); return { during, postNowDisabledDuring: postNow, reenabled: after };
}, ed.p);
await check('No page errors', async () => { assert.deepEqual([...ed.errors, ...vw.errors].filter(e => !/status of 4\d\d/.test(e)), []); });
await finish('r-a-ui-results.json');
