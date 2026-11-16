import { createRequire } from 'module';
const W = '/Users/ekene/Downloads/design_handoff_radar/radar-push/.claude/worktrees/radar-delete-business-36eee1';
const require = createRequire(W + '/package.json');
export const { chromium } = require('playwright');
export const pg = require('pg');
export const BASE = 'http://localhost:3421';
export const SHOTS = W + '/.factory/delete-business/qa';
export const db = () => new pg.Pool({ connectionString: 'postgres://postgres@127.0.0.1:55471/radar_qa', max: 2 });
export async function newCtx(browser, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: o.width || 1360, height: o.height || 900 }, colorScheme: o.dark ? 'dark' : 'light', ...(o.mobile ? { hasTouch: true, isMobile: true } : {}) });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('console', m => { if (m.type() === 'error') page.__errors.push('[console] ' + m.text().slice(0, 300)); });
  page.on('pageerror', e => page.__errors.push('[pageerror] ' + e.message.slice(0, 300)));
  return { ctx, page };
}
/** Sign in through the real sign-in form. */
export async function signin(page, email, password, next) {
  await page.goto(BASE + '/signin' + (next ? '?next=' + encodeURIComponent(next) : ''), { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await Promise.all([page.waitForURL(u => !u.pathname.startsWith('/signin'), { timeout: 30000 }), page.keyboard.press('Enter')]);
  await page.waitForLoadState('networkidle').catch(() => {});
}
export const shot = (page, name, o = {}) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: !!o.full });
export const text = async page => (await page.evaluate(() => document.body.innerText)).replace(/\n{2,}/g, '\n');
export const toasts = async page => page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.innerText));
/** Call an app action from the signed-in page (same origin, real cookies). Returns {status, body}. */
export async function act(page, bid, action, input) {
  return page.evaluate(async ([bid, action, input]) => {
    const r = await fetch(`/api/b/${bid}/act`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, input }) });
    let body = null; try { body = await r.json(); } catch {}
    return { status: r.status, body };
  }, [bid, action, input]);
}
export async function call(page, method, url, body) {
  return page.evaluate(async ([method, url, body]) => {
    const r = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    let j = null; let t = ''; try { t = await r.text(); j = JSON.parse(t); } catch {}
    return { status: r.status, type: r.type, body: j, text: j ? undefined : t.slice(0, 200), ct: r.headers.get('content-type') };
  }, [method, url, body]);
}
export const ws = async (page, bid) => (await call(page, 'GET', `/api/b/${bid}/workspace`)).body;
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function waitJobs(pool, bid, ms = 90000) { const t = Date.now(); for (;;) { const { rows } = await pool.query("select kind,status from jobs where business_id=$1 and status in ('queued','running') and run_at <= now() + interval '5 seconds'", [bid]); if (!rows.length) return true; if (Date.now() - t > ms) { console.log('jobs still active', rows); return false; } await sleep(1500); } }
export const A = 'e109d5fa-e0b2-4bfb-9dc6-c98a933e2036';   // Fieldnote
export const Bz = '93b29349-f2ab-43be-bf44-3f9904312286';  // Lumenstudio
import fs from 'node:fs';
const HERE = new URL('.', import.meta.url).pathname;
/** One real sign-in per account (the sign-in form), then the saved session is reused: sign-in is rate limited to 10 per 15 minutes. */
export async function session(browser, who, o = {}) {
  const file = `${HERE}state-${who.replace(/[^a-z0-9]/gi, '_')}.json`;
  const opts = { viewport: { width: o.width || 1360, height: o.height || 900 }, colorScheme: o.dark ? 'dark' : 'light', ...(o.mobile ? { hasTouch: true, isMobile: true } : {}) };
  let ctx;
  if (fs.existsSync(file) && !o.fresh) ctx = await browser.newContext({ ...opts, storageState: file });
  else {
    ctx = await browser.newContext(opts); const p = await ctx.newPage();
    await signin(p, who, o.password || process.env.QA_PW); await ctx.storageState({ path: file }); await p.close();
  }
  const page = await ctx.newPage(); page.__errors = [];
  page.on('console', m => { if (m.type() === 'error') page.__errors.push('[console] ' + m.text().slice(0, 300)); });
  page.on('pageerror', e => page.__errors.push('[pageerror] ' + e.message.slice(0, 300)));
  return { ctx, page };
}
