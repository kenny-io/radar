// QA-1 browser smoke, step 3: a real Chrome, driven through Playwright, against the local development server.
//   node .factory/sandbox-publisher/qa/browser.mjs            (web server running; see browser-serve.mjs)
//   node .factory/sandbox-publisher/qa/browser.mjs retry      (web server AND worker running: the retry scenario)
// The owner signs in through the sign-in form with the test password from the git-ignored fixture. Results go to
// qa/evidence/browser-results*.json and screenshots beside them. Nothing here prints the password or a session token.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const fixture = JSON.parse(await fs.readFile('.data/sandbox-publisher/qa/browser/fixture.json', 'utf8'));
const base = fixture.base; const out = '.factory/sandbox-publisher/qa/evidence';
const MODE = process.argv[2] === 'retry' ? 'retry' : 'smoke';
const MESSAGE = 'Radar is unable to publish this post. Your article is saved.';
// Words that belong to operators only. None may reach a customer's page or any response the browser receives.
const FORBIDDEN = [fixture.sentinel, 'sandbox', 'egress', 'AgentApiError', 'AgentBudgetExhausted', 'agent-failed', 'agent-declined', 'agent-budget', 'article-fidelity', 'sandbox-unavailable', 'sandbox-egress-unverified', 'model proxy', 'Daytona', 'rdrcap1', 'canary', 'diagnostic'];
const offending = text => FORBIDDEN.filter(word => text.toLowerCase().includes(word.toLowerCase()));
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = []; const errors = [];
/** Every response body the app's API sends to this browser context, for the leak check. */
const apiBodies = [];
const context = async (role, viewport = { width: 1440, height: 1000 }) => {
  const c = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  if (role) await c.addCookies([{ name: 'radar_session', value: fixture.sessions[role], url: base }]);
  const p = await c.newPage(); p.setDefaultTimeout(25_000);
  p.on('pageerror', error => errors.push(error.message));
  p.on('response', async response => {
    const url = response.url(); if (!url.startsWith(base) || !/\/api\//.test(url)) return;
    const type = response.headers()['content-type'] || '';
    if (/event-stream/.test(type)) return; // read separately below
    try { apiBodies.push({ url: url.replace(base, ''), status: response.status(), body: await response.text() }); } catch { /* navigated away */ }
  });
  return { c, p };
};
const check = async (name, fn) => { try { results.push({ name, pass: true, detail: await fn() }); } catch (error) { results.push({ name, pass: false, error: String(error?.stack || error).slice(0, 1500) }); } console.log(JSON.stringify(results.at(-1))); };
const banner = p => p.getByRole('group', { name: 'Publishing failed' });

try {
  const { c, p } = await context(null);
  await check('an ordinary account signs in through the form and lands in the app', async () => {
    await p.goto(base + '/signin');
    await p.getByLabel('Work email').fill(fixture.users.Owner.email);
    await p.getByLabel('Password').fill(fixture.password);
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    await p.waitForURL(url => !/\/signin/.test(url.pathname), { timeout: 30_000 });
    const cookies = await c.cookies(base);
    const session = cookies.find(cookie => cookie.name === 'radar_session');
    assert.ok(session, 'no session cookie after sign-in');
    assert.equal(session.httpOnly, true);
    return { landedOn: new URL(p.url()).pathname, sessionCookieHttpOnly: session.httpOnly };
  });

  if (MODE === 'smoke') {
    for (const kind of ['fidelity', 'egress', 'agent', 'declined', 'budget', 'teardown']) {
      await check(`failed article (${kind}): the banner is the generic one, with Report issue and Retry, before and after a reload`, async () => {
        const seen = [];
        for (let pass = 0; pass < 2; pass++) {
          await p.goto(base + '/article/' + fixture.entries[kind]);
          await banner(p).waitFor();
          const text = (await banner(p).innerText()).replace(/\s+/g, ' ').trim();
          assert.ok(text.includes('Publishing failed'), text);
          assert.ok(text.includes(MESSAGE), text);
          assert.equal(await banner(p).getByRole('button', { name: 'Report issue to the team', exact: true }).count(), 1);
          assert.equal(await banner(p).getByRole('button', { name: 'Retry', exact: true }).count(), 1);
          const page = await p.locator('body').innerText();
          assert.match(page, new RegExp(`Synthetic body of article ${fixture.labels[kind]},`));
          assert.deepEqual(offending(page), [], 'operator text in the visible page');
          assert.deepEqual(offending(await p.content()), [], 'operator text in the page source');
          assert.equal(await p.getByRole('button', { name: 'Reconnect', exact: true }).count(), 0);
          seen.push(text);
        }
        if (kind === 'fidelity') await p.screenshot({ path: `${out}/browser-article-failed-desktop.png`, fullPage: true });
        return { banner: seen[0], sameAfterReload: seen[0] === seen[1], articleBodyKept: true };
      });
    }

    await check('publishing article: shows "Publishing…", no failure banner, no retry', async () => {
      await p.goto(base + '/article/' + fixture.entries.publishing);
      await p.getByText('Publishing…', { exact: true }).first().waitFor();
      assert.equal(await banner(p).count(), 0);
      assert.equal(await p.getByRole('button', { name: 'Retry', exact: true }).count(), 0);
      const page = await p.locator('body').innerText();
      assert.match(page, /Synthetic body of article seven,/);
      assert.deepEqual(offending(page), []);
      await p.screenshot({ path: `${out}/browser-article-publishing-desktop.png`, fullPage: true });
      return { status: 'Publishing…', failureBanner: false };
    });

    await check('dashboard: the failed article is announced with the same generic sentence and opens by keyboard', async () => {
      await p.goto(base + '/dashboard');
      await p.getByText('Radar is unable to publish this post.', { exact: false }).first().waitFor();
      const page = await p.locator('main').innerText();
      assert.match(page, /Your article is saved\./);
      assert.deepEqual(offending(page), []);
      assert.deepEqual(offending(await p.content()), []);
      await p.screenshot({ path: `${out}/browser-dashboard-desktop.png`, fullPage: true });
      const open = p.getByRole('button', { name: /View article/ }).first();
      await open.focus(); await p.keyboard.press('Enter');
      await p.waitForURL('**/article/e_lanternqa_*');
      await banner(p).waitFor();
      return { openedByKeyboard: new URL(p.url()).pathname };
    });

    await check('what the browser is sent: workspace, job and stream payloads carry only the generic failure', async () => {
      const workspace = await c.request.get(`${base}/api/b/${fixture.businessId}/workspace`);
      assert.equal(workspace.status(), 200);
      const text = await workspace.text();
      assert.deepEqual(offending(text), []);
      const entries = JSON.parse(text)?.calendar?.entries ?? JSON.parse(text)?.workspace?.calendar?.entries ?? [];
      const failed = entries.filter(entry => entry.status === 'failed');
      assert.equal(failed.length, 6);
      for (const entry of failed) assert.deepEqual(entry.publishError, { http: 0, message: MESSAGE });
      // The event stream: read the first few seconds of it.
      const stream = await p.evaluate(async url => { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 4000); let text = ''; try { const response = await fetch(url, { signal: controller.signal }); const reader = response.body.getReader(); const decoder = new TextDecoder(); for (;;) { const step = await reader.read(); if (step.done) break; text += decoder.decode(step.value, { stream: true }); if (text.length > 200000) break; } } catch { /* aborted on purpose */ } clearTimeout(timer); return text; }, `${base}/api/b/${fixture.businessId}/events`);
      assert.deepEqual(offending(stream), []);
      const leaks = apiBodies.filter(row => offending(row.body).length).map(row => ({ url: row.url, words: offending(row.body) }));
      assert.deepEqual(leaks, []);
      return { failedEntries: failed.length, apiResponsesChecked: apiBodies.length, streamBytesChecked: stream.length };
    });

    await check('Report issue: one click sends one report; the customer sees a plain confirmation and no technical detail', async () => {
      await p.goto(base + '/article/' + fixture.entries.declined);
      await banner(p).waitFor();
      let calls = 0; let responseBody = '';
      p.on('response', async response => { if (/\/api\/b\/[^/]+\/act$/.test(response.url()) && response.request().postData()?.includes('publish.reportIssue')) { calls++; responseBody = await response.text().catch(() => ''); } });
      const button = banner(p).getByRole('button', { name: 'Report issue to the team', exact: true });
      await button.click();
      // Dev stubs deliver no email: the app must say so rather than claim the report was sent.
      const toast = p.getByText(/Your report was saved locally\. No email was sent\.|Issue reported to the team\./).first();
      await toast.waitFor();
      const said = (await toast.innerText()).trim();
      await p.waitForTimeout(500);
      assert.equal(calls, 1);
      assert.deepEqual(offending(responseBody), [], 'operator text in the report response');
      assert.deepEqual(offending(await p.locator('body').innerText()), []);
      assert.ok(await banner(p).innerText().then(text => text.includes(MESSAGE)));
      return { toast: said, requests: calls, responseKeys: Object.keys(JSON.parse(responseBody || '{}')) };
    });

    await check('mobile 390 px: the banner fits, wraps without horizontal scroll, and Retry takes keyboard focus', async () => {
      const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', storageState: await c.storageState() });
      const mp = await mobile.newPage(); mp.setDefaultTimeout(25_000); mp.on('pageerror', error => errors.push(error.message));
      await mp.goto(base + '/article/' + fixture.entries.egress);
      await banner(mp).waitFor();
      const size = await mp.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      assert.ok(size.scroll <= size.client + 1, JSON.stringify(size));
      const retry = banner(mp).getByRole('button', { name: 'Retry', exact: true });
      await retry.focus();
      assert.equal(await retry.evaluate(element => element === document.activeElement), true);
      const box = await banner(mp).boundingBox();
      assert.ok(box && box.width <= 390 && box.x >= 0);
      assert.deepEqual(offending(await mp.locator('body').innerText()), []);
      await mp.screenshot({ path: `${out}/browser-article-failed-mobile.png`, fullPage: true });
      await mobile.close();
      return size;
    });

    await check('a viewer sees the same banner without Retry and cannot retry through the API', async () => {
      const { c: vc, p: vp } = await context('Viewer');
      await vp.goto(base + '/article/' + fixture.entries.fidelity);
      await banner(vp).waitFor();
      assert.ok((await banner(vp).innerText()).includes(MESSAGE));
      assert.equal(await banner(vp).getByRole('button', { name: 'Retry', exact: true }).count(), 0);
      assert.deepEqual(offending(await vp.locator('body').innerText()), []);
      const retry = await vc.request.post(`${base}/api/b/${fixture.businessId}/act`, { data: { action: 'publish.retry', input: { entryId: fixture.entries.fidelity } } });
      assert.equal(retry.status(), 403);
      await vc.close();
      return { bannerVisible: true, retryButton: false, retryApi: retry.status() };
    });

    await check('another tenant and an anonymous visitor get nothing about the article or its failure', async () => {
      const { c: oc, p: op } = await context('Outsider');
      const workspace = await oc.request.get(`${base}/api/b/${fixture.businessId}/workspace`);
      const retry = await oc.request.post(`${base}/api/b/${fixture.businessId}/act`, { data: { action: 'publish.retry', input: { entryId: fixture.entries.fidelity } } });
      const report = await oc.request.post(`${base}/api/b/${fixture.businessId}/act`, { data: { action: 'publish.reportIssue', input: { entryId: fixture.entries.fidelity } } });
      assert.deepEqual([workspace.status(), retry.status(), report.status()], [404, 404, 404]);
      await op.goto(base + '/article/' + fixture.entries.fidelity);
      const outsiderText = await op.locator('body').innerText();
      assert.doesNotMatch(outsiderText, /Synthetic failed article|Synthetic body/);
      assert.deepEqual(offending(outsiderText), []);
      await oc.close();
      const { c: ac, p: ap } = await context(null);
      await ap.goto(base + '/article/' + fixture.entries.fidelity);
      await ap.waitForURL(/\/(?:signup|signin)(?:[/?]|$)/);
      assert.doesNotMatch(await ap.locator('body').innerText(), /Synthetic failed article|Synthetic body/);
      await ac.close();
      return { outsider: [workspace.status(), retry.status(), report.status()], anonymousRedirectedTo: 'sign-in' };
    });
  }

  if (MODE === 'retry') {
    await check('Retry (worker running, stub connector): failed → Publishing… → published, and the banner goes away', async () => {
      await p.goto(base + '/article/' + fixture.entries.budget);
      await banner(p).waitFor();
      await banner(p).getByRole('button', { name: 'Retry', exact: true }).click();
      const states = [];
      const publishing = await p.getByText('Publishing…', { exact: true }).first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
      if (publishing) states.push('Publishing…');
      await p.getByText(/Published/).first().waitFor({ timeout: 90_000 });
      states.push('Published');
      assert.equal(await banner(p).count(), 0);
      const page = await p.locator('body').innerText();
      assert.deepEqual(offending(page), []);
      await p.reload();
      await p.getByText(/Published/).first().waitFor();
      assert.equal(await banner(p).count(), 0);
      await p.screenshot({ path: `${out}/browser-article-published-after-retry.png`, fullPage: true });
      const workspace = JSON.parse(await (await c.request.get(`${base}/api/b/${fixture.businessId}/workspace`)).text());
      const entries = workspace?.calendar?.entries ?? workspace?.workspace?.calendar?.entries ?? [];
      const entry = entries.find(item => item.id === fixture.entries.budget);
      assert.equal(entry.status, 'published');
      assert.equal(entry.publishError, null);
      return { states, finalStatus: entry.status, persistedAfterReload: true };
    });
  }

  await check('no uncaught error in the page', async () => { assert.deepEqual(errors, []); return { count: errors.length }; });
} finally {
  await browser.close();
  const version = await fs.readFile('.git', 'utf8').catch(() => '');
  await fs.writeFile(`${out}/browser-results${MODE === 'retry' ? '-retry' : ''}.json`, JSON.stringify({ at: new Date().toISOString(), base, mode: MODE, environment: 'Next dev server, RADAR_DEV_STUBS=1, isolated local Postgres, synthetic accounts; Google Chrome (headless) through Playwright', worktree: version.trim().slice(0, 200) ? 'git worktree' : 'checkout', results, errors }, null, 2));
}
process.exitCode = results.some(result => !result.pass) ? 1 : 0;
