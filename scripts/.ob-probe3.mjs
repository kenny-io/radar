import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); page.setDefaultTimeout(600000);
await page.goto('http://localhost:3101/signup', { waitUntil: 'domcontentloaded' }); await page.getByText('Create your account').waitFor(); await page.waitForTimeout(3000);
console.log(await page.evaluate(() => { const c = document.querySelector('canvas'); const g = c.getContext('webgl'); return JSON.stringify({ lost: g && g.isContextLost(), kids: c.parentElement.children.length }); }));
await browser.close();
