import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); page.setDefaultTimeout(600000);
page.on('console', m => { if (!/DevTools/.test(m.text())) console.log('[console]', m.type(), m.text().slice(0, 300)); });
await page.request.post('http://localhost:3101/api/auth/signin', { data: { email: 'nia@example.com', password: 'password123' } });
await page.goto('http://localhost:3101/dashboard', { waitUntil: 'domcontentloaded' });
await page.getByText('Let’s get to know').waitFor(); await page.waitForTimeout(3000);
console.log(await page.evaluate(() => { const c = document.querySelector('.modal canvas'); const p = c.parentElement; const g = c.getContext('webgl'); return JSON.stringify({ lost: g && g.isContextLost(), hasCtx: !!g, renderer: g && g.getParameter(g.RENDERER), fb: p.children[1] && p.children[1].tagName, bg: getComputedStyle(p).backgroundColor, w: c.width, h: c.height, kids: p.children.length, gl: !!document.createElement('canvas').getContext('webgl') }); }));
await page.screenshot({ path: process.argv[2] }); await browser.close();
