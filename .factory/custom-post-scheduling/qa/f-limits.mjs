// C3 limits and counting (UI + server), C5 past time / partial failure, C7 no AI controls + 409 custom_pack.
import assert from 'node:assert/strict';
import { session, check, finish, base, fixture, db, evidence, packData, pubs } from './lib.mjs';
const { p, errors, act, c } = await session('Editor');
const ws = async () => (await c.request.get(`${base}/api/b/${fixture.businessId}/workspace`)).json();
const W = await ws(); const acct = ch => W.social.accounts.find(a => a.ch === ch).id; const tomorrow = new Date(Date.parse(W.today + 'T12:00Z') + 864e5).toISOString().slice(0, 10);
const j = async r => ({ status: r.status(), body: await r.json().catch(() => null) });
const tab = re => p.locator('.tabs button').filter({ hasText: re }).click();
// Expected X weights from X's published rules, not from the app: CJK and emoji weigh 2, any URL weighs 23.
const cases = [
  ['ascii 280', 'a'.repeat(280), 280], ['ascii 281', 'a'.repeat(281), 281],
  ['emoji x140', '😀'.repeat(140), 280], ['emoji x141', '😀'.repeat(141), 282],
  ['cjk x140', '漢'.repeat(140), 280], ['cjk x141', '漢'.repeat(141), 282],
  ['long url', 'a'.repeat(256) + ' https://example.com/' + 'p'.repeat(120), 280], ['long url +1', 'a'.repeat(257) + ' https://example.com/' + 'p'.repeat(120), 281],
  ['two urls', 'see https://a.example/x and http://b.example/y?z=1', 4 + 23 + 5 + 23],
  ['bare domain', 'visit example.com today', 6 + 23 + 6],
  ['zwj family emoji', '👨‍👩‍👧‍👦 ok', 2 + 3], ['flag', '🇦🇪', 2], ['mixed', 'Launch 🚀 東京 https://t.test/a', 7 + 2 + 1 + 4 + 1 + 23],
];
await check('C3 Composer X counter follows X weighting for ASCII, emoji, CJK and links; over-limit says by how much', async () => {
  await p.goto(base + '/social?write=1'); const d = p.getByRole('dialog', { name: 'Write a post', exact: true }); await d.waitFor(); const x = d.getByLabel('X post text', { exact: true }); const out = []; const bad = [];
  for (const [name, text, want] of cases) {
    await x.fill(text); const id = (await x.getAttribute('aria-describedby')).split(' '); const counter = await p.locator('#' + CSS_escape(id[0])).innerText(); const msg = await p.locator('#' + CSS_escape(id[1])).innerText().catch(() => '');
    const used = Number(/^([\d,]+) \/ 280/.exec(counter)[1].replace(',', '')); out.push({ name, want, used, counter, msg });
    if (used !== want) bad.push({ name, want, used });
    if (want > 280) { if (!counter.includes(`${want - 280} over`) || !msg.includes(`Shorten by ${want - 280} character`)) bad.push({ name, counter, msg }); } else if (/over/.test(counter)) bad.push({ name, counter });
  }
  await p.screenshot({ path: evidence + '/f1-composer-over.png' }); assert.deepEqual(bad, [], JSON.stringify(out)); return out.map(o => `${o.name}: ${o.counter}`);
}, p);
function CSS_escape(s) { return s.replace(/([^a-zA-Z0-9_-])/g, '\\$1'); }
let L;
await check('C3 Over-limit X and empty LinkedIn can be saved; PackView blocks Post now/Schedule with a message', async () => {
  const d = p.getByRole('dialog', { name: 'Write a post', exact: true }); await d.getByLabel('Name (optional)').fill('QA limits');
  await d.getByLabel('X post text', { exact: true }).fill('漢'.repeat(141)); await d.getByLabel('LinkedIn post text', { exact: true }).fill('   ');
  await d.getByRole('button', { name: 'Save post', exact: true }).click(); await p.waitForURL(/pack=/); L = new URL(p.url()).searchParams.get('pack'); await p.getByText(/Written by you/).waitFor();
  assert.equal((await packData(L)).posts.x.text, '漢'.repeat(141));
  await tab(/^X$/); const side = await p.locator('.pack-side').innerText(); assert(/Shorten to 280 characters to post on X\. It’s 282 now\./.test(side), side);
  await p.getByText('282 / 280 · 2 over').waitFor(); await p.getByText('Shorten by 2 characters to post on X.', { exact: false }).waitFor();
  assert(await p.getByRole('button', { name: 'Post now', exact: true }).isDisabled()); assert(await p.getByRole('button', { name: 'Schedule', exact: true }).isDisabled());
  await p.screenshot({ path: evidence + '/f2-pack-x-over.png', fullPage: true });
  await tab('LinkedIn'); const side2 = await p.locator('.pack-side').innerText(); assert(/Write something to post/.test(side2), side2);
  assert(await p.getByRole('button', { name: 'Post now', exact: true }).isDisabled()); assert(await p.getByRole('button', { name: 'Schedule', exact: true }).isDisabled());
  await p.getByRole('button', { name: 'Schedule all', exact: true }).click(); const m = p.getByRole('dialog', { name: 'Schedule this pack', exact: true }); const mt = await m.innerText(); await p.screenshot({ path: evidence + '/f3-schedule-all-blocked.png' });
  const btn = m.getByRole('button', { name: 'Nothing to schedule', exact: true }); const dis = await btn.isDisabled(); assert(dis); assert.equal((mt.match(/Fix issues first/g) || []).length, 2); await p.keyboard.press('Escape');
  return { scheduleAll: mt.replace(/\n+/g, ' | ').slice(0, 300), scheduleAllDisabled: dis };
}, p);
await check('C3 Server refuses over-limit and empty text at schedule, post now and schedule all', async () => {
  const out = {};
  out.scheduleX = await j(await act('social.schedule', { sid: `s:${L}:x`, date: tomorrow, time: '12:00', acctId: acct('x') }));
  out.postNowX = await j(await act('social.postNow', { sid: `s:${L}:x`, acctId: acct('x') }));
  out.scheduleLiEmpty = await j(await act('social.schedule', { sid: `s:${L}:linkedin`, date: tomorrow, time: '12:00', acctId: acct('li_profile') }));
  out.postNowLiEmpty = await j(await act('social.postNow', { sid: `s:${L}:linkedin`, acctId: acct('li_profile') }));
  out.scheduleAll = await j(await act('social.scheduleAll', { packId: L, date: tomorrow, rows: [{ platform: 'x', time: '09:00', acctId: acct('x') }, { platform: 'linkedin', time: '10:00', acctId: acct('li_profile') }] }));
  for (const [k, v] of Object.entries(out)) assert(v.status >= 400 && v.status < 500 && v.body?.ok === false, k + ' ' + JSON.stringify(v));
  assert.equal((await pubs(L)).length, 0, 'nothing scheduled or sent'); return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, `${v.status} ${v.body.code || ''} ${v.body.error}`]));
});
await check('C5 Past time refused (UI and server); partial failure in Schedule all names the platform and schedules nothing; fixing one platform schedules only it', async () => {
  await act('social.text', { packId: L, platform: 'linkedin', text: 'Valid LinkedIn text now.' });
  const past = await j(await act('social.schedule', { sid: `s:${L}:linkedin`, date: W.today, time: '00:00', acctId: acct('li_profile') }));
  const yesterday = new Date(Date.parse(W.today + 'T12:00Z') - 864e5).toISOString().slice(0, 10); const past2 = await j(await act('social.schedule', { sid: `s:${L}:linkedin`, date: yesterday, time: '12:00', acctId: acct('li_profile') }));
  assert(past.status >= 400 && past2.status >= 400, JSON.stringify([past, past2]));
  const all = await j(await act('social.scheduleAll', { packId: L, date: tomorrow, rows: [{ platform: 'linkedin', time: '10:00', acctId: acct('li_profile') }, { platform: 'x', time: '09:00', acctId: acct('x') }] }));
  assert(all.status >= 400, JSON.stringify(all)); assert.equal((await pubs(L)).length, 0, 'all or nothing'); assert(/X/.test(all.body.error), 'names the platform: ' + all.body.error);
  // UI: today with an early time shows the passed warning and disables the button
  await p.reload(); await p.getByText(/Written by you/).waitFor(); await tab('LinkedIn'); await p.getByRole('button', { name: 'Schedule', exact: true }).click(); const m = p.getByRole('dialog', { name: 'Schedule LinkedIn post', exact: true }); await m.waitFor();
  await m.getByRole('radio').nth(0).click(); const opts = await m.getByLabel('Time', { exact: true }).locator('option').evaluateAll(o => o.map(x => x.value)); await m.getByLabel('Time', { exact: true }).selectOption(opts[0]);
  const nowHM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' }).format(new Date()); let uiPast = 'first slot not past at ' + nowHM;
  if (opts[0] < nowHM) { await m.getByText('That time has passed. Pick a later time.').waitFor(); assert(await m.getByRole('button', { name: /^Schedule for/ }).isDisabled()); uiPast = 'warning shown, button disabled'; await p.screenshot({ path: evidence + '/f4-past-time.png' }); }
  await m.getByRole('radio').nth(1).click(); await m.getByLabel('Time', { exact: true }).selectOption('11:00'); await m.getByRole('button', { name: /^Schedule for/ }).click(); await m.waitFor({ state: 'hidden' });
  for (let i = 0; i < 40 && !(await pubs(L)).length; i++) await p.waitForTimeout(250);
  const rows = await pubs(L); assert.equal(rows.length, 1); assert.equal(rows[0].platform, 'linkedin');
  await act('social.unschedule', { sid: `s:${L}:linkedin` });
  return { pastToday: `${past.status} ${past.body.error}`, pastYesterday: `${past2.status} ${past2.body.error}`, scheduleAllPartial: `${all.status} ${all.body.error}`, uiPast };
}, p);
await check('C7 Custom pack shows no Regenerate / Style / Describe your image / explainer controls on any tab; header says Written by you', async () => {
  const r = await j(await act('social.createCustom', { name: 'QA controls check', posts: ['linkedin', 'x', 'instagram', 'tiktok', 'youtube', 'facebook', 'reddit', 'quora'].map(k => ({ platform: k, text: 'My own words for ' + k })) })); assert.equal(r.status, 200, JSON.stringify(r)); const id = r.body.data.packId;
  await p.goto(`${base}/social?pack=${id}`); await p.getByText(/Written by you/).waitFor(); const seen = {};
  for (const l of ['LinkedIn', 'X', 'Instagram', 'TikTok', 'YouTube', 'Facebook', 'Reddit', 'Quora']) {
    await tab(new RegExp('^' + l + '$')); await p.waitForTimeout(150); const text = await p.locator('.page').innerText();
    const hits = ['Regenerate', 'Style', 'Describe your image', 'Generate image', 'Generate explainer', 'Explainer', 'explainer', 'disclosure', 'Prepared by Radar', 'AI'].filter(w => new RegExp('\\b' + w + '\\b').test(text));
    const controls = await p.locator('.page').getByRole('button').allInnerTexts(); seen[l] = { hits, controls: controls.map(t => t.trim()).filter(Boolean).filter(t => !['LinkedIn', 'X', 'Instagram', 'TikTok', 'YouTube', 'Facebook', 'Reddit', 'Quora'].includes(t)) };
    assert.deepEqual(hits, [], l + ': ' + hits); assert.equal(await p.getByLabel('Image style').count(), 0);
  }
  await p.screenshot({ path: evidence + '/f5-custom-no-ai.png', fullPage: true });
  const before = await packData(id); const refusals = {};
  for (const [name, input] of [['social.regenText', { packId: id, platform: 'x' }], ['social.regenImage', { packId: id, platform: 'x' }], ['social.regenImage', { packId: id, platform: 'x', prompt: 'A building' }], ['social.style', { packId: id, platform: 'x', style: 'photography' }],
    ['social.mediaPrepare', { packId: id, platforms: ['instagram'] }], ['social.mediaGenerate', { packId: id, choices: [{ platform: 'instagram', format: 'video' }] }], ['social.mediaStyle', { packId: id, platform: 'instagram', videoStyle: 'kinetic', expectedMediaRevision: 0 }], ['social.compress', { sid: `s:${id}:x` }]]) {
    const v = await j(await act(name, input)); refusals[name + (input.prompt ? '+prompt' : '')] = `${v.status} ${v.body?.code} ${v.body?.error}`;
    if (name !== 'social.compress') { assert.equal(v.status, 409, name + JSON.stringify(v)); assert.equal(v.body.code, 'custom_pack'); }
  }
  assert.deepEqual(await packData(id), before, 'pack unchanged by refused actions');
  const jobs = (await db.query("SELECT kind FROM jobs WHERE business_id=$1", [fixture.businessId])).rows.filter(x => /generate|media|image/.test(x.kind)); assert.equal(jobs.length, 0, JSON.stringify(jobs));
  return { id, seen, refusals };
}, p);
await check('No page errors', async () => { assert.deepEqual(errors, []); });
await finish('f-limits-results.json');
