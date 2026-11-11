// Supplied design reference only; no production mutations.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const base = process.env.REFERENCE_URL || 'http://127.0.0.1:3920';
const output = '.factory/feature-pages-blog/qa/reference';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const failures = [];
page.on('response', response => { if (response.status() >= 400) failures.push({ url: response.url(), status: response.status() }); });
page.on('pageerror', error => failures.push({ error: error.message }));
const records = [];
for (const path of ['/features/daily-brief.html', '/features/social-marketing.html', '/features/performance.html', '/blog/index.html', '/blog/does-chatgpt-recommend-you.html', '/blog/page-two-refresh.html']) {
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  const name = path.replace(/^\//, '').replace(/\//g, '-').replace('.html', '');
  await page.screenshot({ path: `${output}/${name}.jpg`, quality: 75, type: 'jpeg' });
  records.push(await page.evaluate(() => ({ path: location.pathname, scrollY, title: document.title, h1: [...document.querySelectorAll('h1')].map(x => x.textContent), sections: [...document.querySelectorAll('h2')].map(x => x.textContent), footerColumns: document.querySelectorAll('.foot-col').length, demo: ['br', 'sx', 'pm'].filter(x => document.querySelector('.' + x)), overflow: document.documentElement.scrollWidth > innerWidth, nav: document.querySelector('header.nav')?.textContent, bodyTextLength: document.body.innerText.length })));
}
await page.goto(base + '/features/daily-brief.html', { waitUntil: 'networkidle' });
await page.locator('.dd').hover();
await page.screenshot({ path: `${output}/features-dropdown.jpg`, quality: 75, type: 'jpeg' });
await page.locator('footer').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${output}/footer-desktop.jpg`, quality: 75, type: 'jpeg' });
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base + '/blog/does-chatgpt-recommend-you.html', { waitUntil: 'networkidle' });
await page.screenshot({ path: `${output}/post-mobile.jpg`, quality: 75, type: 'jpeg' });
await page.locator('footer').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${output}/footer-mobile.jpg`, quality: 75, type: 'jpeg' });
await fs.writeFile(`${output}/facts.json`, JSON.stringify({ base, records, failures }, null, 2) + '\n');
console.log(JSON.stringify({ pages: records.length, failures, records }, null, 2));
await browser.close();
