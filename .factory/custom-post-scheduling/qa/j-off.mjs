// C9 publishing off (server started with RADAR_SOCIAL_PUBLISHING unset, port 3872): composer + image upload work, no Post now / Schedule.
import assert from 'node:assert/strict'; import fs from 'node:fs/promises';
import { session, check, finish, base, fixture, evidence, files, packData, pubs } from './lib.mjs';
assert(base.endsWith(':3872')); const { p, errors, act, c } = await session('Editor'); const j = async r => ({ status: r.status(), body: await r.json().catch(() => null) }); let id;
await check('C9 Workspace reports publishing off; composer hints say Copy and paste; save works', async () => {
  const W = await (await c.request.get(`${base}/api/b/${fixture.businessId}/workspace`)).json(); assert.equal(!!W.social.publishing, false);
  await p.goto(base + '/social'); await p.getByRole('button', { name: 'Write a post', exact: true }).first().click(); const d = p.getByRole('dialog', { name: 'Write a post', exact: true }); await d.waitFor();
  const toggles = (await d.locator('button[aria-pressed]').allInnerTexts()).map(t => t.replace(/\n+/g, ' / ')); assert(toggles.every(t => /Copy and paste/.test(t)), JSON.stringify(toggles));
  await d.locator('button[aria-pressed=false]').filter({ hasText: 'Instagram' }).click();
  await d.getByLabel('Starting text').fill('Publishing-off custom post for copy and paste.'); await d.getByLabel('X post text', { exact: true }).fill('Publishing-off X version ' + 'x'.repeat(300));
  await p.screenshot({ path: evidence + '/j1-off-composer.png' }); await d.getByRole('button', { name: 'Save post', exact: true }).click(); await p.waitForURL(/pack=/); id = new URL(p.url()).searchParams.get('pack'); await p.getByText(/Written by you/).waitFor();
  return { toggles, id };
}, p);
await check('C9 PackView: no Post now / Schedule / Schedule all / video upload; Copy text and image upload + Download image work', async () => {
  const out = {};
  for (const l of ['LinkedIn', 'X', 'Instagram']) { await p.locator('.tabs button').filter({ hasText: new RegExp('^' + l + '$') }).click(); await p.waitForTimeout(150); const btns = (await p.locator('.page').getByRole('button').allInnerTexts()).map(t => t.trim()).filter(t => t && !['LinkedIn', 'X', 'Instagram'].includes(t)); out[l] = btns;
    for (const b of ['Post now', 'Schedule', 'Schedule all', 'Upload video', 'Reschedule']) assert(!btns.includes(b), `${l} shows ${b}`); assert(btns.includes('Copy text') && btns.includes('Upload image'), l + JSON.stringify(btns)); assert.equal(await p.getByLabel(/Upload video/).count(), 0); }
  await p.getByLabel('Upload image for Instagram', { exact: true }).setInputFiles(files + '/square.jpg'); await p.getByRole('img', { name: 'Your image for Instagram' }).waitFor(); assert((await packData(id)).posts.instagram.imageUrl);
  const dl = p.waitForEvent('download'); await p.getByRole('button', { name: 'Download image', exact: true }).click(); const file = await dl; out.download = file.suggestedFilename(); assert(/\.jpg$/.test(out.download));
  await p.locator('.tabs button').filter({ hasText: /^X$/ }).click(); out.xCounter = await p.getByText(/characters|\/ 280/).first().innerText();
  await p.context().grantPermissions(['clipboard-read', 'clipboard-write']); await p.getByRole('button', { name: 'Copy text', exact: true }).click(); await p.waitForTimeout(300); out.clipboard = (await p.evaluate(() => navigator.clipboard.readText())).slice(0, 30);
  await p.screenshot({ path: evidence + '/j2-off-pack.png', fullPage: true }); assert(/Publishing-off X version/.test(out.clipboard)); return out;
}, p);
await check('C9 Server refuses schedule / post now / video upload with publishing off; image remove works', async () => {
  const r = {}; const d = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  r.schedule = await j(await act('social.schedule', { sid: `s:${id}:linkedin`, date: d, time: '12:00' })); r.postNow = await j(await act('social.postNow', { sid: `s:${id}:linkedin` })); r.scheduleAll = await j(await act('social.scheduleAll', { packId: id, date: d, rows: [{ platform: 'linkedin', time: '12:00', acctId: '00000000-0000-4000-8000-000000000000' }] }));
  r.video = await j(await c.request.post(`${base}/api/b/${fixture.businessId}/social-video`, { headers: { origin: base }, multipart: { packId: id, platform: 'instagram', file: { name: 'a.mp4', mimeType: 'video/mp4', buffer: await fs.readFile(files + '/clip.mp4') } } }));
  for (const [k, v] of Object.entries(r)) assert(v.status >= 400, k + JSON.stringify(v)); assert.equal((await pubs(id)).length, 0);
  const rm = await j(await act('social.imageRemove', { packId: id, platform: 'instagram' })); assert.equal(rm.status, 200); assert.equal((await packData(id)).posts.instagram.imageUrl, null);
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, `${v.status} ${v.body?.code} ${v.body?.error}`]));
});
await check('C9/C10 Library with publishing off: custom pack listed, searchable, no status filter', async () => {
  await p.goto(base + '/social'); await p.getByRole('heading', { name: 'Content library', exact: true }).waitFor(); assert.equal(await p.getByRole('group', { name: 'Filter packs by status' }).count(), 0);
  await p.getByRole('searchbox', { name: 'Search saved packs', exact: true }).fill('Publishing-off custom'); await p.waitForTimeout(300); const n = await p.getByRole('article').count(); assert.equal(n, 1); const t = await p.getByRole('article').innerText(); await p.screenshot({ path: evidence + '/j3-off-library.png', fullPage: true });
  return { card: t.replace(/\n+/g, ' | ') };
}, p);
await check('No page errors', async () => { assert.deepEqual(errors.filter(e => !/status of 4\d\d/.test(e)), []); });
await finish('j-off-results.json');
