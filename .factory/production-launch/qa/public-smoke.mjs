import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.QA_BASE || 'https://radar.thally.io';
const out = '.data/production-launch/qa';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const results = [], errors = [], failures = [];
page.on('pageerror', e => errors.push(e.message));
page.on('response', r => { if (r.status() >= 400 && !r.url().includes('/api/')) failures.push({ url: r.url(), status: r.status() }); });
const check = async (name, fn) => { try { results.push({ name, pass: true, detail: await fn() }); } catch (e) { results.push({ name, pass: false, error: e.message }); } console.log(JSON.stringify(results.at(-1))); };
const startedAt = new Date().toISOString();
await check('Public pages and legal contacts', async () => {
  const pages = [];
  for (const path of ['/', '/privacy', '/terms', '/bot', '/signup', '/signin', '/features/organic-search', '/features/ai-visibility', '/features/backlinks']) {
    const response = await page.goto(base + path, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200, path);
    const detail = { path, title: await page.title(), h1: await page.locator('h1').allTextContents(), text: await page.locator('body').innerText(), contacts: await page.locator('a[href^="mailto:"]').evaluateAll(es => es.map(e => ({ text: e.textContent, href: e.getAttribute('href') }))), headers: Object.fromEntries(Object.entries(await response.allHeaders()).filter(([k]) => ['cache-control','x-railway-request-id','x-frame-options','content-type'].includes(k))) };
    pages.push(detail);
    await page.screenshot({ path: `${out}/live-${path.replace(/\W+/g, '-') || 'home'}-desktop.png` });
  }
  await fs.writeFile(`${out}/public-pages.json`, JSON.stringify(pages, null, 2));
  return pages.map(({path,title,h1,contacts}) => ({path,title,h1,contacts}));
});
await check('Anonymous protected routes reject direct entry', async () => {
  const observed = [];
  for (const path of ['/dashboard', '/settings?section=billing', '/start-trial']) {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    assert.equal(new URL(page.url()).pathname, '/signup');
    observed.push({ path, final: page.url(), title: await page.title() });
  }
  return observed;
});
await check('Signup empty and malformed validation without network mutation', async () => {
  await page.goto(base + '/signup', { waitUntil: 'networkidle' });
  let authRequests = 0;
  const count = r => { if (r.method() === 'POST' && r.url().includes('/api/auth/')) authRequests++; };
  page.on('request', count);
  await page.getByRole('button', {name: 'Create account', exact: true}).click();
  for (const text of ['Add your name', 'Enter a valid email', 'Use at least 8 characters']) assert(await page.getByText(text, {exact:true}).isVisible());
  await page.getByRole('textbox').nth(0).fill('Launch QA');
  await page.locator('input[type="email"]').fill('bad-email');
  await page.locator('input[type="password"]').fill('short');
  await page.getByRole('button', {name: 'Create account', exact:true}).click();
  assert(await page.getByText('Enter a valid email', {exact:true}).isVisible());
  assert.equal(authRequests, 0);
  await page.screenshot({path:`${out}/live-signup-validation.png`});
  page.off('request',count);
  return { authRequests, validationVisible:true };
});
await check('Signin empty validation and OAuth error recovery', async () => {
  await page.goto(base + '/signin', {waitUntil:'networkidle'});
  await page.getByRole('button', {name:'Sign in',exact:true}).click();
  assert(await page.getByText('Enter a valid email',{exact:true}).isVisible());
  assert(await page.getByText('Enter your password',{exact:true}).isVisible());
  await page.goto(base+'/signin?error=google',{waitUntil:'networkidle'});
  assert(await page.getByText('Google sign-in didn’t finish. Try again, or use your email.',{exact:true}).isVisible());
  const r = await page.goto(base+'/api/auth/google/callback?error=access_denied',{waitUntil:'networkidle'});
  assert.equal(new URL(page.url()).pathname,'/signup');
  assert.equal(new URL(page.url()).searchParams.get('error'),'google');
  return {callbackFinal:page.url(),status:r.status(),errorVisible:true};
});
await check('Google OAuth start opens configured consent with safe return', async () => {
  await page.goto(base+'/signup',{waitUntil:'networkidle'});
  const redirected = page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/google/start');
  await page.getByRole('button',{name:'Continue with Google',exact:true}).click();
  const response = await redirected;
  const target = response.headers().location;
  await page.waitForURL('https://accounts.google.com/**');
  assert(target);
  const u = new URL(target);
  assert.equal(u.searchParams.get('redirect_uri'),new URL('/api/auth/google/callback',base).href);
  const detail={origin:u.origin,pathname:u.pathname,redirect_uri:u.searchParams.get('redirect_uri'),scope:u.searchParams.get('scope'),hasState:!!u.searchParams.get('state')};
  assert(detail.hasState);
  return detail;
});
await check('Mobile public navigation and auth fit', async () => {
  await page.setViewportSize({width:360,height:844});
  const observed=[];
  for(const path of ['/','/signup','/signin','/privacy','/terms','/bot']){
    await page.goto(base+path,{waitUntil:'networkidle'});
    const width=await page.evaluate(()=>document.documentElement.scrollWidth);
    assert.equal(width,360,path);
    observed.push({path,width});
    await page.screenshot({path:`${out}/live-${path.replace(/\W+/g,'-')||'home'}-mobile.png`});
  }
  return observed;
});
await check('No unhandled browser or asset errors', async()=>{assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);return{errors,failures};});
await fs.writeFile(`${out}/public-smoke-results.json`,JSON.stringify({base,startedAt,finishedAt:new Date().toISOString(),results,errors,failures},null,2));
await browser.close();
console.log('TOTAL',results.filter(r=>r.pass).length,'PASS',results.filter(r=>!r.pass).length,'FAIL');
process.exitCode=results.some(r=>!r.pass)?1:0;
