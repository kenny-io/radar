// C4 media upload: accept/replace/remove, refusals keep the previous image, Instagram ratio, media-required messages, video.
import assert from 'node:assert/strict'; import fs from 'node:fs/promises';
import { session, check, finish, base, fixture, evidence, files, packData, pubs } from './lib.mjs';
const { p, errors, act, c } = await session('Editor');
const j = async r => ({ status: r.status(), body: await r.json().catch(() => null) });
const W = await (await c.request.get(`${base}/api/b/${fixture.businessId}/workspace`)).json(); const acct = ch => W.social.accounts.find(a => a.ch === ch).id; const tomorrow = new Date(Date.parse(W.today + 'T12:00Z') + 864e5).toISOString().slice(0, 10);
const tab = re => p.locator('.tabs button').filter({ hasText: re }).click();
const r0 = await j(await act('social.createCustom', { name: 'QA uploads', posts: ['x', 'linkedin', 'instagram', 'tiktok', 'youtube', 'facebook'].map(k => ({ platform: k, text: 'Upload checks for ' + k })) })); const id = r0.body.data.packId;
const post = async k => (await packData(id)).posts[k];
const direct = async (k, file, name, type, packId = id, bid = fixture.businessId, ctx = c) => j(await ctx.request.post(`${base}/api/b/${bid}/social-image`, { headers: { origin: base }, multipart: { packId, platform: k, file: { name, mimeType: type, buffer: await fs.readFile(files + '/' + file) } } }));
const waitImg = async (k, pred) => { for (let i = 0; i < 60; i++) { const q = await post(k); if (pred(q)) return q; await p.waitForTimeout(250); } throw Error('image state not reached'); };
await p.goto(`${base}/social?pack=${id}`); await p.getByText(/Written by you/).waitFor();
await check('C4 X: upload JPEG shows preview; every bad file shows a clear error and keeps the previous image', async () => {
  await tab(/^X$/); const input = p.getByLabel('Upload image for X', { exact: true });
  assert.equal(await input.getAttribute('accept'), 'image/jpeg,image/png,image/webp');
  await input.setInputFiles(files + '/landscape.jpg'); const first = await waitImg('x', q => !!q.imageUrl); await p.getByRole('img', { name: 'Your image for X' }).waitFor(); const out = {};
  for (const f of ['notes.txt', 'anim.gif', 'gif-named.jpg', 'text-named.jpg', 'page.svg', 'big.png', 'corrupt.jpg', 'truncated.jpg']) {
    await input.setInputFiles(files + '/' + f); const alert = p.locator('section[aria-label="Media for X"] [role=alert]'); await alert.waitFor(); out[f] = await alert.innerText();
    await p.waitForFunction(() => !/Uploading/.test(document.querySelector('section[aria-label="Media for X"]').innerText));
    const q = await post('x'); assert.equal(q.imageUrl, first.imageUrl, f + ' changed the image'); assert.deepEqual(q.imageMeta, first.imageMeta);
    assert(await p.getByRole('img', { name: 'Your image for X' }).evaluate(i => i.complete && i.naturalWidth > 0), f + ': preview lost');
    assert(await p.getByRole('button', { name: 'Replace image', exact: true }).isEnabled());
  }
  await p.screenshot({ path: evidence + '/g1-upload-error-keeps-image.png', fullPage: true });
  for (const [f, msg] of Object.entries(out)) assert(msg.length > 10 && !/undefined|\[object|Error:|stack/i.test(msg), f + ': ' + msg);
  return out;
}, p);
await check('C4 Server alone refuses the same files (client checks bypassed), by sniffed bytes not name/declared type', async () => {
  const before = await post('x'); const out = {};
  for (const [f, name, type] of [['anim.gif', 'photo.jpg', 'image/jpeg'], ['notes.txt', 'photo.png', 'image/png'], ['page.svg', 'photo.webp', 'image/webp'], ['big.png', 'big.png', 'image/png'], ['corrupt.jpg', 'c.jpg', 'image/jpeg'], ['truncated.jpg', 't.jpg', 'image/jpeg'], ['clip.mp4', 'clip.jpg', 'image/jpeg']]) {
    const v = await direct('x', f, name, type); out[f] = `${v.status} ${v.body?.code} ${v.body?.error}`; assert(v.status >= 400 && v.status < 500, f + JSON.stringify(v));
  }
  const ok = await direct('x', 'second.png', 'misnamed.txt', 'text/plain'); out['second.png declared text/plain'] = `${ok.status} ${ok.body?.image?.meta?.type}`; assert.equal(ok.status, 200); assert.equal(ok.body.image.meta.type, 'image/png');
  const yt = await direct('youtube', 'landscape.jpg', 'a.jpg', 'image/jpeg'); out.youtubeImage = `${yt.status} ${yt.body?.error}`; assert.equal(yt.status, 400);
  const missing = await direct('x', 'landscape.jpg', 'a.jpg', 'image/jpeg', 'nope-not-a-pack'); out.missingPack = `${missing.status}`; assert.equal(missing.status, 404);
  const after = await post('x'); assert.notEqual(after.imageUrl, before.imageUrl, 'the valid one replaced it'); return out;
});
await check('C4 Replace (PNG → WebP) and Remove; stored file is re-encoded and served only as an image', async () => {
  await p.reload(); await p.getByText(/Written by you/).waitFor(); await tab(/^X$/); const a = await post('x');
  await p.getByLabel('Upload image for X', { exact: true }).setInputFiles(files + '/third.webp'); const b = await waitImg('x', q => q.imageUrl !== a.imageUrl); assert.equal(b.imageMeta.type, 'image/webp');
  const served = await c.request.get(base + b.imageUrl); const ct = served.headers()['content-type']; assert.equal(served.status(), 200); assert(/^image\/webp/.test(ct), ct);
  await p.getByRole('button', { name: 'Remove image', exact: true }).click(); await waitImg('x', q => !q.imageUrl); await p.getByText('No image · text-only post').waitFor();
  assert.equal(await p.getByRole('button', { name: 'Remove image', exact: true }).count(), 0); await p.getByRole('button', { name: 'Upload image', exact: true }).waitFor();
  await p.reload(); await p.getByText(/Written by you/).waitFor(); await tab(/^X$/); await p.getByText('No image · text-only post').waitFor();
  return { replaced: b.imageMeta, servedType: ct, nosniff: served.headers()['x-content-type-options'] || null, disposition: served.headers()['content-disposition'] || null };
}, p);
await check('C4 Instagram: media-required said before scheduling; bad ratio refused and previous kept; PNG saved as JPG; then postable', async () => {
  await tab('Instagram'); const out = {}; await p.getByText('Add an image or video to post here').waitFor();
  const side = await p.locator('.pack-side').innerText(); assert(/Add an image or video before posting to Instagram\./.test(side), side);
  assert(await p.getByRole('button', { name: 'Post now', exact: true }).isDisabled()); assert(await p.getByRole('button', { name: 'Schedule', exact: true }).isDisabled());
  const srv = await j(await act('social.schedule', { sid: `s:${id}:instagram`, date: tomorrow, time: '12:00', acctId: acct('instagram') })); out.serverNoMedia = `${srv.status} ${srv.body?.error}`; assert(srv.status >= 400);
  await p.screenshot({ path: evidence + '/g2-instagram-media-required.png', fullPage: true });
  const input = p.getByLabel('Upload image for Instagram', { exact: true });
  await input.setInputFiles(files + '/tall.jpg'); const alert = p.locator('section[aria-label="Media for Instagram"] [role=alert]'); await alert.waitFor(); out.tallFirst = await alert.innerText(); assert(/4:5/.test(out.tallFirst)); assert.equal((await post('instagram')).imageUrl, null);
  await input.setInputFiles(files + '/second.png'); const ok = await waitImg('instagram', q => !!q.imageUrl); assert.equal(ok.imageMeta.type, 'image/jpeg', 'PNG stored as JPEG'); out.stored = ok.imageMeta;
  await input.setInputFiles(files + '/tall.jpg'); await alert.waitFor(); out.tallSecond = await alert.innerText(); assert.equal((await post('instagram')).imageUrl, ok.imageUrl, 'previous kept');
  await p.waitForFunction(() => !/Add an image or video before posting/.test(document.querySelector('.pack-side').innerText));
  out.scheduleEnabled = await p.getByRole('button', { name: 'Schedule', exact: true }).isEnabled(); assert(out.scheduleEnabled);
  await p.screenshot({ path: evidence + '/g3-instagram-ratio-error.png', fullPage: true }); return out;
}, p);
await check('C4 TikTok and YouTube say media is required; YouTube has no image upload; Facebook (copy-only) takes an image', async () => {
  const out = {};
  await tab('TikTok'); out.tiktok = (await p.locator('.pack-side').innerText()).split('\n').find(l => /before posting to TikTok/.test(l)); assert(out.tiktok, 'tiktok msg');
  await tab('YouTube'); out.youtube = (await p.locator('.pack-side').innerText()).split('\n').find(l => /before posting to YouTube/.test(l)); assert(out.youtube, 'youtube msg');
  assert.equal(await p.getByLabel('Upload image for YouTube').count(), 0); await p.getByText('Add a video to post here').waitFor(); assert.equal(await p.getByLabel('Upload video for YouTube').count(), 1);
  for (const [k, ch] of [['tiktok', 'tiktok'], ['youtube', 'youtube']]) { const v = await j(await act('social.schedule', { sid: `s:${id}:${k}`, date: tomorrow, time: '12:00', acctId: acct(ch) })); out['server_' + k] = `${v.status} ${v.body?.error}`; assert(v.status >= 400); }
  await tab('Facebook'); await p.getByLabel('Upload image for Facebook', { exact: true }).setInputFiles(files + '/landscape.jpg'); await waitImg('facebook', q => !!q.imageUrl); await p.getByRole('img', { name: 'Your image for Facebook' }).waitFor();
  out.facebookButtons = (await p.locator('.pack-side').getByRole('button').allInnerTexts()).map(t => t.trim()); assert(!out.facebookButtons.includes('Schedule') && !out.facebookButtons.includes('Post now'));
  assert.equal(await p.getByLabel('Upload video for Facebook').count(), 0); assert.equal((await pubs(id)).length, 0); return out;
}, p);
await check('C4 Video: upload MP4 to Instagram replaces the image, image-over-video asks first; LinkedIn/X have no video upload', async () => {
  const out = {}; await tab('Instagram'); const before = await post('instagram');
  await p.getByLabel('Upload video for Instagram', { exact: true }).setInputFiles(files + '/clip.mp4');
  const sec = p.locator('section[aria-label="Media for Instagram"]');
  const v = await Promise.race([waitImg('instagram', q => !!q.video).then(q => ({ q })), sec.locator('[role=alert]').waitFor().then(async () => ({ err: await sec.locator('[role=alert]').innerText() }))]);
  if (v.err) { out.videoError = v.err; throw Error('video upload refused: ' + v.err); }
  assert.equal(v.q.imageUrl, null, 'video replaces the image'); out.video = v.q.video.meta; await p.getByLabel('Instagram video preview').waitFor(); await p.getByRole('button', { name: 'Remove video', exact: true }).waitFor();
  await p.getByRole('button', { name: 'Upload image', exact: true }).click(); const ask = p.getByRole('dialog', { name: 'Replace the video with this image?', exact: true }); await ask.waitFor(); await p.screenshot({ path: evidence + '/g4-replace-video-ask.png' }); await ask.getByRole('button', { name: 'Keep the video', exact: true }).click();
  assert((await post('instagram')).video, 'video kept');
  const badVid = await j(await c.request.post(`${base}/api/b/${fixture.businessId}/social-video`, { headers: { origin: base }, multipart: { packId: id, platform: 'instagram', file: { name: 'fake.mp4', mimeType: 'video/mp4', buffer: await fs.readFile(files + '/landscape.jpg') } } })); out.fakeVideo = `${badVid.status} ${badVid.body?.error}`; assert(badVid.status >= 400); assert((await post('instagram')).video.url === v.q.video.url, 'previous video kept');
  await p.getByRole('button', { name: 'Remove video', exact: true }).click(); await waitImg('instagram', q => !q.video); assert.equal((await post('instagram')).imageUrl, null, 'old image does not come back');
  await tab('LinkedIn'); assert.equal(await p.getByLabel(/Upload video/).count(), 0); await tab(/^X$/); assert.equal(await p.getByLabel(/Upload video/).count(), 0);
  const liVid = await j(await c.request.post(`${base}/api/b/${fixture.businessId}/social-video`, { headers: { origin: base }, multipart: { packId: id, platform: 'linkedin', file: { name: 'clip.mp4', mimeType: 'video/mp4', buffer: await fs.readFile(files + '/clip.mp4') } } })); out.linkedinVideoServer = `${liVid.status}`; assert(liVid.status >= 400);
  return out;
}, p);
await check('No page errors', async () => { const real = errors.filter(e => !/status of 4\d\d/.test(e)); assert.deepEqual(real, []); return { expected4xxConsoleLines: errors.length }; });
await finish('g-uploads-results.json');
