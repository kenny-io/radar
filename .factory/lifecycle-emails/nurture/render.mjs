import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { nurtureDrafts } from './copy.mjs';
const out = '.factory/lifecycle-emails/nurture/qa';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const logo = await readFile('public/brand/radar-mark-email.png');
const checks = [];
try {
  for (const width of [390, 600]) for (const draft of nurtureDrafts) {
    const page = await browser.newPage({ viewport: { width, height: 1200 } });
    await page.route('https://radar.thally.io/brand/radar-mark-email.png', route => route.fulfill({ contentType: 'image/png', body: logo }));
    await page.setContent(await readFile(`.factory/lifecycle-emails/previews/nurture/${draft.id}.html`, 'utf8'));
    await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
    const result = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, h1: document.querySelectorAll('h1').length, primary: document.querySelector('a[style*="background:#17181c"]')?.getAttribute('href'), image: { natural: document.images[0].naturalWidth, display: document.images[0].width }, text: document.body.innerText, height: Math.ceil(document.body.querySelector('table').getBoundingClientRect().bottom) }));
    const target = draft.path.startsWith('mailto:') ? draft.path : 'https://radar.thally.io' + draft.path;
    const pass = !result.overflow && result.h1 === 1 && result.primary === target && result.image.natural === 224 && result.image.display === 28 && !/Outrank|35%|free trial|high-DR|case study/i.test(result.text) && (!draft.trial || ['$1', '3-day', '$49', '$50/month'].every(term => result.text.includes(term)));
    checks.push({ id: draft.id, width, pass, ...result });
    if (!pass) throw Error('Draft check failed: ' + draft.id + '@' + width);
    await page.setViewportSize({ width, height: result.height });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: `${out}/${draft.id}-${width}.png` });
    await page.close();
  }
  const gallery = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await gallery.goto('http://127.0.0.1:3934/nurture/index.html');
  await gallery.locator('iframe').last().waitFor();
  const inventory = await gallery.evaluate(() => ({ cards: document.querySelectorAll('section').length, embeds: [...document.querySelectorAll('iframe')].map(frame => frame.contentDocument.images[0]?.naturalWidth), notice: document.querySelector('.notice')?.textContent }));
  if (inventory.cards !== 7 || inventory.embeds.some(n => n !== 224) || !inventory.notice.includes('Nothing is scheduled or sent')) throw Error('Gallery inventory or status incorrect');
  await writeFile(`${out}/gallery.json`, JSON.stringify(inventory, null, 2) + '\n');
} finally {
  await browser.close();
  await writeFile(`${out}/results.json`, JSON.stringify({ environment: 'Local HTML in isolated installed Chrome; first-party logo fulfilled from deployable local PNG; no send, queue or provider call', checks }, null, 2) + '\n');
}
console.log(JSON.stringify({ passed: checks.filter(check => check.pass).length, total: checks.length }));
