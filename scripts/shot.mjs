// DEV ONLY. Screenshot helper for local QA:  node scripts/shot.mjs <path> <out.png> [width] [--base=http://localhost:3000] [--email=dev@radar.local] [--wait=1500] [--full]
import { chromium } from 'playwright';
const args = process.argv.slice(2); const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const [path, out, width] = args.filter(a => !a.startsWith('--'));
const base = opt.base || 'http://localhost:3000';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: Number(width || 1440), height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('[console]', m.text()); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
if (!opt.nologin) { const r = await page.request.post(base + '/api/auth/signin', { data: { email: opt.email || 'dev@radar.local', password: opt.password || 'radar-dev-1' } }); if (!r.ok()) console.log('login failed', r.status()); }
await page.goto(base + path, { waitUntil: 'networkidle' });
await page.waitForTimeout(Number(opt.wait || 1500));
await page.screenshot({ path: out, fullPage: !!opt.full });
await browser.close();
console.log('saved', out);
