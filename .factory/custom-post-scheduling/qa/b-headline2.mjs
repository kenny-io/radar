// C1 continued (same pack as a-headline): schedule X at 12:00, reload, library, calendar, WeekStrip.
import assert from 'node:assert/strict'; import fs from 'node:fs/promises';
import { session, check, finish, base, fixture, evidence, pubs, runtime } from './lib.mjs';
const { packId, tomorrow } = JSON.parse(await fs.readFile(runtime + '/headline-pack.json', 'utf8'));
const { p, errors } = await session('Editor');
await check('C1/C5 Schedule X tomorrow 12:00; LinkedIn row untouched; zone label shown', async () => {
  const before = (await pubs(packId)).find(r => r.platform === 'linkedin');
  await p.goto(`${base}/social?pack=${packId}`); await p.getByText(/Written by you/).waitFor();
  await p.locator('.tabs button').filter({ hasText: /^X$/ }).click();
  await p.getByRole('button', { name: 'Schedule', exact: true }).click();
  const m = p.getByRole('dialog', { name: 'Schedule X post', exact: true }); await m.waitFor();
  await m.getByRole('radio').nth(1).click(); await m.getByLabel('Time', { exact: true }).selectOption('12:00');
  const text = await m.innerText(); await p.screenshot({ path: evidence + '/a4-schedule-X.png' });
  assert(/GST/.test(text) && /Gulf/.test(text), 'zone label: ' + text);
  await m.getByRole('button', { name: /^Schedule for/ }).click(); await m.waitFor({ state: 'hidden' });
  await p.getByRole('button', { name: 'Unschedule', exact: true }).waitFor();
  const rows = await pubs(packId); const li = rows.find(r => r.platform === 'linkedin'), x = rows.find(r => r.platform === 'x');
  assert.equal(li.status, 'scheduled'); assert.equal(li.date, tomorrow); assert.equal(li.time, '14:00'); assert.equal(new Date(li.due_at).toISOString(), tomorrow + 'T10:00:00.000Z');
  assert.equal(new Date(li.due_at).getTime(), new Date(before.due_at).getTime());
  assert.equal(x.status, 'scheduled'); assert.equal(x.date, tomorrow); assert.equal(x.time, '12:00'); assert.equal(new Date(x.due_at).toISOString(), tomorrow + 'T08:00:00.000Z');
  return { modal: text.replace(/\n+/g, ' | ').slice(-260), li: [li.date, li.time, li.due_at], x: [x.date, x.time, x.due_at] };
}, p);
await check('C1 After reload both stay scheduled at their own times in the pack', async () => {
  await p.reload(); await p.getByText(/Written by you/).waitFor();
  await p.locator('.tabs button').filter({ hasText: 'LinkedIn' }).click(); const a = await p.getByText(/^Scheduled · /).innerText(); assert(/2:00 PM/.test(a) && /GST/.test(a), a);
  await p.screenshot({ path: evidence + '/a5-reload-linkedin.png', fullPage: true });
  await p.locator('.tabs button').filter({ hasText: /^X$/ }).click(); const b = await p.getByText(/^Scheduled · /).innerText(); assert(/12:00 PM/.test(b) && /GST/.test(b), b);
  await p.screenshot({ path: evidence + '/a5-reload-x.png', fullPage: true });
  return { linkedin: a, x: b };
}, p);
await check('C1/C10 Library Scheduled filter shows the pack with the uploaded image thumbnail', async () => {
  await p.goto(base + '/social'); await p.getByRole('heading', { name: 'Content library', exact: true }).waitFor();
  await p.getByRole('button', { name: /^Scheduled \(/ }).click(); await p.waitForURL(/status=scheduled/);
  await p.reload(); await p.getByRole('heading', { name: 'Content library', exact: true }).waitFor();
  const card = p.getByRole('article'); assert.equal(await card.count(), 1); const text = await card.innerText(); assert(/2 scheduled/.test(text), text);
  const ok = await card.locator('img').first().evaluate(i => i.complete && i.naturalWidth > 0);  assert(ok, 'thumbnail image loads');
  await p.screenshot({ path: evidence + '/a6-library-scheduled.png', fullPage: true });
  await p.getByRole('button', { name: /^Drafts \(/ }).click(); const drafts = await p.getByRole('article').count(); assert.equal(drafts, 0);
  return { card: text.replace(/\n+/g, ' | '), drafts };
}, p);
await check('C1 Calendar month grid and dashboard WeekStrip show both posts on tomorrow at their own times', async () => {
  await p.goto(base + '/calendar'); await p.locator('[draggable=true]').first().waitFor();
  await p.screenshot({ path: evidence + '/a7-calendar.png', fullPage: true });
  const chips = (await p.locator('[draggable=true]').allInnerTexts()).map(t => t.replace(/\n+/g, ' '));
  const titles = await p.locator('[draggable=true]').evaluateAll(els => els.map(e => (e.getAttribute('aria-label') || e.getAttribute('title') || '')));
  await p.goto(base + '/dashboard'); await p.locator('.wk').waitFor();
  const days = await p.locator('.wk-d').allInnerTexts(); await p.locator('.wk').screenshot({ path: evidence + '/a8-weekstrip.png' });
  assert(/12p/.test(days[1]) && /2p/.test(days[1]), 'weekstrip tomorrow: ' + days[1]); assert(!/Thally/.test(days[0]), 'nothing today');
  assert(chips.filter(t => /Thally/.test(t)).length >= 2, 'calendar chips: ' + JSON.stringify(chips));
  return { calendarChips: chips, titles, weekTomorrow: days[1].replace(/\n+/g, ' | ') };
}, p);
await check('No page errors', async () => { assert.deepEqual(errors, []); });
await finish('b-headline2-results.json');
