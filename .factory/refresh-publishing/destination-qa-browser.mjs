import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire('/Users/ekene/.codex/worktrees/radar-refresh-publishing/radar-push/package.json');
const { chromium } = require('playwright');
const [origin, expectedPath, outputPath] = process.argv.slice(2);
const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
const route = '/rent/dubai/1-bedroom-apartments';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const results = [];
try {
  const response = await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
  assert.equal(response.status(), 200);
  await page.locator('#article-body h2').first().waitFor({ state: 'visible' });
  const content = await page.locator('#article-body').evaluate((el, html) => { const box = document.createElement('div'); box.innerHTML = html; return { sameMarkup: el.innerHTML === box.innerHTML, bodyCount: document.querySelectorAll('#article-body').length, headingCount: el.querySelectorAll('h2,h3').length, canonical: document.querySelector('link[rel=canonical]')?.href }; }, expected.html);
  assert.equal(content.sameMarkup, true); assert.equal(content.bodyCount, 1);
  assert.equal(new URL(content.canonical).pathname, route);
  assert.ok(await page.getByText('Editorial estimates by area', { exact: true }).isVisible());
  assert.ok(await page.getByText('Frequently asked', { exact: true }).isVisible());
  assert.ok(await page.getByText('Keep exploring', { exact: true }).isVisible());
  results.push({ scenario: 'Desktop route, complete article and preserved content', ...content, passed: true });

  const sort = page.getByRole('button', { name: 'Priciest first', exact: true }); await sort.click();
  assert.equal(await sort.getAttribute('aria-pressed'), 'true');
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('#article-body').evaluate((el, html) => { const box = document.createElement('div'); box.innerHTML = html; return el.innerHTML === box.innerHTML; }, expected.html), true);
  results.push({ scenario: 'Preserved price sorting and fresh-load persistence', passed: true });

  await page.goto(origin + '/rent/dubai', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.documentElement.classList.contains('lvt-lock'));
  const link = page.locator(`a[href="${route}"]`).first(); await link.focus(); await link.press('Enter');
  await page.waitForURL(origin + route, { waitUntil: 'domcontentloaded' }); await page.locator('#article-body').waitFor({ state: 'visible' });
  results.push({ scenario: 'Keyboard navigation from original directory', passed: true });

  await page.goto(origin + '/rent/dubai/apartments', { waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('#article-body').count(), 0);
  assert.ok(await page.getByRole('heading', { name: 'How to find the right apartment in Dubai', exact: true }).isVisible());
  results.push({ scenario: 'Unchanged peer legacy rendering', passed: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
  await page.locator('#article-body').scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
  assert.ok(overflow.width <= overflow.viewport + 1, JSON.stringify(overflow));
  const images = page.locator('#article-body img');
  const imageResults = [];
  for (let i = 0; i < await images.count(); i++) { const img = images.nth(i); await img.scrollIntoViewIfNeeded(); await img.evaluate(el => Promise.race([el.decode(), new Promise((_, reject) => setTimeout(() => reject(new Error('Article image decode timed out')), 15000))])); imageResults.push(await img.evaluate(el => ({ naturalWidth: el.naturalWidth, width: el.getBoundingClientRect().width, alt: el.alt }))); }
  assert.ok(imageResults.every(i => i.naturalWidth > 0 && i.width <= 390));
  await page.locator('#article-body').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/radar-destination-qa-mobile.png' });
  results.push({ scenario: 'Mobile complete-body layout and image loading', ...overflow, images: imageResults, passed: true });
  assert.deepEqual(errors, []);
  const result = { status: 'passed', origin, mode: 'Exact accepted live-model proposal, local focused production build; no deployed preview claim', results, pageErrors: errors };
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(JSON.stringify({url:page.url(),errors,done:results.map(r=>r.scenario),state:await page.evaluate(()=>({state:document.documentElement.dataset.lvtState,active:document.activeElement?.outerHTML.slice(0,300)}))})); await page.screenshot({ path: '/tmp/radar-destination-qa-failure.png' }); throw error; }
finally { await browser.close(); }
