// Regression: generated (non-custom) packs unchanged — generate, regenerate, style, schedule, post now with rendered image; uploads refused.
// Plus C7 automatic code (autoSchedule) on custom vs generated, the send target for custom posts (no AI label), and the past-time UI.
import assert from 'node:assert/strict'; import fs from 'node:fs/promises';
import { session, check, finish, base, fixture, evidence, files, packData, pubs, db, environment, runtime } from './lib.mjs';
const { p, errors, act, c } = await session('Editor'); const j = async r => ({ status: r.status(), body: await r.json().catch(() => null) }); let gid;
const tab = re => p.locator('.tabs button').filter({ hasText: re }).click();
await check('Regression: Generate social posts still produces a Radar pack (stub worker) with AI controls and no custom UI', async () => {
  await p.goto(base + '/social'); await p.getByRole('button', { name: 'Generate social posts', exact: true }).first().click();
  await p.getByPlaceholder('e.g. Why most freelancers undercharge in their first year').fill('A calendar based routine for tracking freelance project time');
  await p.getByRole('button', { name: 'Continue', exact: true }).click(); await p.getByRole('heading', { name: 'Where will you post?', exact: true }).waitFor(); await p.getByRole('button', { name: 'Continue', exact: true }).click(); await p.getByRole('button', { name: 'Continue', exact: true }).click();
  await p.getByRole('button', { name: /^Generate \d+ posts?$/ }).click(); await p.waitForURL(/pack=/, { timeout: 90000 }); gid = new URL(p.url()).searchParams.get('pack'); await p.getByText(/^From an idea/).waitFor();
  const d = await packData(gid); assert.equal(d.source.kind, 'idea'); const keys = Object.keys(d.posts); assert(keys.includes('x') && keys.includes('linkedin'), keys.join()); assert(!d.posts.x.author);
  await tab(/^X$/); const text = await p.locator('.page').innerText(); assert(!/Written by you/.test(text)); assert(/Regenerate/.test(text) && /Style/.test(text) && /Describe your image/.test(text));
  assert.equal(await p.locator('input[type=file]').count(), 0, 'no upload control on generated packs'); assert.equal(await p.getByLabel('Image style').count(), 1); await p.screenshot({ path: evidence + '/l1-generated-pack.png', fullPage: true }); return { gid, platforms: keys };
}, p);
await check('Regression: Regenerate text and Style still work on a generated pack', async () => {
  const before = await packData(gid); const resp = p.waitForResponse(r => r.url().endsWith('/act') && r.request().postDataJSON()?.action === 'social.regenText', { timeout: 60000 });
  await p.getByRole('button', { name: 'Regenerate', exact: true }).first().click(); const r = await resp; assert.equal(r.status(), 200); for (let i = 0; i < 40; i++) { if ((await packData(gid)).posts.x.v !== before.posts.x.v) break; await p.waitForTimeout(250); }
  const after = await packData(gid); assert.notEqual(after.posts.x.v, before.posts.x.v);
  const st = await j(await act('social.style', { packId: gid, platform: 'x', style: 'minimal' })); const img = await j(await act('social.regenImage', { packId: gid, platform: 'x' }));
  return { regenText: 200, textChanged: after.posts.x.text !== before.posts.x.text, style: `${st.status} ${st.body?.error || 'ok'}`, regenImage: `${img.status} ${img.body?.error || 'ok'}` };
}, p);
await check('Regression: generated pack still schedules (UI) and posts now with Radar’s rendered image; custom-only actions refuse it', async () => {
  await p.reload(); await p.getByText(/^From an idea/).waitFor(); await tab(/^X$/); await p.getByRole('button', { name: 'Schedule', exact: true }).click(); const m = p.getByRole('dialog', { name: 'Schedule X post', exact: true }); await m.waitFor(); await m.getByRole('radio').nth(1).click(); await m.getByLabel('Time', { exact: true }).selectOption('15:00'); await m.getByRole('button', { name: /^Schedule for/ }).click(); await m.waitFor({ state: 'hidden' });
  let row; for (let i = 0; i < 40; i++) { row = (await pubs(gid)).find(r => r.platform === 'x'); if (row) break; await p.waitForTimeout(250); } assert.equal(row.status, 'scheduled'); assert.equal(row.time, '15:00');
  await p.reload(); await p.getByText(/^From an idea/).waitFor(); await tab(/^X$/); const s = await p.getByText(/^Scheduled · /).innerText(); assert(/3:00 PM GST/.test(s), s);
  const W = await (await c.request.get(`${base}/api/b/${fixture.businessId}/workspace`)).json(); const li = W.social.accounts.find(a => a.ch === 'li_profile').id;
  const now = await j(await act('social.postNow', { sid: `s:${gid}:linkedin`, acctId: li })); assert.equal(now.status, 200, JSON.stringify(now)); assert.equal(now.body.data.pub.status, 'posted');
  const lr = (await pubs(gid)).find(r => r.platform === 'linkedin'); assert.equal(lr.payload.media.length, 1, 'generated post still sends its rendered image'); const d = await packData(gid); assert(d.posts.linkedin.imageUrl, 'rendered image stored');
  const up = await j(await c.request.post(`${base}/api/b/${fixture.businessId}/social-image`, { headers: { origin: base }, multipart: { packId: gid, platform: 'x', file: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: await fs.readFile(files + '/landscape.jpg') } } })); const rm = await j(await act('social.imageRemove', { packId: gid, platform: 'x' }));
  assert.equal(up.status, 409); assert.equal(up.body.code, 'not_custom'); assert.equal(rm.status, 409);
  await act('social.unschedule', { sid: `s:${gid}:x` });
  return { scheduled: s, postNowMedia: lr.payload.media.map(x => x.type), uploadToGenerated: `${up.status} ${up.body.error}`, removeOnGenerated: `${rm.status} ${rm.body.code}` };
}, p);
await check('C7 Automatic scheduling code skips a custom pack and still schedules a generated one; custom send target is never AI-labelled or rendered', async () => {
  Object.assign(process.env, environment);
  const { autoSchedule } = await import('../../../src/server/services/social/publish/schedule.ts'); const { loadTarget } = await import('../../../src/server/services/social/publish/pubs.ts'); const { pool } = await import('../../../src/server/db/index.ts');
  const cid = (await j(await act('social.createCustom', { name: 'QA auto untouched', posts: [{ platform: 'x', text: 'Mine, do not auto schedule' }, { platform: 'linkedin', text: 'Mine too' }] }))).body.data.packId;
  const prev = (await db.query('SELECT social_auto FROM businesses WHERE id=$1', [fixture.businessId])).rows[0].social_auto;
  await db.query('UPDATE businesses SET social_auto=$2 WHERE id=$1', [fixture.businessId, { ...prev, post: 'schedule' }]);
  let nCustom, nGen; try { nCustom = await autoSchedule(fixture.businessId, cid); nGen = await autoSchedule(fixture.businessId, gid, { platforms: ['x'] }); } finally { await db.query('UPDATE businesses SET social_auto=$2 WHERE id=$1', [fixture.businessId, prev]); }
  assert.equal(nCustom, 0); assert.equal((await pubs(cid)).length, 0); assert.equal(nGen, 1, 'generated pack auto-schedules as before'); await act('social.unschedule', { sid: `s:${gid}:x` });
  const before = await packData(cid);
  const H = JSON.parse(await fs.readFile(runtime + '/headline-pack.json', 'utf8')).packId; const t1 = await loadTarget(fixture.businessId, `s:${cid}:x`), t2 = await loadTarget(fixture.businessId, `s:${H}:linkedin`), t3 = await loadTarget(fixture.businessId, `s:${gid}:x`);
  assert.equal(t1.aiMedia, false); assert.equal(t1.needsRender, false); assert.deepEqual(t1.images, []); assert.equal(t2.aiMedia, false); assert.equal(t2.images.length, 1); assert.equal(t2.needsRender, false);
  assert.deepEqual(await packData(cid), before); await pool.end();
  return { autoScheduleCustom: nCustom, autoScheduleGenerated: nGen, customTextOnly: { aiMedia: t1.aiMedia, needsRender: t1.needsRender, images: t1.images.length }, customWithImage: { aiMedia: t2.aiMedia, images: t2.images.length }, generatedForComparison: { aiMedia: t3.aiMedia, needsRender: t3.needsRender, images: t3.images.length } };
});
await check('C5 Past time in the Schedule window (business zone moved to Pacific/Auckland for this check, then restored)', async () => {
  const cid = (await j(await act('social.createCustom', { name: 'QA past time', posts: [{ platform: 'x', text: 'Past time check' }] }))).body.data.packId;
  await db.query("UPDATE businesses SET timezone='Pacific/Auckland' WHERE id=$1", [fixture.businessId]);
  try {
    await p.goto(`${base}/social?pack=${cid}`); await p.getByText(/Written by you/).waitFor(); await p.getByRole('button', { name: 'Schedule', exact: true }).click(); const m = p.getByRole('dialog', { name: 'Schedule X post', exact: true }); await m.waitFor();
    await m.getByRole('radio').nth(0).click(); await m.getByLabel('Time', { exact: true }).selectOption('06:00'); await m.getByText('That time has passed. Pick a later time.').waitFor(); assert(await m.getByRole('button', { name: /^Schedule for/ }).isDisabled()); const zone = (await m.innerText()).split('\n').find(l => /Times are in/.test(l)); await p.screenshot({ path: evidence + '/l2-past-time.png' });
    return { zone, nowThere: new Intl.DateTimeFormat('en-GB', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit' }).format(new Date()) };
  } finally { await db.query("UPDATE businesses SET timezone='Asia/Dubai' WHERE id=$1", [fixture.businessId]); }
}, p);
await check('C10 Library search finds a custom pack by its X text and its LinkedIn text; generated card is not marked Written by you', async () => {
  await p.goto(base + '/social'); await p.getByRole('heading', { name: 'Content library', exact: true }).waitFor(); const s = p.getByRole('searchbox', { name: 'Search saved packs', exact: true }); const out = {};
  for (const q of ['Text only X post from QA', 'Text only LinkedIn post', 'QA text only', 'Mine, do not auto schedule']) { await s.fill(q); await p.waitForTimeout(350); out[q] = (await p.getByRole('article').allInnerTexts()).map(t => t.split('\n').filter(Boolean)[2] || t.split('\n')[0]); }
  await s.fill('calendar based routine'); await p.waitForTimeout(350); const g = await p.getByRole('article').first().innerText(); out.generatedCard = g.replace(/\n+/g, ' | ').slice(0, 200); assert(!/Written by you/.test(g));
  for (const q of ['Text only X post from QA', 'Text only LinkedIn post', 'QA text only', 'Mine, do not auto schedule']) assert.equal(out[q].length, 1, q + ' → ' + JSON.stringify(out[q])); return out;
}, p);
await check('No page errors', async () => { assert.deepEqual(errors.filter(e => !/status of 4\d\d/.test(e)), []); });
await finish('l-regression-results.json');
