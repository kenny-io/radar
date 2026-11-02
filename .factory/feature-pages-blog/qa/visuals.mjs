// Fresh-page visual evidence: avoid history/scroll-restoration effects in a sequential matrix.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = (process.env.BASE_URL || 'http://localhost:3930').replace(/\/$/, '');
const dir = `.factory/feature-pages-blog/qa/${process.env.QA_SCREEN_PREFIX || 'visual-local'}`;
await fs.mkdir(dir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pages = ['/features/daily-brief', '/features/social-marketing', '/features/performance', '/blog', '/blog/does-chatgpt-recommend-you', '/blog/page-two-refresh'];
const records = [];
for (const width of [1440, 390]) {
  for (const path of pages) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' }); const page = await context.newPage();
    await page.goto(base + path, { waitUntil: 'networkidle' }); await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await page.waitForTimeout(200);
    if (await page.evaluate(() => scrollY !== 0)) { await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await page.waitForTimeout(200); }
    const facts = await page.evaluate(() => ({ scrollY, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, nav: (() => { const e = document.querySelector('header.nav'), r = e.getBoundingClientRect(), s = getComputedStyle(e); return { top: r.top, height: r.height, display: s.display, visibility: s.visibility, opacity: s.opacity, position: s.position, zIndex: s.zIndex }; })(), h1: document.querySelector('h1')?.textContent, latestCardTop: document.querySelector('.bl-f')?.getBoundingClientRect().top, footerColumns: getComputedStyle(document.querySelector('.foot-g')).gridTemplateColumns.split(' ').length }));
    assert.equal(facts.scrollY, 0, 'visual capture must begin at settled scrollY0'); assert(facts.documentWidth <= width + 1);
    const name = path.slice(1).replaceAll('/', '-'); await page.screenshot({ path: `${dir}/${width}-${name}.jpg`, quality: 80, type: 'jpeg' });
    if (path === '/features/daily-brief') { await page.locator('footer').scrollIntoViewIfNeeded(); await page.mouse.move(10, 500); await page.waitForTimeout(100); await page.screenshot({ path: `${dir}/${width}-footer.jpg`, quality: 80, type: 'jpeg' }); }
    records.push({ path, width, ...facts }); await context.close();
  }
}
await browser.close(); await fs.writeFile(`${dir}/facts.json`, JSON.stringify({ base, revision: process.env.QA_REVISION || 'working-tree', records }, null, 2) + '\n');
console.log(JSON.stringify({ base, captures: records.length, records }, null, 2));
