import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: process.argv.includes('--nogl') ? ['--disable-gpu','--disable-webgl'] : [] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage(); page.setDefaultTimeout(600000);
page.on('console', m => console.log('[console]', m.type(), m.text().slice(0, 300)));
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('crash', () => console.log('[CRASH]'));
await page.request.post('http://localhost:3101/api/auth/signin', { data: { email: 'nia@example.com', password: 'password123' } });
await page.goto('http://localhost:3101/dashboard', { waitUntil: 'domcontentloaded' });
for (let i = 0; i < 12; i++) { await page.waitForTimeout(5000); const t = await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize/1e6)+'MB nodes='+document.getElementsByTagName('*').length+' '+document.body.innerText.slice(0, 200).replace(/\s+/g,' ')).catch(e => 'ERR ' + e.message); console.log(i, JSON.stringify(t)); if (t.includes('get to know')) break; }
await page.screenshot({ path: process.argv[2], timeout: 600000 }); console.log('saved');
await browser.close();
