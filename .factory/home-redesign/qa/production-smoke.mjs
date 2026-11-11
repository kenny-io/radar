import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const errors = [], results = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.goto('http://localhost:3901', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('#features .t3-s').count(), 6);
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, index: getComputedStyle(document.querySelector('.t3-idx')).display, head: getComputedStyle(document.querySelector('#unseen .pg-head')).textAlign, autoplay: document.querySelector('.how').dataset.autoplay }));
    assert.equal(layout.width, layout.scrollWidth);
    assert.equal(layout.index, width === 1440 ? 'grid' : 'none');
    assert.equal(layout.head, width === 1440 ? 'center' : 'left');
    assert.equal(layout.autoplay, 'false');
    results.push(layout);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { const e = document.getElementById('t3'); scrollTo(0, e.getBoundingClientRect().top + scrollY + (e.offsetHeight - innerHeight) * 2.3 / 6); });
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.t3-s.on').getAttribute('aria-label'), 'AI Visibility');
  await page.screenshot({ path: '.factory/home-redesign/qa/production-story-1440.png' });
  await page.locator('.t3-s.on a').click();
  await page.waitForURL('**/features/ai-visibility');
  assert.equal(await page.locator('.mk.fp').count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 1440);
  assert.deepEqual(errors, []);
  await fs.writeFile('.factory/home-redesign/qa/production-smoke-results.json', JSON.stringify({ pass: true, results, errors }, null, 2));
  console.log('Production smoke passed: desktop/mobile styling, reduced motion, scroll story, feature client navigation, no browser errors.');
} finally { await browser.close(); }
