// C5 Post now through the UI on a custom pack; C6 five-minute lock (UI + server); Instagram image send; posted editor state.
import assert from 'node:assert/strict'; import fs from 'node:fs/promises';
import { session, check, finish, base, fixture, evidence, files, packData, pubs, db, runtime } from './lib.mjs';
const { p, errors, act, c } = await session('Editor'); const j = async r => ({ status: r.status(), body: await r.json().catch(() => null) }); const tab = re => p.locator('.tabs button').filter({ hasText: re }).click();
const W = await (await c.request.get(`${base}/api/b/${fixture.businessId}/workspace`)).json(); const acct = ch => W.social.accounts.find(a => a.ch === ch).id; const tomorrow = new Date(Date.parse(W.today + 'T12:00Z') + 864e5).toISOString().slice(0, 10);
const up = (packId, k, f = 'square.jpg') => c.request.post(`${base}/api/b/${fixture.businessId}/social-image`, { headers: { origin: base }, multipart: { packId, platform: k, file: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: fs.readFile(files + '/' + f) } } });
const id = (await j(await act('social.createCustom', { name: 'QA post now', posts: [{ platform: 'x', text: 'Post now from the pack, X only text.' }, { platform: 'linkedin', text: 'LinkedIn stays a draft.' }, { platform: 'instagram', text: 'Instagram with my own square image.' }] }))).body.data.packId;
await check('C5 Post now (UI) posts only that platform, shows Posted with link; other platform stays a draft', async () => {
  await p.goto(`${base}/social?pack=${id}`); await p.getByText(/Written by you/).waitFor(); await tab(/^X$/); await p.getByRole('button', { name: 'Post now', exact: true }).click(); const m = p.getByRole('dialog', { name: 'Post now', exact: true }); await m.waitFor(); const confirm = (await m.innerText()).replace(/\n+/g, ' | '); await p.screenshot({ path: evidence + '/m1-post-now-confirm.png' });
  await m.getByRole('button', { name: 'Post now', exact: true }).click(); const link = p.getByRole('link', { name: 'View on X', exact: true }); await link.waitFor(); const rows = await pubs(id); assert.equal(rows.length, 1); assert.equal(rows[0].platform, 'x'); assert.equal(rows[0].status, 'posted'); assert.deepEqual(rows[0].payload.media, []);
  await tab('LinkedIn'); assert(await p.getByRole('button', { name: 'Post now', exact: true }).isEnabled()); assert.equal(await p.getByRole('link', { name: /View on/ }).count(), 0);
  await tab(/^X$/); const ro = await p.getByLabel('X post text', { exact: true }).getAttribute('readonly'); return { confirm, href: await link.getAttribute('href'), postedEditorReadOnly: ro !== null };
}, p);
await check('C4 Instagram custom post with an uploaded image is sent with that image (stub)', async () => {
  const u = await j(await c.request.post(`${base}/api/b/${fixture.businessId}/social-image`, { headers: { origin: base }, multipart: { packId: id, platform: 'instagram', file: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: await fs.readFile(files + '/square.jpg') } } })); assert.equal(u.status, 200);
  const r = await j(await act('social.postNow', { sid: `s:${id}:instagram`, acctId: acct('instagram') })); assert.equal(r.status, 200, JSON.stringify(r)); const row = (await pubs(id)).find(x => x.platform === 'instagram');
  return { status: r.body.data.pub.status, media: row.payload?.media?.map(m => m.type), url: row.remote_url };
});
await check('C6 Five-minute lock: editor read-only, media buttons disabled with reason, server refuses text/upload/remove/reschedule', async () => {
  await j(await c.request.post(`${base}/api/b/${fixture.businessId}/social-image`, { headers: { origin: base }, multipart: { packId: id, platform: 'linkedin', file: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: await fs.readFile(files + '/landscape.jpg') } } }));
  const s = await j(await act('social.schedule', { sid: `s:${id}:linkedin`, date: tomorrow, time: '09:00', acctId: acct('li_profile') })); assert.equal(s.status, 200, JSON.stringify(s));
  const e1 = await j(await act('social.text', { packId: id, platform: 'linkedin', text: 'Edited while scheduled, well before the lock.' })); assert.equal(e1.status, 200);
  await db.query("UPDATE social_pubs SET due_at=now()+interval '4 minutes' WHERE business_id=$1 AND sid=$2", [fixture.businessId, `s:${id}:linkedin`]);   // test DB: move due time inside the lock window
  const before = await packData(id); const r = {};
  r.text = await j(await act('social.text', { packId: id, platform: 'linkedin', text: 'too late' })); r.remove = await j(await act('social.imageRemove', { packId: id, platform: 'linkedin' }));
  r.upload = await j(await c.request.post(`${base}/api/b/${fixture.businessId}/social-image`, { headers: { origin: base }, multipart: { packId: id, platform: 'linkedin', file: { name: 'a.png', mimeType: 'image/png', buffer: await fs.readFile(files + '/second.png') } } }));
  r.reschedule = await j(await act('social.schedule', { sid: `s:${id}:linkedin`, date: tomorrow, time: '10:00', acctId: acct('li_profile') }));
  for (const [k, v] of Object.entries(r)) assert.equal(v.status, 409, k + JSON.stringify(v)); assert.deepEqual(await packData(id), before);
  await p.goto(`${base}/social?pack=${id}&plat=linkedin`); await p.getByText(/Written by you/).waitFor(); await tab('LinkedIn'); await p.getByText(/Sending at/).waitFor();
  assert((await p.getByLabel('LinkedIn post text', { exact: true }).getAttribute('readonly')) !== null); const btns = await p.locator('section[aria-label="Media for LinkedIn"]').getByRole('button').evaluateAll(b => b.map(x => `${x.innerText.trim()}:${x.disabled ? 'disabled' : 'enabled'}:${x.title}`));
  assert(btns.length === 2 && btns.every(b => /disabled/.test(b) && /too close to send time/.test(b)), JSON.stringify(btns)); await p.screenshot({ path: evidence + '/m2-locked.png', fullPage: true });
  await db.query("UPDATE social_pubs SET due_at=now()+interval '2 days' WHERE business_id=$1 AND sid=$2", [fixture.businessId, `s:${id}:linkedin`]); const un = await j(await act('social.unschedule', { sid: `s:${id}:linkedin` }));
  return { refusals: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, `${v.status} ${v.body?.code} ${v.body?.error}`])), mediaButtons: btns, cleanupUnschedule: un.status };
}, p);
await check('No page errors', async () => { assert.deepEqual(errors.filter(e => !/status of 4\d\d/.test(e)), []); });
await finish('m-postnow-lock-results.json');
