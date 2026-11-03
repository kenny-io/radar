import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
const out = '.factory/lifecycle-emails/engagement/qa';
const names = ['work_update', 'work_brief_reply', 'work_calendar_review', 'work_article_social', 'work_social_publish'];
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const logo = await readFile('public/brand/radar-mark-email.png');
const checks = [];
try {
  for (const width of [390, 600]) {
    for (const name of names) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      await page.route('https://radar.thally.io/brand/radar-mark-email.png', route => route.fulfill({ contentType: 'image/png', body: logo }));
      await page.setContent(await readFile(`.factory/lifecycle-emails/previews/${name}.html`, 'utf8'));
      await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
      const result = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, h1: document.querySelectorAll('h1').length, sections: document.querySelectorAll('section').length, primaryButtons: document.querySelectorAll('a[style*="background:#17181c"]').length, actions: [...document.querySelectorAll('section a')].map(a => a.href), unsubscribe: [...document.querySelectorAll('a')].filter(a => a.textContent === 'Turn off work reminders').map(a => a.href), image: [...document.images].map(i => ({ naturalWidth: i.naturalWidth, width: i.width })), text: document.body.innerText }));
      const pass = !result.overflow && result.h1 === 1 && result.sections === (name === 'work_update' ? 3 : 1) && result.primaryButtons === 1 && result.actions.length === result.sections && result.actions.every(u => u.startsWith('https://radar.thally.io/email/open?')) && result.unsubscribe.length === 1 && result.image[0]?.naturalWidth === 224 && result.image[0]?.width === 28 && !result.text.includes('35%');
      checks.push({ name, width, pass, ...result });
      if (!pass) throw new Error(`Email preview failed ${name}@${width}`);
      const height = await page.evaluate(() => Math.ceil(document.body.firstElementChild.getBoundingClientRect().bottom));
      await page.setViewportSize({ width, height });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: `${out}/${name}-${width}.png` });
      await page.close();
    }
  }
} finally {
  await browser.close();
  await writeFile(`${out}/render-results.json`, JSON.stringify({ environment: 'Isolated installed Google Chrome, local generated HTML only; first-party brand URL fulfilled from deployable local asset; no provider calls or inbox claim', checks }, null, 2) + '\n');
}
console.log(JSON.stringify({ passed: checks.filter(x => x.pass).length, total: checks.length }));
