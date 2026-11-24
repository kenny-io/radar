// Retest a384c862: (4) posted → read-only (UI + 409 posted), failed stays editable, copy-only stays editable, generated same;
// (6) upload cleanup: replace/remove/video delete old files; sent snapshots and refused attaches keep files; current image still posts.
import assert from 'node:assert/strict'; import fs from 'node:fs/promises';
import { session, check, finish, base, fixture, evidence, files, db, pubs, packData, environment } from './lib.mjs';
const { p, act, c, errors } = await session('Editor'); const j = async r => ({ status: r.status(), body: await r.json().catch(() => null) });
const W = await (await c.request.get(`${base}/api/b/${fixture.businessId}/workspace`)).json(); const acct = ch => W.social.accounts.find(a => a.ch === ch).id; const tomorrow = new Date(Date.parse(W.today + 'T12:00Z') + 864e5).toISOString().slice(0, 10);
const mk = async (name, posts) => (await j(await act('social.createCustom', { name, posts }))).body.data.packId;
const tab = re => p.locator('.tabs button').filter({ hasText: re }).click();
const open = async id => { await p.goto(`${base}/social?pack=${id}`); await p.locator('h1').first().waitFor(); };
const ro = async label => (await p.getByLabel(label, { exact: true }).getAttribute('readonly')) !== null;
const upload = async (packId, k, f, type = 'image/jpeg') => j(await c.request.post(`${base}/api/b/${fixture.businessId}/social-image`, { headers: { origin: base }, multipart: { packId, platform: k, file: { name: f, mimeType: type, buffer: await fs.readFile(files + '/' + f) } } }));
const serves = async url => (await c.request.get(base + url)).status();
const dir = `${environment.STORAGE_DIR}/${fixture.businessId}/social-upload`; const count = async () => { const n = await fs.readdir(dir).catch(() => []); return { files: n.filter(x => !x.endsWith('.type')).length, sidecars: n.filter(x => x.endsWith('.type')).length }; };
const text = (id, k, t) => act('social.text', { packId: id, platform: k, text: t }).then(j);
await check('4 Custom pack: posted X is read-only (UI) and social.text 409 posted; unposted LinkedIn and copy-only Facebook stay editable', async () => {
  const id = await mk('QA posted read-only', [{ platform: 'x', text: 'X will be posted.' }, { platform: 'linkedin', text: 'LinkedIn stays a draft.' }, { platform: 'facebook', text: 'Facebook copy only.' }]);
  const pn = await j(await act('social.postNow', { sid: `s:${id}:x`, acctId: acct('x') })); assert.equal(pn.body?.data?.pub?.status, 'posted', JSON.stringify(pn));
  await open(id); const out = {}; await tab(/^X$/); await p.getByRole('link', { name: 'View on X' }).waitFor(); out.xReadOnly = await ro('X post text');
  await p.getByLabel('X post text', { exact: true }).click(); await p.keyboard.type('zzz'); await p.waitForTimeout(800); out.xTextAfterTyping = (await packData(id)).posts.x.text;
  await tab('LinkedIn'); out.liReadOnly = await ro('LinkedIn post text'); await tab('Facebook'); out.fbReadOnly = await ro('Facebook post text');
  await p.screenshot({ path: evidence + '/r4-posted-readonly.png', fullPage: true });
  out.api = { x: await text(id, 'x', 'changed after posting'), linkedin: await text(id, 'linkedin', 'LinkedIn edited'), facebook: await text(id, 'facebook', 'Facebook edited') };
  assert(out.xReadOnly); assert.equal(out.xTextAfterTyping, 'X will be posted.'); assert(!out.liReadOnly && !out.fbReadOnly);
  assert.equal(out.api.x.status, 409); assert.equal(out.api.x.body.code, 'posted'); assert.equal(out.api.linkedin.status, 200); assert.equal(out.api.facebook.status, 200);
  const d = await packData(id); assert.equal(d.posts.x.text, 'X will be posted.'); assert.equal(d.posts.facebook.text, 'Facebook edited');
  // Copy text on a posted post still works (social.copied)
  await tab(/^X$/); const cp = p.waitForResponse(r => r.url().endsWith('/act') && r.request().postDataJSON()?.action === 'social.copied'); await p.getByRole('button', { name: 'Copy text', exact: true }).click(); out.copiedStatus = (await cp).status(); assert.equal(out.copiedStatus, 200);
  out.api = Object.fromEntries(Object.entries(out.api).map(([k, v]) => [k, `${v.status} ${v.body?.code || ''} ${v.body?.error || 'ok'}`])); return out;
}, p);
await check('4 A failed post stays editable (UI + API) so the user can fix it and Try again', async () => {
  const id = await mk('QA failed editable', [{ platform: 'x', text: 'Will be rejected [[radar:reject]]' }, { platform: 'linkedin', text: 'Other' }]);
  const pn = await j(await act('social.postNow', { sid: `s:${id}:x`, acctId: acct('x') })); assert.equal(pn.body?.data?.pub?.status, 'failed', JSON.stringify(pn));
  await open(id); await tab(/^X$/); await p.getByRole('button', { name: 'Try again', exact: true }).waitFor(); const r1 = await ro('X post text');
  const t = await text(id, 'x', 'Fixed text, now acceptable.'); assert(!r1, 'failed post editor read-only'); assert.equal(t.status, 200, JSON.stringify(t));
  await p.reload(); await tab(/^X$/); await p.getByRole('button', { name: 'Try again', exact: true }).click(); await p.getByRole('dialog', { name: 'Post now' }).getByRole('button', { name: 'Post now', exact: true }).click(); await p.getByRole('link', { name: 'View on X' }).waitFor();
  return { failedReadOnly: r1, textAfterFail: t.status, retried: 'posted' };
}, p);
await check('4 Generated pack: posted post read-only and 409 posted; Regenerate controls on posted post', async () => {
  const gid = 'qa-gen-posted'; const gp = t => ({ text: t, style: 'branded', seed: 1, imageUrl: null, copiedAt: null, v: 0 });
  await db.query('INSERT INTO social_packs(id,business_id,data) VALUES($1,$2,$3)', [gid, fixture.businessId, { id: gid, name: 'Generated posted check', source: { kind: 'idea', label: 'Idea' }, created: '2026-11-24', style: 'branded', auto: false, order: ['x', 'linkedin', 'facebook'], posts: { x: gp('Generated X post.'), linkedin: gp('Generated LinkedIn post.'), facebook: gp('Generated Facebook post.') }, headline: 'Generated' }]);
  const pn = await j(await act('social.postNow', { sid: `s:${gid}:x`, acctId: acct('x') })); assert.equal(pn.body?.data?.pub?.status, 'posted', JSON.stringify(pn));
  await open(gid); await tab(/^X$/); await p.getByRole('link', { name: 'View on X' }).waitFor(); const out = { xReadOnly: await ro('X post text') };
  out.regenButtons = await p.locator('.pack-side').getByRole('button', { name: 'Regenerate' }).evaluateAll(b => b.map(x => x.disabled ? 'disabled' : 'ENABLED'));
  out.imageControls = { style: await p.getByLabel('Image style').isDisabled().catch(() => 'absent'), generateImage: await p.getByRole('button', { name: 'Generate image' }).isDisabled().catch(() => 'absent') };
  if (out.regenButtons[0] === 'ENABLED') { const r = p.waitForResponse(x => x.url().endsWith('/act') && x.request().postDataJSON()?.action === 'social.regenText'); await p.locator('.pack-side').getByRole('button', { name: 'Regenerate' }).first().click(); out.regenTextClick = (await r).status(); await p.waitForTimeout(400); out.toast = (await p.locator('body').innerText()).split('\n').filter(l => /already|live|posted/i.test(l)).slice(0, 3); await p.screenshot({ path: evidence + '/r4-generated-posted-regenerate.png', fullPage: true }); }
  out.api = { text: await text(gid, 'x', 'edit'), regenText: await j(await act('social.regenText', { packId: gid, platform: 'x' })), fb: await text(gid, 'facebook', 'Facebook edit'), li: await text(gid, 'linkedin', 'LinkedIn edit') };
  await tab('Facebook'); out.fbReadOnly = await ro('Facebook post text');
  assert(out.xReadOnly); assert.equal(out.api.text.status, 409); assert.equal(out.api.text.body.code, 'posted'); assert.equal(out.api.fb.status, 200); assert.equal(out.api.li.status, 200); assert(!out.fbReadOnly);
  out.api = Object.fromEntries(Object.entries(out.api).map(([k, v]) => [k, `${v.status} ${v.body?.code || ''} ${v.body?.error || 'ok'}`])); return out;
}, p);
await check('6 Replace and remove delete the old file; current image still serves, previews and posts', async () => {
  const id = await mk('QA cleanup', [{ platform: 'x', text: 'Cleanup check on X.' }, { platform: 'linkedin', text: 'Cleanup check on LinkedIn.' }]); const c0 = await count();
  await open(id); await tab(/^X$/); await p.getByLabel('Upload image for X', { exact: true }).setInputFiles(files + '/landscape.jpg'); await p.getByRole('img', { name: 'Your image for X' }).waitFor(); const A = (await packData(id)).posts.x.imageUrl; const c1 = await count();
  await p.getByLabel('Upload image for X', { exact: true }).setInputFiles(files + '/second.png'); for (let i = 0; i < 40 && (await packData(id)).posts.x.imageUrl === A; i++) await p.waitForTimeout(250); const B = (await packData(id)).posts.x.imageUrl; await p.waitForTimeout(300);
  const out = { afterReplace: { old: await serves(A), current: await serves(B), files: await count() } };
  assert(await p.getByRole('img', { name: 'Your image for X' }).evaluate(i => i.complete && i.naturalWidth > 0), 'current preview loads');
  await p.reload(); await tab(/^X$/); await p.getByRole('img', { name: 'Your image for X' }).waitFor(); out.previewAfterReload = await p.getByRole('img', { name: 'Your image for X' }).evaluate(i => i.complete && i.naturalWidth > 0);
  await p.getByRole('button', { name: 'Remove image', exact: true }).click(); for (let i = 0; i < 40 && (await packData(id)).posts.x.imageUrl; i++) await p.waitForTimeout(250); await p.waitForTimeout(300); out.afterRemove = { removed: await serves(B), files: await count() };
  // regression: upload again and post — payload URL is the current file and still serves
  await tab('LinkedIn'); await p.getByLabel('Upload image for LinkedIn', { exact: true }).setInputFiles(files + '/third.webp'); await p.getByRole('img', { name: 'Your image for LinkedIn' }).waitFor(); const C = (await packData(id)).posts.linkedin.imageUrl;
  const pn = await j(await act('social.postNow', { sid: `s:${id}:linkedin`, acctId: acct('li_profile') })); const row = (await pubs(id)).find(r => r.platform === 'linkedin');
  out.postNow = { status: pn.body?.data?.pub?.status, payloadUrlIsCurrent: row.payload.media[0]?.url === C, currentServes: await serves(C) };
  assert.equal(out.afterReplace.old, 404); assert.equal(out.afterReplace.current, 200); assert.equal(out.afterReplace.files.files, c1.files); assert.equal(out.afterReplace.files.sidecars, c1.sidecars);
  assert.equal(out.afterRemove.removed, 404); assert.equal(out.afterRemove.files.files, c0.files); assert.equal(out.afterRemove.files.sidecars, c0.sidecars); assert(out.previewAfterReload);
  assert.equal(out.postNow.status, 'posted'); assert(out.postNow.payloadUrlIsCurrent); assert.equal(out.postNow.currentServes, 200);
  out.counts = { before: c0, afterFirst: c1 }; out.cacheControl = (await c.request.get(base + C)).headers()['cache-control']; return out;
}, p);
await check('6 Video replacing a custom Instagram image deletes the image file', async () => {
  const id = await mk('QA video replaces image', [{ platform: 'instagram', text: 'Instagram cleanup.' }, { platform: 'x', text: 'x' }]);
  const u = await upload(id, 'instagram', 'square.jpg'); assert.equal(u.status, 200); const I = u.body.image.url; const before = await count();
  await open(id); await tab('Instagram'); await p.getByLabel('Upload video for Instagram', { exact: true }).setInputFiles(files + '/clip.mp4'); await p.getByLabel('Instagram video preview').waitFor(); await p.waitForTimeout(300);
  const d = await packData(id); const out = { imageStatus: await serves(I), videoStatus: await serves(d.posts.instagram.video.url), files: await count(), before };
  assert.equal(d.posts.instagram.imageUrl, null); assert.equal(out.imageStatus, 404); assert.equal(out.videoStatus, 200); assert.equal(out.files.files, before.files - 1); return out;
}, p);
await check('6 Guard: an image recorded in a failed send snapshot is kept after replace; replacing again later deletes only unsent files', async () => {
  const id = await mk('QA snapshot kept', [{ platform: 'x', text: 'Rejected with image [[radar:reject]]' }, { platform: 'linkedin', text: 'l' }]);
  const D = (await upload(id, 'x', 'landscape.jpg')).body.image.url; const pn = await j(await act('social.postNow', { sid: `s:${id}:x`, acctId: acct('x') })); const row = (await pubs(id)).find(r => r.platform === 'x');
  const out = { sendStatus: pn.body?.data?.pub?.status, snapshotHasD: JSON.stringify(row.payload || {}).includes(D) };
  const E = (await upload(id, 'x', 'second.png', 'image/png')).body.image.url; out.afterReplace = { D: await serves(D), E: await serves(E) };
  const F = (await upload(id, 'x', 'third.webp', 'image/webp')).body.image.url; out.afterSecondReplace = { D: await serves(D), E: await serves(E), F: await serves(F) };
  assert.equal(out.sendStatus, 'failed'); assert(out.snapshotHasD, 'payload records D: ' + JSON.stringify(row.payload)); assert.equal(out.afterReplace.D, 200, 'snapshot image kept'); assert.equal(out.afterSecondReplace.E, 404, 'unsent E deleted'); assert.equal(out.afterSecondReplace.F, 200); return out;
});
await check('6 Guard: an upload refused inside the 5-minute lock leaves no orphan and keeps the current image', async () => {
  const id = await mk('QA locked upload', [{ platform: 'linkedin', text: 'Locked cleanup' }, { platform: 'x', text: 'x' }]);
  const F = (await upload(id, 'linkedin', 'landscape.jpg')).body.image.url; const s = await j(await act('social.schedule', { sid: `s:${id}:linkedin`, date: tomorrow, time: '09:00', acctId: acct('li_profile') })); assert.equal(s.status, 200);
  await db.query("UPDATE social_pubs SET due_at=date_trunc('second', now())+interval '4 minutes' WHERE business_id=$1 AND sid=$2", [fixture.businessId, `s:${id}:linkedin`]);   // test DB: move due time into the lock window
  const before = await count(); const r = await upload(id, 'linkedin', 'second.png', 'image/png'); const rm = await j(await act('social.imageRemove', { packId: id, platform: 'linkedin' })); const after = await count();
  await db.query("UPDATE social_pubs SET due_at=date_trunc('second', now())+interval '2 days' WHERE business_id=$1 AND sid=$2", [fixture.businessId, `s:${id}:linkedin`]); await act('social.unschedule', { sid: `s:${id}:linkedin` });
  const out = { upload: `${r.status} ${r.body?.code}`, remove: `${rm.status} ${rm.body?.code}`, current: await serves(F), before, after };
  assert.equal(r.status, 409); assert.equal(rm.status, 409); assert.equal(out.current, 200); assert.deepEqual(after, before); return out;
});
await check('No page errors', async () => { assert.deepEqual(errors.filter(e => !/status of 4\d\d/.test(e)), []); });
await finish('r-b-posted-cleanup-results.json');
