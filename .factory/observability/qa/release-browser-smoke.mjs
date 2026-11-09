import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const deployedSha = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(deployedSha || '')) throw new Error('Pass the full commit SHA after PM confirms both production deployments.');
const origin = 'https://radar.thally.io';
const evidenceDir = path.resolve('.factory/observability/qa');
const evidence = { at: new Date().toISOString(), origin, pmConfirmedDeploymentSha: deployedSha, mode: 'Read-only public/unauthenticated browser verification; no form submission, account creation, generation or production configuration changes.', health: null, pages: [], browserErrors: [] };
const health = await fetch(origin + '/api/health');
const healthBody = await health.json();
evidence.health = { status: health.status, body: healthBody };
if (health.status !== 200 || healthBody.ok !== true) throw new Error('Production health failed');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => evidence.browserErrors.push(error.message));
  for (const route of ['/', '/signin', '/privacy', '/terms']) {
    const response = await page.goto(origin + route, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.locator('body').waitFor();
    const title = await page.title();
    const headings = await page.locator('h1').allTextContents();
    const text = await page.locator('body').innerText();
    const result = { route, status: response?.status(), finalPath: new URL(page.url()).pathname, title, headings, hasUnexpectedErrorPage: /application error:|internal server error|this page could not be found/i.test(text) };
    if (route === '/signin') result.signInForm = { emailInputs: await page.locator('input[type=email]').count(), passwordInputs: await page.locator('input[type=password]').count(), signInButtons: await page.getByRole('button', {name:'Sign in',exact:true}).count() };
    evidence.pages.push(result);
    if (result.status !== 200 || !title || result.hasUnexpectedErrorPage) throw new Error('Production browser route failed: ' + route);
    if (route === '/' || route === '/signin') await page.screenshot({ path: path.join(evidenceDir, 'release-' + (route === '/' ? 'home' : 'signin') + '.png'), fullPage: false, animations: 'disabled' });
    if (route === '/signin' && (result.signInForm.emailInputs !== 1 || result.signInForm.passwordInputs !== 1 || result.signInForm.signInButtons !== 1)) throw new Error('Sign-in form missing');
  }
} finally {
  await browser.close();
  await fs.writeFile(path.join(evidenceDir, 'release-browser-results.json'), JSON.stringify(evidence, null, 2) + '\n');
}
if (evidence.browserErrors.length) throw new Error('Production browser errors observed');
console.log(JSON.stringify(evidence, null, 2));
