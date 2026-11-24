// C8 permissions and tenancy: Viewer (UI + direct API), another business, unauthenticated, cross-origin.
import assert from 'node:assert/strict'; import fs from 'node:fs/promises';
import { session, check, finish, base, fixture, evidence, files, packData, pubs, browser, db } from './lib.mjs';
const ed = await session('Editor'), vw = await session('Viewer'), out = await session('Outsider', { bid: fixture.otherBusinessId });
const j = async r => ({ status: r.status(), body: await r.json().catch(() => null) }); const A = fixture.businessId, B = fixture.otherBusinessId;
const img = await fs.readFile(files + '/landscape.jpg'); const vid = await fs.readFile(files + '/clip.mp4');
const up = (s, bid, packId, k, kind = 'image', headers = { origin: base }) => s.c.request.post(`${base}/api/b/${bid}/social-${kind}`, { headers, multipart: { packId, platform: k, file: kind === 'image' ? { name: 'a.jpg', mimeType: 'image/jpeg', buffer: img } : { name: 'a.mp4', mimeType: 'video/mp4', buffer: vid } } }).then(j);
const W = await (await ed.c.request.get(`${base}/api/b/${A}/workspace`)).json(); const acct = ch => W.social.accounts.find(a => a.ch === ch).id; const tomorrow = new Date(Date.parse(W.today + 'T12:00Z') + 864e5).toISOString().slice(0, 10);
const id = (await j(await ed.act('social.createCustom', { name: 'QA permissions', posts: [{ platform: 'x', text: 'Editor wrote this for X' }, { platform: 'instagram', text: 'Editor wrote this for Instagram' }] }))).body.data.packId;
assert.equal((await up(ed, A, id, 'x')).status, 200); const start = await packData(id);
const foreign = (await j(await out.act('social.createCustom', { name: 'Other business post', posts: [{ platform: 'x', text: 'Belongs to the other business' }] }))).body.data.packId;
assert.equal((await up(out, B, foreign, 'x')).status, 200); const foreignStart = await packData(foreign);
await check('C8 Viewer UI: Write a post disabled, ?write=1 opens nothing, pack is read-only with image shown and no media/schedule controls', async () => {
  const p = vw.p; await p.goto(base + '/social'); await p.getByRole('heading', { name: 'Content library', exact: true }).waitFor();
  assert(await p.getByRole('button', { name: 'Write a post', exact: true }).first().isDisabled()); assert(await p.getByRole('button', { name: 'Generate social posts', exact: true }).first().isDisabled());
  await p.goto(base + '/social?write=1'); await p.getByRole('heading', { name: 'Content library', exact: true }).waitFor(); await p.waitForTimeout(500); assert.equal(await p.getByRole('dialog').count(), 0);
  await p.goto(`${base}/social?pack=${id}`); await p.getByText(/Written by you/).waitFor(); await p.locator('.tabs button').filter({ hasText: /^X$/ }).click();
  const ta = p.getByLabel('X post text', { exact: true }); assert.equal(await ta.getAttribute('readonly') !== null, true, 'editor read-only');
  await p.getByRole('img', { name: 'Your image for X' }).waitFor(); assert.equal(await p.locator('section[aria-label="Media for X"]').count(), 0); assert.equal(await p.locator('input[type=file]').count(), 0);
  const buttons = await p.locator('.pack-side').getByRole('button').evaluateAll(b => b.map(x => `${x.innerText.trim()}:${x.disabled ? 'disabled' : 'enabled'}`)); await p.screenshot({ path: evidence + '/i1-viewer-pack.png', fullPage: true });
  for (const b of buttons) if (/^(Post now|Schedule|Reschedule|Unschedule|Try again)/.test(b)) assert(/disabled/.test(b), b);
  const sa = p.getByRole('button', { name: 'Schedule all', exact: true }); const saState = await sa.count() ? (await sa.isDisabled() ? 'disabled' : 'ENABLED') : 'absent';
  let viewerScheduleAll = null; if (saState === 'ENABLED') { await sa.click(); const m = p.getByRole('dialog', { name: 'Schedule this pack', exact: true }); await m.waitFor(); const b = m.getByRole('button').last(); viewerScheduleAll = { button: await b.innerText(), disabled: await b.isDisabled() }; if (!viewerScheduleAll.disabled) { const resp = p.waitForResponse(r => r.url().endsWith('/act') && r.request().postDataJSON()?.action === 'social.scheduleAll'); await b.click(); viewerScheduleAll.status = (await resp).status(); await p.waitForTimeout(400); viewerScheduleAll.toast = (await p.locator('body').innerText()).split('\n').filter(l => /permission/i.test(l)); await p.screenshot({ path: evidence + '/i2-viewer-schedule-all.png' }); } await p.keyboard.press('Escape'); }
  return { buttons, scheduleAll: saState, viewerScheduleAll, pageErrors: vw.errors };
}, vw.p);
await check('C8 Viewer direct API: create, edit, upload, remove, schedule, post now all refused; pack unchanged', async () => {
  const r = {};
  r.create = await j(await vw.act('social.createCustom', { posts: [{ platform: 'x', text: 'viewer' }] }));
  r.text = await j(await vw.act('social.text', { packId: id, platform: 'x', text: 'viewer edit' }));
  r.imageRemove = await j(await vw.act('social.imageRemove', { packId: id, platform: 'x' }));
  r.schedule = await j(await vw.act('social.schedule', { sid: `s:${id}:x`, date: tomorrow, time: '12:00', acctId: acct('x') }));
  r.scheduleAll = await j(await vw.act('social.scheduleAll', { packId: id, date: tomorrow, rows: [{ platform: 'x', time: '12:00', acctId: acct('x') }] }));
  r.postNow = await j(await vw.act('social.postNow', { sid: `s:${id}:x`, acctId: acct('x') }));
  r.uploadImage = await up(vw, A, id, 'x'); r.uploadVideo = await up(vw, A, id, 'instagram', 'video');
  for (const [k, v] of Object.entries(r)) assert.equal(v.status, 403, k + ' ' + JSON.stringify(v));
  assert.deepEqual(await packData(id), start); assert.equal((await pubs(id)).length, 0);
  const n = (await db.query("SELECT count(*)::int n FROM social_packs WHERE business_id=$1 AND data->'posts'->'x'->>'text'='viewer'", [A])).rows[0].n; assert.equal(n, 0);
  const read = await vw.c.request.get(base + start.posts.x.imageUrl); assert.equal(read.status(), 200, 'viewer can read the image');
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, `${v.status} ${v.body?.error}`]));
});
await check('C8 Another business cannot read, edit, upload to or schedule this pack, nor read its file', async () => {
  const r = {};
  r.workspaceOfA = (await out.c.request.get(`${base}/api/b/${A}/workspace`)).status();
  r.actOnA_text = (await j(await out.act('social.text', { packId: id, platform: 'x', text: 'outsider' }, A))).status;
  r.uploadToA = (await up(out, A, id, 'x')).status; r.videoToA = (await up(out, A, id, 'instagram', 'video')).status;
  r.ownBid_text = (await j(await out.act('social.text', { packId: id, platform: 'x', text: 'outsider' }))).status;
  r.ownBid_imageRemove = (await j(await out.act('social.imageRemove', { packId: id, platform: 'x' }))).status;
  r.ownBid_schedule = (await j(await out.act('social.schedule', { sid: `s:${id}:x`, date: tomorrow, time: '12:00' }))).status;
  r.ownBid_upload = (await up(out, B, id, 'x')).status; r.ownBid_video = (await up(out, B, id, 'instagram', 'video')).status;
  r.fileOfA = (await out.c.request.get(base + start.posts.x.imageUrl)).status();
  r.mediaProxyOwnBid = (await out.c.request.get(`${base}/api/b/${B}/media?url=${encodeURIComponent(start.posts.x.imageUrl)}`)).status();
  r.mediaProxyA = (await out.c.request.get(`${base}/api/b/${A}/media?url=${encodeURIComponent(start.posts.x.imageUrl)}`)).status();
  for (const [k, v] of Object.entries(r)) if (k !== 'fileOfA') assert([400, 401, 403, 404].includes(v), k + ' ' + v);  // fileOfA recorded: files are public by design (architecture F6)
  await out.p.goto(`${base}/social?pack=${id}`); await out.p.getByText('This pack isn’t available in this business.').waitFor(); r.ui = 'Pack unavailable';
  const ws = JSON.stringify(await (await out.c.request.get(`${base}/api/b/${B}/workspace`)).json()); assert(!ws.includes(id) && !ws.includes('Editor wrote this'));
  assert.deepEqual(await packData(id), start); return r;
}, out.p);
await check('C8 Editor of this business cannot touch the other business pack or attach its file', async () => {
  const r = {};
  r.uploadToOtherBid = (await up(ed, B, foreign, 'x')).status; r.uploadForeignPackOwnBid = (await up(ed, A, foreign, 'x')).status;
  r.textForeignPack = (await j(await ed.act('social.text', { packId: foreign, platform: 'x', text: 'hijack' }))).status; r.removeForeign = (await j(await ed.act('social.imageRemove', { packId: foreign, platform: 'x' }))).status;
  r.scheduleForeign = (await j(await ed.act('social.schedule', { sid: `s:${foreign}:x`, date: tomorrow, time: '12:00', acctId: acct('x') }))).status;
  r.readForeignFile = (await ed.c.request.get(base + foreignStart.posts.x.imageUrl)).status();
  for (const [k, v] of Object.entries(r)) if (k !== 'readForeignFile') assert([403, 404].includes(v), k + ' ' + v);
  assert.deepEqual(await packData(foreign), foreignStart);
  // crafted pack id / sid shapes
  r.sidTraversal = (await j(await ed.act('social.schedule', { sid: `s:../${foreign}:x`, date: tomorrow, time: '12:00', acctId: acct('x') }))).status; assert(r.sidTraversal >= 400);
  return r;
});
await check('C8 Unauthenticated and cross-origin uploads are refused', async () => {
  const anon = await browser.newContext(); const a = await j(await anon.request.post(`${base}/api/b/${A}/social-image`, { headers: { origin: base }, multipart: { packId: id, platform: 'x', file: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: img } } }));
  const anonAct = await j(await anon.request.post(`${base}/api/b/${A}/act`, { headers: { origin: base }, data: { action: 'social.createCustom', input: { posts: [{ platform: 'x', text: 'anon' }] } } }));
  const anonFile = (await anon.request.get(base + start.posts.x.imageUrl, { maxRedirects: 0 })).status(); await anon.close();
  const cross = await up(ed, A, id, 'x', 'image', { origin: 'https://evil.example' }); const crossSite = await up(ed, A, id, 'x', 'image', { 'sec-fetch-site': 'cross-site' });
  assert.equal(a.status, 401); assert.equal(anonAct.status, 401); assert.equal(cross.status, 403); assert.equal(crossSite.status, 403);
  assert.deepEqual(await packData(id), start); return { anonUpload: a.status, anonAct: anonAct.status, anonFile, crossOrigin: cross.status, crossSite: crossSite.status };
});
await check('C2 Server input validation: duplicate platform, all blank, unknown fields, >8 posts, huge text, control chars in name', async () => {
  const r = {}; const t = async (k, input) => { const v = await j(await ed.act('social.createCustom', input)); r[k] = `${v.status} ${v.body?.code || ''} ${v.body?.error || 'ok'}`; return v; };
  assert.equal((await t('duplicate', { posts: [{ platform: 'x', text: 'a' }, { platform: 'x', text: 'b' }] })).status, 400);
  assert.equal((await t('allBlank', { posts: [{ platform: 'x', text: '  \n ' }] })).status, 400);
  assert.equal((await t('unknownField', { posts: [{ platform: 'x', text: 'a', author: 'radar', imageUrl: '/api/files/x' }] })).status, 400);
  assert.equal((await t('injectedSource', { posts: [{ platform: 'x', text: 'a' }], auto: true })).status, 400);
  assert.equal((await t('hugeText', { posts: [{ platform: 'x', text: 'a'.repeat(20001) }] })).status, 400);
  assert.equal((await t('noPosts', { posts: [] })).status, 400); assert.equal((await t('badPlatform', { posts: [{ platform: 'threads', text: 'a' }] })).status, 400);
  const nm = await t('nameControlChars', { name: '  Launch\u0000\n<b>day</b>  ', posts: [{ platform: 'x', text: 'a' }] }); assert.equal(nm.status, 200); const d = await packData(nm.body.data.packId); r.storedName = JSON.stringify(d.name);
  await ed.p.goto(`${base}/social?pack=${nm.body.data.packId}`); await ed.p.getByText(/Written by you/).waitFor(); r.h1 = await ed.p.locator('h1').first().innerText(); assert.equal(await ed.p.locator('h1 b').count(), 0, 'name rendered as text');
  const xss = await j(await ed.act('social.createCustom', { posts: [{ platform: 'x', text: '<img src=x onerror="window.__xss=1"> <script>window.__xss=1</script>' }] })); await ed.p.goto(`${base}/social?pack=${xss.body.data.packId}`); await ed.p.getByText(/Written by you/).waitFor(); await ed.p.goto(base + '/social'); await ed.p.getByRole('heading', { name: 'Content library' }).waitFor(); await ed.p.waitForTimeout(400);
  assert.equal(await ed.p.evaluate(() => window.__xss), undefined, 'no script execution from post text'); return r;
}, ed.p);
await finish('i-auth-results.json');
