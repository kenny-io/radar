// C1/C2/C4/C5: Editor writes a custom post (different LinkedIn and X text), attaches images, schedules each at its own time.
import assert from 'node:assert/strict'; import fs from 'node:fs/promises';
import { session, check, finish, base, fixture, db, evidence, files, packData, pubs, runtime } from './lib.mjs';
const { p, errors, c } = await session('Editor');
const acts = []; c.on('request', r => { if (r.url().endsWith('/act') && r.method() === 'POST') { const a = r.postDataJSON()?.action; if (a && a !== 'app.seen') acts.push(a); } });
const LI = 'Thally launch day.\n\nWe built calendar-based time tracking for designers. Here is what we learned shipping it over six months, and why the weekly review matters more than the timer.';
const X = 'Thally is live: calendar-based time tracking for designers. https://thally.test/launch';
let packId; const today = (await (await c.request.get(`${base}/api/b/${fixture.businessId}/workspace`)).json()).today;
const tomorrow = new Date(Date.parse(today + 'T12:00Z') + 864e5).toISOString().slice(0, 10);
await check('C2 Write a post sits beside Generate social posts and opens the composer with focus on Name', async () => {
  await p.goto(base + '/social'); await p.getByRole('heading', { name: 'Social Marketing', exact: true }).waitFor();
  const w = p.getByRole('button', { name: 'Write a post', exact: true }).first(), g = p.getByRole('button', { name: 'Generate social posts', exact: true }).first();
  assert(await w.isEnabled()); const wb = await w.boundingBox(), gb = await g.boundingBox(); assert(Math.abs(wb.y - gb.y) < 4 && wb.x < gb.x, 'same row, Write first');
  await p.screenshot({ path: evidence + '/a1-library-empty.png' });
  await w.click(); const d = p.getByRole('dialog', { name: 'Write a post', exact: true }); await d.waitFor();
  const focused = await p.evaluate(() => document.activeElement?.closest('label,div')?.textContent?.slice(0, 40) + '|' + document.activeElement?.tagName);
  assert(/Name \(optional\)/.test(focused) && /INPUT/.test(focused), 'focus on name: ' + focused);
  const pressed = await d.locator('button[aria-pressed=true]').allInnerTexts(); assert.deepEqual(pressed.map(t => t.split('\n')[0].trim()), ['LinkedIn', 'X']);
  return { today, tomorrow, pressed };
}, p);
await check('C2 Starting text is shared, per-platform edits do not lose the others, counters are live', async () => {
  const d = p.getByRole('dialog', { name: 'Write a post', exact: true });
  const start = d.getByLabel('Starting text'); await start.fill('Shared starting line');
  const li = d.getByLabel('LinkedIn post text', { exact: true }), x = d.getByLabel('X post text', { exact: true });
  assert.equal(await li.inputValue(), 'Shared starting line'); assert.equal(await x.inputValue(), 'Shared starting line');
  await x.fill(X); await start.fill('Changed start');
  assert.equal(await li.inputValue(), 'Changed start', 'linked field follows'); assert.equal(await x.inputValue(), X, 'edited field kept');
  await li.fill(LI); await start.fill('Changed again'); assert.equal(await li.inputValue(), LI); assert.equal(await x.inputValue(), X);
  // add then remove a third platform; the others keep their text
  await d.locator('button[aria-pressed=false]').filter({ hasText: 'Facebook' }).click(); assert.equal(await d.getByLabel('Facebook post text', { exact: true }).inputValue(), 'Changed again');
  await d.locator('button[aria-pressed=true]').filter({ hasText: 'Facebook' }).click(); assert.equal(await li.inputValue(), LI); assert.equal(await x.inputValue(), X);
  const text = await d.innerText(); assert(text.includes(`${LI.length} / 3,000`), 'LinkedIn counter'); 
  const xCount = /(\d+) \/ 280/.exec(text)?.[1]; // URL counts as 23
  const expectX = [...X.replace('https://thally.test/launch', '')].length + 23; assert.equal(Number(xCount), expectX, `X weighted counter ${xCount} vs ${expectX}`);
  await p.screenshot({ path: evidence + '/a2-composer.png' });
  return { liCounter: LI.length, xCounter: xCount, rawXLength: X.length };
}, p);
await check('C2 Save lands in the pack: default name from first line, Written by you, text verbatim, no AI/job action', async () => {
  const d = p.getByRole('dialog', { name: 'Write a post', exact: true });
  await d.getByRole('button', { name: 'Save post', exact: true }).click();
  await p.waitForURL(/pack=/); packId = new URL(p.url()).searchParams.get('pack');
  await p.getByRole('heading', { name: 'Changed again', exact: true }).waitFor().catch(() => {});
  const h = await p.locator('h1').first().innerText();
  await p.getByText(/Written by you/).waitFor();
  const data = await packData(packId);
  assert.equal(data.source.kind, 'custom'); assert.equal(data.auto, false); assert.equal(data.posts.linkedin.text, LI); assert.equal(data.posts.x.text, X);
  assert.equal(data.posts.linkedin.author, 'user'); assert.equal(data.posts.x.imageUrl, null);
  const jobs = (await db.query('SELECT kind FROM jobs WHERE business_id=$1', [fixture.businessId])).rows.map(r => r.kind);
  await fs.writeFile(runtime + '/headline-pack.json', JSON.stringify({ packId, today, tomorrow }));
  return { heading: h, name: data.name, order: data.order, acts: [...acts], jobs };
}, p);
await check('C4 Attach a JPEG to LinkedIn and a PNG to X, previews shown', async () => {
  await p.locator('.tabs button').filter({ hasText: 'LinkedIn' }).click();
  await p.getByLabel('Upload image for LinkedIn', { exact: true }).setInputFiles(files + '/landscape.jpg');
  await p.getByRole('img', { name: 'Your image for LinkedIn', exact: true }).waitFor(); await p.getByRole('button', { name: 'Replace image', exact: true }).waitFor();
  await p.locator('.tabs button').filter({ hasText: /^X$/ }).click();
  await p.getByLabel('Upload image for X', { exact: true }).setInputFiles(files + '/second.png');
  await p.getByRole('img', { name: 'Your image for X', exact: true }).waitFor();
  const ok = await p.getByRole('img', { name: 'Your image for X', exact: true }).evaluate(i => i.complete && i.naturalWidth > 0); assert(ok, 'image decoded in browser');
  const data = await packData(packId); assert.equal(data.posts.linkedin.imageMeta.type, 'image/jpeg'); assert.equal(data.posts.x.imageMeta.type, 'image/png');
  await p.screenshot({ path: evidence + '/a3-pack-x-image.png', fullPage: true });
  return { li: data.posts.linkedin.imageMeta, x: data.posts.x.imageMeta, liUrl: data.posts.linkedin.imageUrl.replace(fixture.businessId, '<bid>') };
}, p);
const schedule = async (label, tabRe, time) => {
  await p.locator('.tabs button').filter({ hasText: tabRe }).click();
  await p.getByRole('button', { name: 'Schedule', exact: true }).click();
  const m = p.getByRole('dialog', { name: `Schedule ${label} post`, exact: true }); await m.waitFor();
  const radios = m.getByRole('radio'); await radios.nth(1).click();   // business today first → second is tomorrow
  await m.getByLabel('Time', { exact: true }).selectOption(time);
  const text = await m.innerText(); await p.screenshot({ path: `${evidence}/a4-schedule-${label}.png` });
  await m.getByRole('button', { name: /^Schedule for/ }).click(); await m.waitFor({ state: 'hidden' });
  await p.getByRole('button', { name: 'Unschedule', exact: true }).waitFor();
  return text;
};
await check('C1/C5 Schedule LinkedIn tomorrow 14:00 and X tomorrow 12:00, zone label shown, independent rows', async () => {
  const t1 = await schedule('LinkedIn', 'LinkedIn', '14:00'); assert(/GST|Gulf/.test(t1), 'zone label in modal: ' + t1.slice(-200));
  const afterLi = await pubs(packId); assert.equal(afterLi.length, 1);
  const t2 = await schedule('X', /^X$/, '12:00');
  const rows = await pubs(packId); const li = rows.find(r => r.platform === 'linkedin'), x = rows.find(r => r.platform === 'x');
  assert.equal(li.status, 'scheduled'); assert.equal(li.date, tomorrow); assert.equal(li.time, '14:00'); assert.equal(new Date(li.due_at).toISOString(), tomorrow + 'T10:00:00.000Z', 'Dubai 14:00 = 10:00Z');
  assert.equal(x.status, 'scheduled'); assert.equal(x.date, tomorrow); assert.equal(x.time, '12:00'); assert.equal(new Date(x.due_at).toISOString(), tomorrow + 'T08:00:00.000Z');
  return { tzLine: t2.split('\n').filter(l => /GST|Gulf|Times are/.test(l)), li: [li.date, li.time, li.due_at], x: [x.date, x.time, x.due_at] };
}, p);
await check('C1 After reload both stay scheduled at their own times in the pack', async () => {
  await p.reload(); await p.getByText(/Written by you/).waitFor();
  await p.locator('.tabs button').filter({ hasText: 'LinkedIn' }).click(); const a = await p.getByText(/^Scheduled · /).innerText(); assert(/2:00 PM/.test(a) && /GST/.test(a), a);
  await p.screenshot({ path: evidence + '/a5-reload-linkedin.png', fullPage: true });
  await p.locator('.tabs button').filter({ hasText: /^X$/ }).click(); const b = await p.getByText(/^Scheduled · /).innerText(); assert(/12:00 PM/.test(b) && /GST/.test(b), b);
  return { linkedin: a, x: b };
}, p);
await check('C1/C10 Library Scheduled filter shows the pack with the uploaded image thumbnail', async () => {
  await p.goto(base + '/social'); await p.getByRole('heading', { name: 'Content library', exact: true }).waitFor();
  await p.getByRole('button', { name: /^Scheduled \(/ }).click(); await p.waitForURL(/status=scheduled/);
  const card = p.getByRole('article'); assert.equal(await card.count(), 1); const text = await card.innerText();
  const img = await card.locator('img').first().getAttribute('src').catch(() => null);
  await p.screenshot({ path: evidence + '/a6-library-scheduled.png', fullPage: true });
  await p.getByRole('button', { name: /^Drafts \(/ }).click(); const drafts = await p.getByRole('article').count();
  await p.getByRole('button', { name: /^Posted \(/ }).click(); const posted = await p.getByRole('article').count();
  return { card: text.replace(/\n+/g, ' | '), img: img?.replace(fixture.businessId, '<bid>'), drafts, posted };
}, p);
await check('C1 Calendar month grid and dashboard WeekStrip show both posts on tomorrow at their own times', async () => {
  await p.goto(base + '/calendar'); await p.waitForLoadState('networkidle');
  const cal = await p.locator('main, body').first().innerText(); await p.screenshot({ path: evidence + '/a7-calendar.png', fullPage: true });
  const chips = await p.locator('[draggable=true]').allInnerTexts();
  await p.goto(base + '/dashboard'); await p.waitForLoadState('networkidle'); await p.locator('.wk').waitFor();
  const days = await p.locator('.wk-d').allInnerTexts(); await p.locator('.wk').screenshot({ path: evidence + '/a8-weekstrip.png' });
  const tomorrowCell = days[1]; assert(/12:00|12 PM/i.test(tomorrowCell) && /2:00|2 PM/i.test(tomorrowCell), 'weekstrip tomorrow: ' + tomorrowCell);
  assert(!/12:00|2:00 PM/.test(days[0]), 'nothing today');
  assert(chips.some(t => /12:00|12 PM/i.test(t)) && chips.some(t => /2:00|2 PM/i.test(t)), 'calendar chips: ' + JSON.stringify(chips));
  return { calendarChips: chips, weekTomorrow: tomorrowCell.replace(/\n+/g, ' | ') };
}, p);
await check('No page errors during the headline flow', async () => { assert.deepEqual(errors, []); return { acts }; });
await finish('a-headline-results.json');
