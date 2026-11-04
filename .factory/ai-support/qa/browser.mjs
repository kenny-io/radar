import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import pg from 'pg';

const base = 'http://localhost:3820';
const out = '.data/ai-support';
const fixture = JSON.parse(await fs.readFile(out + '/fixture.json', 'utf8'));
const environment = JSON.parse(await fs.readFile(out + '/local-env.json', 'utf8'));
const db = new pg.Pool({ connectionString: environment.DATABASE_URL });
assert.equal(new URL(environment.DATABASE_URL).pathname, '/radar_support_qa');
// Give each complete suite its own fixed windows in this isolated fixture database.
await db.query("DELETE FROM rate_limits WHERE key LIKE 'support:%'");
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const errors = [], results = [], contexts = [];
async function context(width = 1440, height = 950, theme = 'light') {
  const c = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: 'reduce' });
  contexts.push(c);
  await c.addCookies([{ name: 'radar_session', value: fixture.session, url: base, httpOnly: true, sameSite: 'Lax' }, { name: 'radar_biz', value: fixture.businesses[0], url: base, httpOnly: true, sameSite: 'Lax' }]);
  const p = await c.newPage();
  p.setDefaultTimeout(15000); p.setDefaultNavigationTimeout(30000);
  p.on('pageerror', error => errors.push(error.message));
  await p.goto(base + '/dashboard', { waitUntil: 'domcontentloaded' });
  await p.getByRole('button', { name: 'Open Radar support', exact: true }).waitFor();
  return { c, p };
}
async function check(name, fn) {
  try { results.push({ name, pass: true, detail: await fn() }); }
  catch (error) { results.push({ name, pass: false, error: error.message }); }
  console.log(JSON.stringify(results.at(-1)));
}
const open = async p => { await p.getByRole('button', { name: 'Open Radar support', exact: true }).click(); await p.getByRole('dialog', { name: 'Radar support', exact: true }).waitFor(); };
const log = p => p.getByRole('log', { name: 'Support conversation' });
const question = p => p.getByRole('textbox', { name: 'Your question', exact: true });
const ask = async (p, text) => { await question(p).fill(text); await question(p).press('Enter'); await log(p).locator('.support-message-assistant').last().waitFor(); };
try {
  await check('Desktop keyboard ask, loading, empty protection, explicit email and honest development capture', async () => {
    const { p } = await context(); let askRequests = 0; const supportRequests = [];
    p.on('request', request => { if (request.url().endsWith('/support') && request.method() === 'POST') { supportRequests.push(request.postDataJSON()); if (request.postDataJSON().kind === 'ask') askRequests++; } });
    await open(p); await question(p).waitFor(); assert(await question(p).evaluate(el => el === document.activeElement));
    assert(await p.getByRole('button', { name: 'Send question', exact: true }).isDisabled());
    assert(await p.getByRole('button', { name: 'Email support', exact: true }).isDisabled());
    await question(p).press('Enter'); assert.equal(askRequests, 0);
    await question(p).fill('one'); await question(p).press('Shift+Enter'); await question(p).type('two'); assert.equal(await question(p).inputValue(), 'one\ntwo'); assert.equal(askRequests, 0);
    await question(p).fill('How do I publish an article?');
    await p.screenshot({ path: out + '/desktop-open.png', fullPage: true });
    await p.route('**/api/b/*/support', async route => { const response = await route.fetch(); await new Promise(resolve => setTimeout(resolve, 400)); await route.fulfill({ response }); });
    await question(p).press('Enter');
    await p.getByRole('status').filter({ hasText: 'Thinking about your question' }).waitFor();
    assert(await p.getByRole('button', { name: 'Send question', exact: true }).isDisabled());
    assert(await p.getByRole('button', { name: 'Email support', exact: true }).isDisabled());
    await question(p).press('Enter');
    await log(p).locator('.support-message-assistant').waitFor();
    assert.equal(askRequests, 1); assert((await log(p).innerText()).includes('Content Calendar'));
    assert.equal(supportRequests[0].history.length, 0);
    await p.getByRole('button', { name: 'Email support', exact: true }).click();
    await p.getByRole('heading', { name: 'Send this to our team?' }).waitFor();
    assert((await p.getByRole('dialog').innerText()).includes('support@thally.io'));
    assert((await p.getByRole('dialog').innerText()).includes(fixture.email));
    assert.equal(supportRequests.filter(r => r.kind === 'handoff').length, 0);
    await p.screenshot({ path: out + '/desktop-handoff-confirm.png', fullPage: true });
    await p.getByRole('button', { name: 'Send to support', exact: true }).click();
    await p.getByRole('heading', { name: 'Saved as a development test.' }).waitFor();
    assert((await p.getByRole('dialog').innerText()).includes('No email was sent.'));
    assert.equal(supportRequests.filter(r => r.kind === 'handoff').length, 1);
    const latest = (await db.query('SELECT * FROM outbox_emails WHERE text LIKE $1 ORDER BY created_at DESC LIMIT 1', ['%' + fixture.email + '%'])).rows[0];
    assert.equal(latest.to, 'support@thally.io'); assert.equal(latest.status, 'logged'); assert(latest.text.includes('How do I publish an article?'));
    await p.screenshot({ path: out + '/desktop-captured.png', fullPage: true });
    await p.getByRole('button', { name: 'Close support', exact: true }).click();
    assert(await p.getByRole('button', { name: 'Open Radar support', exact: true }).evaluate(el => el === document.activeElement));
    await open(p); assert((await log(p).innerText()).includes('How do I publish an article?'));
    await question(p).press('Escape'); assert.equal(await p.getByRole('dialog', { name: 'Radar support' }).count(), 0);
    assert(await p.getByRole('button', { name: 'Open Radar support', exact: true }).evaluate(el => el === document.activeElement));
    await p.getByRole('button', { name: 'Daily Brief', exact: true }).click(); await p.waitForURL('**/brief');
    await open(p); assert((await log(p).innerText()).includes('How do I publish an article?'));
    await p.reload({ waitUntil: 'domcontentloaded' }); await open(p); assert.equal(await log(p).locator('.support-message').count(), 0);
    const storage = await p.evaluate(() => ({ local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage) }));
    assert(!Object.values(storage).some(value => value.includes('How do I publish an article?')));
    return { realBrowser: 'Chrome', realRouteDatabase: true, askRequests: 1, explicitMailOnly: true, loadingAndDuplicateProtection: true, focusAndEscape: true, navigationPreserves: true, refreshClears: true, noTranscriptStorage: true };
  });
  await check('Unknown question gives actual AI-stub human handoff', async () => {
    const { p } = await context(); await open(p);
    await ask(p, 'Please investigate a refund on my account.');
    assert((await log(p).innerText()).includes('Email support'));
    await p.getByText('Let’s get the team to help with this.', { exact: true }).waitFor();
    assert(await p.getByRole('button', { name: 'Email support', exact: true }).isEnabled());
    return { needsHuman: true, handoffAvailable: true };
  });
  await check('Answer failure keeps question; retry does not duplicate user message', async () => {
    const { p } = await context(); await open(p); let attempts = 0;
    await p.route('**/api/b/*/support', route => { if (++attempts === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Support temporarily unavailable; try again.', code: 'support_unavailable' }) }); return route.continue(); });
    await question(p).fill('How do I connect Search Console?'); await question(p).press('Enter');
    await p.getByRole('alert').filter({ hasText: 'Support temporarily unavailable' }).waitFor();
    assert.equal(await log(p).locator('.support-message-user').count(), 1);
    assert(await p.getByRole('button', { name: 'Email support', exact: true }).isEnabled());
    await p.getByRole('button', { name: 'Try answer again', exact: true }).click();
    await log(p).locator('.support-message-assistant').waitFor();
    assert.equal(await log(p).locator('.support-message-user').count(), 1);
    assert((await log(p).innerText()).includes('read-only'));
    return { simulatedFirstFailure: 503, realRouteRetry: true, questionPreserved: true, noDuplicateUserMessage: true };
  });
  await check('Mail failure preserves conversation and retries with same stable request', async () => {
    const { p } = await context(); await open(p); await ask(p, 'How does Social Marketing work?');
    const requests = [];
    await p.route('**/api/b/*/support', route => {
      const body = route.request().postDataJSON();
      if (body.kind !== 'handoff') return route.continue();
      requests.push(body);
      if (requests.length === 1) return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Your support email could not be confirmed. Please retry.', code: 'delivery_failed' }) });
      return route.continue();
    });
    await p.getByRole('button', { name: 'Email support', exact: true }).click(); await p.getByRole('button', { name: 'Send to support', exact: true }).click();
    await p.getByRole('alert').filter({ hasText: 'could not be confirmed' }).waitFor();
    assert((await log(p).innerText()).includes('How does Social Marketing work?'));
    assert.equal(await p.getByRole('heading', { name: 'Saved as a development test.' }).count(), 0);
    await p.getByRole('button', { name: 'Send to support', exact: true }).click(); await p.getByRole('heading', { name: 'Saved as a development test.' }).waitFor();
    assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]);
    return { simulatedFirstFailure: 502, realRouteRetry: true, stableIdAndPayload: true, noPrematureSuccess: true };
  });
  await check('Business switch clears conversation and drops delayed previous-business answer', async () => {
    const { p } = await context(); await open(p); let release;
    const pending = new Promise(resolve => { release = resolve; });
    await p.route('**/api/b/*/support', async route => { await pending; await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { kind: 'answer', reply: 'PREVIOUS_WORKSPACE_ANSWER', needsHuman: false } }) }); });
    await question(p).fill('PRIVATE_ALPHA_QUESTION'); await question(p).press('Enter');
    await p.locator('aside.side button.nav-i').filter({ hasText: 'support-alpha.test' }).click();
    await p.locator('button.pop-i').filter({ hasText: 'Support Beta' }).click();
    await p.getByRole('button', { name: 'Open Radar support', exact: true }).waitFor();
    release(); await open(p);
    assert.equal(await log(p).locator('.support-message').count(), 0);
    await p.waitForTimeout(300);
    assert(!(await p.getByRole('dialog').innerText()).includes('PREVIOUS_WORKSPACE_ANSWER'));
    assert(!(await p.getByRole('dialog').innerText()).includes('PRIVATE_ALPHA_QUESTION'));
    return { resetOnBusinessSwitch: true, staleAnswerDiscarded: true };
  });
  await check('Mobile light/dark responsive panel, long text, reduced motion and semantic labels', async () => {
    const views = [];
    for (const theme of ['light', 'dark']) {
      const { p } = await context(390, 844, theme); await open(p);
      await ask(p, 'How do I connect Search Console?');
      const geometry = await p.getByRole('dialog', { name: 'Radar support' }).boundingBox();
      assert(geometry.x >= 0 && geometry.x + geometry.width <= 390 && geometry.y >= 0 && geometry.y + geometry.height <= 844);
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), 390);
      assert.equal(await p.getByRole('dialog').evaluate(el => getComputedStyle(el).animationName), 'none');
      await question(p).fill('A'.repeat(2000));
      assert.equal((await question(p).inputValue()).length, 2000);
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth), 390);
      await p.screenshot({ path: `${out}/mobile-${theme}.png`, fullPage: true });
      views.push({ width: 390, height: 844, theme, panelInViewport: true, noHorizontalOverflow: true, reducedMotion: true, maxQuestionLength: 2000 });
    }
    return views;
  });
  await check('No application browser exceptions', async () => { assert.deepEqual(errors, []); return { pageErrors: [] }; });
} finally {
  await fs.writeFile(out + '/browser-results.json', JSON.stringify({ base, mode: 'Real local Chrome + routes + Postgres with deterministic AI/mail capture; mock first failures and delayed previous-workspace response identified per check', results, errors }, null, 2));
  for (const c of contexts) await c.close();
  await browser.close(); await db.end();
  process.exitCode = results.some(result => !result.pass) ? 1 : 0;
}
