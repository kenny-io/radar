// C1: calendar month grid and dashboard WeekStrip.
import assert from 'node:assert/strict';
import { session, check, finish, base, evidence } from './lib.mjs';
const { p, errors } = await session('Editor');
await check('C1 Calendar and WeekStrip show both posts on tomorrow at their own times', async () => {
  await p.goto(base + '/calendar'); await p.getByText('12p', { exact: true }).waitFor();
  await p.screenshot({ path: evidence + '/a7-calendar.png', fullPage: true });
  const chips = await p.locator('[draggable=true]').evaluateAll(els => els.filter(e => /^\d+p$/.test(e.innerText.trim())).map(e => ({ text: e.innerText.trim(), label: e.getAttribute('aria-label') || e.getAttribute('title') || '', day: e.parentElement.parentElement.innerText.split('\n')[0] })));
  await p.goto(base + '/dashboard'); await p.locator('.wk').waitFor();
  const days = await p.locator('.wk-d').allInnerTexts(); await p.locator('.wk').screenshot({ path: evidence + '/a8-weekstrip.png' });
  assert(/12p/.test(days[1]) && /2p/.test(days[1]), 'weekstrip tomorrow: ' + days[1]); assert(!/Thally/.test(days[0]), 'nothing today');
  assert.equal(chips.length, 2); assert(chips.some(c => /12p/.test(c.text)) && chips.some(c => /\b2p/.test(c.text)), JSON.stringify(chips));
  return { calendarChips: chips, weekTomorrow: days[1].replace(/\n+/g, ' | ') };
}, p);
await check('No page errors', async () => { assert.deepEqual(errors, []); });
await finish('c-calendar-results.json');
