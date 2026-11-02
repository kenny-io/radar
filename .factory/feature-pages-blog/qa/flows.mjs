// Real-browser public demo/navigation checks. Clipboard success/failure uses a controlled promise, not the OS clipboard.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const base = (process.env.BASE_URL || 'http://localhost:3930').replace(/\/$/, '');
const qa = '.factory/feature-pages-blog/qa';
const result = { atUTC: new Date().toISOString(), base, revision: process.env.QA_REVISION || 'working-tree', passed: [], failed: [], mutations: [], downloads: [], note: 'Public anonymous Chrome; clipboard promises controlled in page memory for deterministic async/error coverage; no native OS clipboard claim.' };
async function check(name, fn) { try { await fn(); result.passed.push(name); } catch (error) { result.failed.push({ name, message: error.message, stack: error.stack }); console.error(name + ': ' + error.stack); } }
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
await context.addInitScript(() => {
  window.__qaClipboard = { text: '', deny: false, defer: false, resolve: null };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: text => {
    window.__qaClipboard.text = text;
    if (window.__qaClipboard.deny) return Promise.reject(new Error('QA denied clipboard'));
    if (window.__qaClipboard.defer) return new Promise(resolve => { window.__qaClipboard.resolve = resolve; });
    return Promise.resolve();
  } } });
});
const page = await context.newPage();
page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) result.mutations.push({ method: request.method(), url: request.url() }); });
await check('Blog Latest card follows the hero without duplicate section padding', async () => {
  await page.goto(base + '/blog', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.bl-f')).transform === 'none');
  const geometry = await page.evaluate(() => ({ heroBottom: document.querySelector('.bl-hero').getBoundingClientRect().bottom, cardTop: document.querySelector('.bl-f').getBoundingClientRect().top }));
  const reference = JSON.parse(await fs.readFile(`${qa}/reference-blog-geometry.json`, 'utf8')); const expectedGap = reference.cardTop - reference.heroBottom;
  assert(Math.abs((geometry.cardTop - geometry.heroBottom) - expectedGap) <= 2, 'Latest card has extra padding beyond the supplied hero spacing'); result.blogLatestGeometry = { ...geometry, expectedGap };
});
await check('Features hover bridge, keyboard navigation and active marker', async () => {
  await page.goto(base + '/features/daily-brief', { waitUntil: 'networkidle' });
  const trigger = page.locator('.dd > a'), panel = page.locator('.dd-p');
  assert.equal(await trigger.getAttribute('aria-current'), 'page'); assert.equal(await panel.locator('a[aria-current="page"]').getAttribute('href'), '/features/daily-brief');
  await trigger.hover(); await page.waitForFunction(() => getComputedStyle(document.querySelector('.dd-p')).visibility === 'visible');
  const t = await trigger.boundingBox(), p = await panel.boundingBox(); await page.mouse.move(t.x + t.width / 2, (t.y + t.height + p.y) / 2); assert(await panel.isVisible(), 'pointer bridge closed dropdown');
  await page.mouse.move(p.x + 30, p.y + 25); assert(await panel.isVisible(), 'pointer entry closed dropdown');
  await page.mouse.move(20, 400); await trigger.focus(); await page.waitForFunction(() => getComputedStyle(document.querySelector('.dd-p')).visibility === 'visible'); assert(await panel.isVisible(), 'focused trigger did not open dropdown'); await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('href')), '/features/daily-brief');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('href')), '/features/backlinks'); await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Pricing');
  await page.goto(base + '/blog', { waitUntil: 'networkidle' }); assert.equal(await page.locator('header nav a[href="/blog"]').getAttribute('aria-current'), 'page'); assert.equal(await page.locator('.dd > a').getAttribute('aria-current'), null);
});
await check('Daily Brief async copy, posted, undo and style reset', async () => {
  await page.goto(base + '/features/daily-brief', { waitUntil: 'networkidle' });
  await page.evaluate(() => { window.__qaClipboard.defer = true; }); await page.locator('#br-b').click();
  assert.equal(await page.locator('#br-b').textContent(), 'Copying…'); assert(!/Copied/.test(await page.locator('.br-st').innerText()));
  await page.evaluate(() => { window.__qaClipboard.resolve(); }); await page.waitForFunction(() => document.querySelector('#br-b').textContent === 'I posted it');
  assert.equal(await page.evaluate(() => window.__qaClipboard.text), await page.locator('#br-x').textContent()); assert(!/https?:\/\//.test(await page.locator('#br-x').textContent()));
  await page.locator('#br-b').click(); assert.match(await page.locator('.br-st').innerText(), /Posted/); assert(await page.locator('.br-u').isVisible()); await page.waitForFunction(() => document.activeElement?.textContent === 'Undo'); assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Undo');
  await page.locator('.br-u').click(); assert.equal(await page.locator('#br-b').textContent(), 'Copy reply'); await page.waitForFunction(() => document.activeElement?.id === 'br-b'); assert.equal(await page.evaluate(() => document.activeElement?.id), 'br-b');
  await page.getByRole('button', { name: 'Mention Fieldnote', exact: true }).click(); assert.equal(await page.getByRole('button', { name: 'Mention Fieldnote', exact: true }).getAttribute('aria-pressed'), 'true'); assert.match(await page.locator('#br-x').innerText(), /I work on Fieldnote/); assert.match(await page.locator('.br-f').first().innerText(), /disclose/);
});
await check('Daily Brief clipboard denial and stale async completion are honest', async () => {
  await page.evaluate(() => { window.__qaClipboard.defer = false; window.__qaClipboard.deny = true; }); await page.locator('#br-b').click(); await page.getByRole('status').filter({ hasText: 'Copy unavailable' }).waitFor();
  assert.equal(await page.locator('#br-b').textContent(), 'Copy reply'); assert(!/Copied/.test(await page.locator('.br-st').innerText()));
  await page.evaluate(() => { window.__qaClipboard.deny = false; window.__qaClipboard.defer = true; }); await page.locator('#br-b').click(); await page.getByRole('button', { name: 'Just help', exact: true }).click(); await page.evaluate(() => window.__qaClipboard.resolve());
  await page.waitForTimeout(50); assert.equal(await page.locator('#br-b').textContent(), 'Copy reply'); assert.equal(await page.locator('.br-st').innerText(), '');
});
await check('Social roving tabs, platform actions, length and visual ratios', async () => {
  await page.goto(base + '/features/social-marketing', { waitUntil: 'networkidle' });
  const tabs = page.locator('#sx [role="tab"]'); assert.equal(await tabs.count(), 5);
  const names = ['LinkedIn', 'X', 'Facebook', 'Reddit', 'Quora'], ratios = [1.91, 16 / 9, 1.91, 4 / 3, 1.91];
  for (let i = 0; i < names.length; i++) {
    await tabs.nth(i).click(); assert.equal(await tabs.nth(i).getAttribute('aria-selected'), 'true'); assert.equal(await page.locator('#sx [role="tab"][tabindex="0"]').count(), 1);
    assert.match(await page.locator('.sx-h .who').innerText(), new RegExp(names[i] + ' preview')); const box = await page.locator('.sx-v').boundingBox(); assert(Math.abs(box.width / box.height - ratios[i]) < .03, 'incorrect visual ratio for ' + names[i]);
    if (i < 2) { const text = await page.locator('.sx-x').textContent(); assert((await page.locator('.sx-f').innerText()).includes(text.length.toLocaleString('en-US') + ' / ' + (i === 0 ? '3,000' : '280'))); assert(await page.getByRole('button', { name: 'Post now', exact: true }).isVisible()); assert(await page.getByRole('button', { name: 'Schedule', exact: true }).isVisible()); }
    else { assert.match(await page.locator('.sx-f').innerText(), new RegExp('Copy and paste for ' + names[i])); assert(await page.getByRole('button', { name: 'Copy text', exact: true }).isVisible()); assert(await page.getByRole('button', { name: 'Download image', exact: true }).isVisible()); }
  }
  await tabs.first().click(); await page.keyboard.press('ArrowLeft'); assert.equal(await tabs.last().getAttribute('aria-selected'), 'true'); assert.equal(await tabs.last().evaluate(x => x === document.activeElement), true); await page.keyboard.press('ArrowRight'); assert.equal(await tabs.first().getAttribute('aria-selected'), 'true');
  await page.getByRole('button', { name: 'Post now', exact: true }).click(); assert.match(await page.locator('#sx [role="status"]').innerText(), /Demo only.*No post was sent/); await page.getByRole('button', { name: 'Schedule', exact: true }).click(); assert.match(await page.locator('#sx [role="status"]').innerText(), /Demo only.*No post was scheduled/);
});
await check('Social copy and actual PNG download stay local', async () => {
  await page.locator('#sx [role="tab"]').nth(3).click(); await page.getByRole('button', { name: 'Copy text', exact: true }).click(); assert.equal(await page.evaluate(() => window.__qaClipboard.text), await page.locator('.sx-x').textContent()); assert.match(await page.locator('#sx [role="status"]').innerText(), /Copied/);
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download image', exact: true }).click(); const download = await downloadPromise; const target = `${qa}/${process.env.QA_SCREEN_PREFIX || 'integrated'}-${download.suggestedFilename()}`; await download.saveAs(target); const png = await fs.readFile(target);
  assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))); assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 900); result.downloads.push({ filename: download.suggestedFilename(), bytes: png.length, width: 1200, height: 900 });
});
await check('Performance keyboard, seeded series, inverted position and refresh', async () => {
  await page.goto(base + '/features/performance', { waitUntil: 'networkidle' }); const tabs = page.locator('#pm [role="tab"]'); assert.equal(await tabs.count(), 4); const values = [];
  for (let i = 0; i < 4; i++) { await tabs.nth(i).click(); assert.equal(await tabs.nth(i).getAttribute('aria-selected'), 'true'); assert.equal(await page.locator('#pm [role="tab"][tabindex="0"]').count(), 1); const path = await page.locator('#pm path.ln').getAttribute('d'); assert.equal([...path.matchAll(/[ML]/g)].length, 28); assert(!/NaN|Infinity|undefined/.test(path)); values.push(path); }
  assert.equal(new Set(values).size, 4); const points = [...values[3].matchAll(/[ML]([\d.]+) ([\d.]+)/g)]; assert(Number(points[0][2]) > Number(points.at(-1)[2]), 'improving lower positions should draw upward');
  await tabs.last().focus(); await page.keyboard.press('ArrowRight'); assert.equal(await tabs.first().getAttribute('aria-selected'), 'true'); await page.reload({ waitUntil: 'networkidle' }); assert.equal(await page.locator('#pm path.ln').getAttribute('d'), values[0]);
});
await check('Blog sticky contents, contrast, CTA and mobile contents policy', async () => {
  await page.goto(base + '/blog/does-chatgpt-recommend-you', { waitUntil: 'networkidle' }); assert.equal(await page.locator('.po-toc').evaluate(x => getComputedStyle(x).position), 'sticky');
  const ids = await page.locator('.po-toc a').evaluateAll(xs => xs.map(x => x.hash.slice(1))); assert.equal(ids.length, 5);
  for (const id of ids) { await page.locator('#' + id).evaluate(x => window.scrollTo({ top: scrollY + x.getBoundingClientRect().top - 120, behavior: 'instant' })); await page.waitForFunction(expected => document.querySelector('.po-toc a[aria-current="location"]')?.getAttribute('href') === '#' + expected, id); }
  const cta = page.locator('.po-cta a'); await cta.scrollIntoViewIfNeeded(); const colors = await cta.evaluate(x => ({ color: getComputedStyle(x).color, background: getComputedStyle(x).backgroundColor })); assert.match(colors.color, /255, 255, 255/); assert(!/255, 255, 255|0, 0, 0, 0/.test(colors.background));
  await cta.click(); await page.waitForURL('**/features/ai-visibility'); await page.goBack({ waitUntil: 'networkidle' }); assert.match(page.url(), /\/blog\/does-chatgpt-recommend-you/); await page.reload({ waitUntil: 'networkidle' }); assert.equal(await page.locator('h1').count(), 1);
  await page.setViewportSize({ width: 1000, height: 1000 }); assert.equal(await page.locator('.po-toc').evaluate(x => getComputedStyle(x).display), 'none'); await page.setViewportSize({ width: 1440, height: 1000 });
});
await check('Invalid domain validation does not start analysis', async () => {
  await page.goto(base + '/features/daily-brief', { waitUntil: 'networkidle' }); const before = page.url(); const field = page.locator('input[name="domain"]').first(); await field.fill('not a valid domain'); await page.getByRole('button', { name: 'Analyze website', exact: true }).first().click(); assert.equal(page.url(), before); assert.match(await page.locator('.dom-note.err').innerText(), /Enter your website/); assert.equal(await field.evaluate(x => x === document.activeElement), true);
});
await check('Reduced motion keeps social and performance demos static', async () => {
  await page.goto(base + '/features/social-marketing', { waitUntil: 'networkidle' }); const before = await page.locator('#sx [aria-selected="true"]').textContent(); await page.waitForTimeout(4200); assert.equal(await page.locator('#sx [aria-selected="true"]').textContent(), before); assert.equal(await page.locator('.sx-x').evaluate(x => getComputedStyle(x).animationName), 'none');
  await page.goto(base + '/features/performance', { waitUntil: 'networkidle' }); await page.locator('#pm').scrollIntoViewIfNeeded(); await page.waitForTimeout(100); assert.equal(await page.locator('#pm path.ln').evaluate(x => getComputedStyle(x).transitionDuration), '0s'); assert.equal(await page.locator('#pm path.ln').evaluate(x => getComputedStyle(x).strokeDashoffset), '0px');
});
await context.close();
const motionContext = await browser.newContext({ viewport: { width: 1440, height: 200 }, reducedMotion: 'no-preference' }); const motionPage = await motionContext.newPage();
motionPage.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) result.mutations.push({ method: request.method(), url: request.url() }); });
await check('Social autoplay starts visible and interaction permanently stops it', async () => {
  await motionPage.goto(base + '/features/social-marketing', { waitUntil: 'networkidle' });
  const ratio = await motionPage.locator('#sx').evaluate(x => { const r = x.getBoundingClientRect(); window.scrollTo({ top: scrollY + r.top - (innerHeight - Math.min(r.height * .2, innerHeight * .8)), behavior: 'instant' }); const q = x.getBoundingClientRect(); return Math.max(0, Math.min(q.bottom, innerHeight) - Math.max(q.top, 0)) / q.height; });
  assert(ratio > 0 && ratio < .35, 'partial-visibility setup must be below35%'); const partial = await motionPage.locator('#sx [aria-selected="true"]').textContent(); await motionPage.waitForTimeout(4200); assert.equal(await motionPage.locator('#sx [aria-selected="true"]').textContent(), partial, 'autoplay started before35% visibility');
  await motionPage.setViewportSize({ width: 1440, height: 1000 }); await motionPage.locator('#sx').scrollIntoViewIfNeeded(); const start = await motionPage.locator('#sx [aria-selected="true"]').textContent(); await motionPage.waitForFunction(previous => document.querySelector('#sx [aria-selected="true"]')?.textContent !== previous, start, { timeout: 6000 });
  await motionPage.getByRole('tab', { name: 'Facebook', exact: true }).click(); const selected = await motionPage.locator('#sx [aria-selected="true"]').textContent(); await motionPage.waitForTimeout(4200); assert.equal(await motionPage.locator('#sx [aria-selected="true"]').textContent(), selected);
});
await motionContext.close(); await browser.close();
await check('No account, analysis or publishing mutations', () => assert.deepEqual(result.mutations, []));
await fs.writeFile(process.env.QA_OUTPUT || `${qa}/flows.json`, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ base, passed: result.passed.length, failed: result.failed, downloads: result.downloads }, null, 2));
if (result.failed.length) process.exitCode = 1;
