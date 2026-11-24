// Shared QA helpers. Real Chrome via Playwright; sessions are read from the git-ignored fixture and never logged.
import fs from 'node:fs/promises'; import pg from 'pg'; import { chromium } from 'playwright';
export const runtime = '.data/custom-post-qa'; export const evidence = runtime + '/evidence'; export const files = runtime + '/files';
export const fixture = JSON.parse(await fs.readFile(runtime + '/fixture.json', 'utf8'));
export const environment = JSON.parse(await fs.readFile(runtime + '/local-env.json', 'utf8'));
export const base = process.env.QA_BASE || 'http://localhost:3871';
await fs.mkdir(evidence, { recursive: true });
export const db = new pg.Pool({ connectionString: environment.DATABASE_URL });
export const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
export async function session(role, { bid = fixture.businessId, viewport = { width: 1440, height: 1000 }, baseUrl = base } = {}) {
  const c = await browser.newContext({ viewport, reducedMotion: 'reduce', timezoneId: 'Europe/London' });   // browser zone differs from the business zone on purpose
  await c.addCookies([{ name: 'radar_session', value: fixture.sessions[role], url: baseUrl }, { name: 'radar_biz', value: bid, url: baseUrl }]);
  const p = await c.newPage(); p.setDefaultTimeout(20000);
  const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  const act = (action, input, b = bid) => c.request.post(`${baseUrl}/api/b/${b}/act`, { data: { action, input }, headers: { origin: baseUrl } });
  return { c, p, errors, act };
}
export const results = [];
export async function check(name, fn, page) {
  try { const detail = await fn(); results.push({ name, pass: true, detail }); }
  catch (e) { results.push({ name, pass: false, error: String(e.stack || e).slice(0, 1500) }); if (page) await page.screenshot({ path: `${evidence}/FAIL-${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}.png`, fullPage: true }).catch(() => {}); }
  console.log(JSON.stringify(results.at(-1)));
}
export async function finish(file) { await fs.writeFile(`.factory/custom-post-scheduling/qa/${file}`, JSON.stringify({ at: new Date().toISOString(), base, results }, null, 2)); await browser.close(); await db.end(); process.exit(results.some(r => !r.pass) ? 1 : 0); }
export const packData = async id => (await db.query('SELECT data FROM social_packs WHERE id=$1', [id])).rows[0]?.data;
export const pubs = async packId => (await db.query("SELECT sid,platform,status,date::text,time,due_at,remote_id,remote_url,posted_at,payload,err,err_code,attempts FROM social_pubs WHERE sid LIKE $1 ORDER BY platform", [`s:${packId}:%`])).rows;
export const noHScroll = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
