// Prepare two more custom packs through the browser for the worker run: T (text-only, Schedule all) and E (edited after scheduling).
import assert from 'node:assert/strict'; import fs from 'node:fs/promises';
import { session, check, finish, base, evidence, files, packData, pubs, runtime } from './lib.mjs';
const { p, errors } = await session('Editor'); const ids = {};
const compose = async (name, texts) => {
  await p.goto(base + '/social?write=1'); const d = p.getByRole('dialog', { name: 'Write a post', exact: true }); await d.waitFor();
  await d.getByLabel('Name (optional)').fill(name);
  for (const [l, t] of Object.entries(texts)) await d.getByLabel(`${l} post text`, { exact: true }).fill(t);
  await d.getByRole('button', { name: 'Save post', exact: true }).click(); await p.waitForURL(/pack=/); await p.getByText(/Written by you/).waitFor();
  assert(!p.url().includes('write='), 'write param cleared'); return new URL(p.url()).searchParams.get('pack');
};
const tab = re => p.locator('.tabs button').filter({ hasText: re }).click();
const waitPub = async (id, k, pred) => { for (let i = 0; i < 40; i++) { const r = (await pubs(id)).find(x => x.platform === k); if (r && pred(r)) return r; await p.waitForTimeout(250); } throw Error('pub row not reached for ' + k); };
await check('C1/C5 Text-only pack: named post, Schedule all with a time per platform, toast and rows', async () => {
  ids.T = await compose('QA text only', { LinkedIn: 'Text only LinkedIn post from QA. No image attached.', X: 'Text only X post from QA. No image attached.' });
  assert.equal(await p.locator('h1').first().innerText(), 'QA text only');
  await p.getByText('No image · text-only post').first().waitFor();
  await p.getByRole('button', { name: 'Schedule all', exact: true }).click(); const m = p.getByRole('dialog', { name: 'Schedule this pack', exact: true }); await m.waitFor();
  await m.getByLabel('LinkedIn time', { exact: true }).selectOption('16:30'); await m.getByLabel('X time', { exact: true }).selectOption('07:30');
  const text = await m.innerText(); assert(/Gulf|GST/.test(text)); await p.screenshot({ path: evidence + '/d1-schedule-all.png' });
  await m.getByRole('button', { name: /^Schedule/ }).last().click(); await m.waitFor({ state: 'hidden' });
  const li = await waitPub(ids.T, 'linkedin', r => r.status === 'scheduled'), x = await waitPub(ids.T, 'x', r => r.status === 'scheduled');
  assert.equal(li.time, '16:30'); assert.equal(x.time, '07:30'); const data = await packData(ids.T); assert.equal(data.posts.x.imageUrl, null); assert.equal(data.posts.linkedin.imageUrl, null);
  return { id: ids.T, li: [li.date, li.time], x: [x.date, x.time] };
}, p);
await check('C6 Pack E: schedule, then edit text and replace image after scheduling; over-limit X shows Fix-before warning', async () => {
  ids.E = await compose('QA edit after schedule', { LinkedIn: 'LinkedIn BEFORE edit', X: 'X before edit' });
  await tab('LinkedIn'); await p.getByLabel('Upload image for LinkedIn', { exact: true }).setInputFiles(files + '/landscape.jpg'); await p.getByRole('img', { name: 'Your image for LinkedIn' }).waitFor();
  for (const [label, re] of [['LinkedIn', 'LinkedIn'], ['X', /^X$/]]) {
    await tab(re); await p.getByRole('button', { name: 'Schedule', exact: true }).click(); const m = p.getByRole('dialog', { name: `Schedule ${label} post`, exact: true }); await m.waitFor();
    await m.getByRole('radio').nth(1).click(); await m.getByLabel('Time', { exact: true }).selectOption('10:00'); await m.getByRole('button', { name: /^Schedule for/ }).click(); await m.waitFor({ state: 'hidden' });
    await waitPub(ids.E, label === 'X' ? 'x' : 'linkedin', r => r.status === 'scheduled');
  }
  const before = await packData(ids.E);
  await tab('LinkedIn'); await p.getByLabel('LinkedIn post text', { exact: true }).fill('LinkedIn AFTER edit — this is what must be sent.');
  await p.getByLabel('Upload image for LinkedIn', { exact: true }).setInputFiles(files + '/second.png');
  await p.waitForFunction(() => true); for (let i = 0; i < 40; i++) { const d = await packData(ids.E); if (d.posts.linkedin.imageMeta?.type === 'image/png' && /AFTER/.test(d.posts.linkedin.text)) break; await p.waitForTimeout(250); }
  const mid = await packData(ids.E); assert.equal(mid.posts.linkedin.imageMeta.type, 'image/png'); assert.notEqual(mid.posts.linkedin.imageUrl, before.posts.linkedin.imageUrl); assert(/AFTER/.test(mid.posts.linkedin.text));
  assert.equal((await pubs(ids.E)).find(r => r.platform === 'linkedin').status, 'scheduled', 'still scheduled after edit');
  await tab(/^X$/); const long = 'Over limit after scheduling ' + 'x'.repeat(280); await p.getByLabel('X post text', { exact: true }).fill(long);
  await p.getByText(/Fix this before .* or it won’t post\./).waitFor(); const side = await p.locator('.pack-side').innerText();
  assert(/Shorten to 280 characters to post on X/.test(side), side); assert(await p.getByRole('button', { name: 'Reschedule', exact: true }).isDisabled().catch(() => 'no reschedule button'));
  assert(await p.getByRole('button', { name: 'Unschedule', exact: true }).isEnabled());
  await p.screenshot({ path: evidence + '/d2-edited-over-limit-scheduled.png', fullPage: true });
  for (let i = 0; i < 40; i++) { if ((await packData(ids.E)).posts.x.text === long) break; await p.waitForTimeout(250); }
  assert.equal((await packData(ids.E)).posts.x.text, long, 'over-limit text saved verbatim');
  return { id: ids.E, counter: (await p.getByText(/\/ 280/).first().innerText()), side: side.replace(/\n+/g, ' | ').slice(0, 400) };
}, p);
await fs.writeFile(runtime + '/worker-packs.json', JSON.stringify(ids));
await check('No page errors', async () => { assert.deepEqual(errors, []); });
await finish('d-prepare-results.json');
