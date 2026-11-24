// C11: keyboard-only composer, labels, polite counters, focus trap, dirty close; 375px no horizontal scroll (composer, pack, schedule windows, library).
import assert from 'node:assert/strict';
import { session, check, finish, base, evidence, files, packData, noHScroll, fixture } from './lib.mjs';
const { p, errors } = await session('Editor'); const K = p.keyboard; let id;
const active = () => p.evaluate(() => { const a = document.activeElement; return { tag: a.tagName, label: a.getAttribute('aria-label') || a.labels?.[0]?.innerText?.split('\n')[0] || a.innerText?.split('\n')[0]?.trim() || '', pressed: a.getAttribute('aria-pressed'), inDialog: !!a.closest('[role=dialog]') }; });
const tabTo = async (pred, max = 40) => { for (let i = 0; i < max; i++) { await K.press('Tab'); const a = await active(); if (pred(a)) return a; } throw Error('could not Tab to target; last: ' + JSON.stringify(await active())); };
await check('C11 Keyboard only: open composer, name, toggle platforms with Space, write per platform, save with Enter', async () => {
  await p.goto(base + '/social'); await p.getByRole('heading', { name: 'Social Marketing', exact: true }).waitFor(); await p.locator('body').click({ position: { x: 5, y: 5 } }); const trail = [];
  await tabTo(a => a.tag === 'BUTTON' && a.label === 'Write a post', 60); await K.press('Enter'); await p.getByRole('dialog', { name: 'Write a post', exact: true }).waitFor();
  let a = await active(); assert(a.tag === 'INPUT' && /Name/.test(a.label), JSON.stringify(a)); await K.type('Keyboard only post'); trail.push(a.label);
  a = await tabTo(x => x.pressed !== null && /^LinkedIn/.test(x.label)); assert.equal(a.pressed, 'true'); 
  a = await tabTo(x => x.pressed !== null && /^Facebook/.test(x.label)); await K.press('Space'); assert.equal((await active()).pressed, 'true', 'Space toggles on'); trail.push('Facebook on');
  a = await tabTo(x => x.pressed !== null && /^Reddit/.test(x.label)); await K.press('Enter'); assert.equal((await active()).pressed, 'true'); await K.press('Enter'); assert.equal((await active()).pressed, 'false', 'Enter toggles off'); trail.push('Reddit on/off');
  a = await tabTo(x => x.tag === 'TEXTAREA' && /Starting text/.test(x.label)); await K.type('Typed with the keyboard only.'); trail.push(a.label);
  a = await tabTo(x => x.tag === 'TEXTAREA' && x.label === 'LinkedIn post text'); await K.press('End'); await K.type(' LinkedIn extra.'); trail.push(a.label);
  a = await tabTo(x => x.tag === 'TEXTAREA' && x.label === 'X post text'); trail.push(a.label);
  a = await tabTo(x => x.tag === 'TEXTAREA' && x.label === 'Facebook post text'); trail.push(a.label);
  a = await tabTo(x => x.tag === 'BUTTON' && x.label === 'Save post'); await K.press('Enter'); await p.waitForURL(/pack=/); id = new URL(p.url()).searchParams.get('pack'); await p.getByText(/Written by you/).waitFor();
  const d = await packData(id); assert.equal(d.name, 'Keyboard only post'); assert.deepEqual(d.order, ['linkedin', 'x', 'facebook']); assert.equal(d.posts.linkedin.text, 'Typed with the keyboard only. LinkedIn extra.'); assert.equal(d.posts.x.text, 'Typed with the keyboard only.');
  return { trail, order: d.order };
}, p);
await check('C11 Focus stays in the dialog; Escape on a dirty composer asks before discarding; Keep writing keeps the text', async () => {
  await p.goto(base + '/social?write=1'); const d = p.getByRole('dialog', { name: 'Write a post', exact: true }); await d.waitFor();
  for (let i = 0; i < 45; i++) { await K.press('Tab'); assert((await active()).inDialog, 'focus left the dialog at Tab ' + i); } for (let i = 0; i < 10; i++) { await K.press('Shift+Tab'); assert((await active()).inDialog); }
  await d.getByLabel('Starting text').focus(); await K.type('Unsaved words'); await K.press('Escape'); const ask = p.getByRole('dialog', { name: 'Discard this post?', exact: true }); await ask.waitFor(); const f = await active(); assert.equal(f.label, 'Keep writing', JSON.stringify(f));
  await K.press('Enter'); await ask.waitFor({ state: 'hidden' }); assert.equal(await d.getByLabel('Starting text').inputValue(), 'Unsaved words');
  await K.press('Escape'); await ask.waitFor(); await ask.getByRole('button', { name: 'Discard', exact: true }).focus(); await K.press('Enter'); await d.waitFor({ state: 'hidden' }); assert(!p.url().includes('write='));
  await p.getByRole('button', { name: 'Write a post', exact: true }).first().click(); await d.waitFor(); await K.press('Escape'); await d.waitFor({ state: 'hidden' }); return { cleanEscapeCloses: true };
}, p);
await check('C11 Labels and announcements: every composer field has a name; counters are described and announced politely on state change only', async () => {
  await p.goto(base + '/social?write=1'); const d = p.getByRole('dialog', { name: 'Write a post', exact: true }); await d.waitFor();
  const unnamed = await d.locator('input:not([type=hidden]),textarea,select,button').evaluateAll(els => els.filter(e => !(e.getAttribute('aria-label') || e.labels?.length || e.innerText?.trim() || e.getAttribute('title') || e.getAttribute('aria-labelledby'))).map(e => e.outerHTML.slice(0, 120))); assert.deepEqual(unnamed, []);
  const group = await d.getByRole('group', { name: 'Platforms', exact: true }).count(); assert.equal(group, 1);
  const x = d.getByLabel('X post text', { exact: true }); const ids = (await x.getAttribute('aria-describedby')).split(' '); const live = d.locator('[aria-live=polite]'); const says = async () => (await live.allInnerTexts()).filter(Boolean);
  await x.fill('hello'); await p.waitForTimeout(150); const s1 = await says(); await x.fill('hello there'); await p.waitForTimeout(150); const s2 = await says();
  await x.fill('a'.repeat(285)); await p.waitForTimeout(150); const s3 = await says(); const desc = await p.evaluate(i => i.map(id => document.getElementById(id)?.innerText).join(' || '), ids);
  assert.deepEqual(s1, s2, 'no announcement per keystroke'); assert(s3.some(t => /X: 5 characters over the 280 limit/.test(t)), JSON.stringify(s3)); assert(/285 \/ 280 · 5 over/.test(desc) && /Shorten by 5 characters/.test(desc), desc);
  const color = await p.evaluate(i => getComputedStyle(document.getElementById(i)).color, ids[0]); await d.getByRole('button', { name: 'Close', exact: true }).click(); await p.getByRole('button', { name: 'Discard', exact: true }).click();
  return { liveAfterTyping: s1, liveAfterOver: s3, describedBy: desc, overColor: color };
}, p);
await check('C11 PackView by keyboard: editor is labelled and described; Upload image opens the file chooser from the keyboard', async () => {
  await p.goto(`${base}/social?pack=${id}`); await p.getByText(/Written by you/).waitFor(); const ta = p.getByLabel('LinkedIn post text', { exact: true }); const db = await ta.getAttribute('aria-describedby'); assert(db, 'aria-describedby on pack editor');
  const desc = await p.evaluate(i => i.split(' ').map(id => document.getElementById(id)?.innerText ?? 'MISSING').join(' || '), db); assert(!/MISSING/.test(desc), desc);
  const btn = p.getByRole('button', { name: 'Upload image', exact: true }); await btn.focus(); const fc = p.waitForEvent('filechooser'); await K.press('Enter'); const chooser = await fc; await chooser.setFiles(files + '/landscape.jpg'); await p.getByRole('img', { name: 'Your image for LinkedIn' }).waitFor();
  const status = await p.locator('section[aria-label="Media for LinkedIn"] [role=status]').count(); assert.equal(status, 1); await btn.or(p.getByRole('button', { name: 'Replace image', exact: true })).first().focus(); const fc2 = p.waitForEvent('filechooser'); await K.press('Space'); await fc2;
  return { describedBy: desc };
}, p);
await p.setViewportSize({ width: 375, height: 812 });
await check('C11 375px: composer has no horizontal scroll with long unbroken text and all platforms on; footer buttons reachable', async () => {
  await p.goto(base + '/social'); await p.getByRole('heading', { name: 'Social Marketing', exact: true }).waitFor(); assert(await noHScroll(p), 'library page scrolls sideways'); await p.screenshot({ path: evidence + '/k1-375-library.png', fullPage: true });
  await p.getByRole('button', { name: 'Write a post', exact: true }).first().click(); const d = p.getByRole('dialog', { name: 'Write a post', exact: true }); await d.waitFor();
  for (const l of ['Instagram', 'TikTok', 'YouTube', 'Facebook', 'Reddit', 'Quora']) await d.locator('button[aria-pressed=false]').filter({ hasText: l }).click();
  await d.getByLabel('Starting text').fill('https://example.com/' + 'averyveryverylongunbrokenpathsegment'.repeat(12) + ' ' + 'W'.repeat(400)); await d.getByLabel('Name (optional)').fill('N'.repeat(120));
  assert(await noHScroll(p), 'composer scrolls sideways'); const inner = await d.evaluate(el => [...el.querySelectorAll('*')].filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'hidden' && e.clientWidth > 0 && !['TEXTAREA', 'INPUT'].includes(e.tagName)).map(e => e.className + ':' + e.scrollWidth + '>' + e.clientWidth).slice(0, 5));
  const off = await d.locator('button,textarea,input').evaluateAll(els => els.map(e => e.getBoundingClientRect()).filter(r => r.width && (r.right > innerWidth + 1 || r.left < -1)).length); assert.equal(off, 0, 'controls cut off horizontally');
  await p.screenshot({ path: evidence + '/k2-375-composer.png' }); const save = d.getByRole('button', { name: 'Save post', exact: true }); await save.scrollIntoViewIfNeeded(); const box = await save.boundingBox(); assert(box.x >= 0 && box.x + box.width <= 376 && box.y + box.height <= 813, JSON.stringify(box));
  await p.screenshot({ path: evidence + '/k3-375-composer-foot.png' }); await save.click(); await p.waitForURL(/pack=/); await p.getByText(/Written by you/).waitFor(); return { innerOverflow: inner, saveBox: box };
}, p);
await check('C11 375px: custom pack view, Schedule window and Schedule all have no horizontal scroll', async () => {
  assert(await noHScroll(p), 'pack page scrolls sideways'); await p.screenshot({ path: evidence + '/k4-375-pack.png', fullPage: true }); const out = {};
  const tabs = await p.locator('.tabs').evaluate(e => ({ sw: e.scrollWidth, cw: e.clientWidth, ox: getComputedStyle(e).overflowX })); out.tabs = tabs;
  await p.locator('.tabs button').filter({ hasText: 'LinkedIn' }).click(); await p.getByLabel('Upload image for LinkedIn', { exact: true }).setInputFiles(files + '/landscape.jpg'); await p.getByRole('img', { name: 'Your image for LinkedIn' }).waitFor(); assert(await noHScroll(p));
  await p.getByRole('button', { name: 'Schedule', exact: true }).click(); const m = p.getByRole('dialog', { name: 'Schedule LinkedIn post', exact: true }); await m.waitFor(); assert(await noHScroll(p)); const mb = await m.boundingBox(); assert(mb.x >= 0 && mb.x + mb.width <= 376, JSON.stringify(mb)); await p.screenshot({ path: evidence + '/k5-375-schedule.png' }); await p.keyboard.press('Escape');
  await p.getByRole('button', { name: 'Schedule all', exact: true }).click(); const a = p.getByRole('dialog', { name: 'Schedule this pack', exact: true }); await a.waitFor(); assert(await noHScroll(p)); const ab = await a.boundingBox(); assert(ab.x >= 0 && ab.x + ab.width <= 376, JSON.stringify(ab));
  const cut = await a.locator('select,button').evaluateAll(els => els.map(e => e.getBoundingClientRect()).filter(r => r.width && r.right > innerWidth + 1).length); assert.equal(cut, 0); await p.screenshot({ path: evidence + '/k6-375-schedule-all.png' }); await p.keyboard.press('Escape'); return out;
}, p);
await check('No page errors', async () => { assert.deepEqual(errors.filter(e => !/status of 4\d\d/.test(e)), []); });
await finish('k-a11y-results.json');
