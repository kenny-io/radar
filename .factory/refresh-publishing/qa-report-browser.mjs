import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import pg from 'pg';
import assert from 'node:assert/strict';
const base = 'http://localhost:3851';
const output = '.factory/refresh-publishing';
const fixture = JSON.parse(await fs.readFile('.data/refresh-publishing/report-ui/fixture.json', 'utf8'));
const config = JSON.parse(await fs.readFile('.data/refresh-publishing/report-ui/local-env.json', 'utf8'));
const db = new pg.Pool({ connectionString: config.DATABASE_URL });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [], errors = [];
const message = 'Radar is unable to publish this post. Your article is saved.';
const raw = /QA_RAW_|QA_PRIVATE_UNKNOWN_FIELD|plan is empty|Unprocessable Entity|repository validation/;
async function context(role, viewport = { width: 1440, height: 1000 }) {
  const c = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  if (role) await c.addCookies([{ name: 'radar_session', value: fixture.sessions[role], url: base }]);
  const p = await c.newPage(); p.setDefaultTimeout(20000); p.on('pageerror', e => errors.push(e.message));
  return { c, p };
}
async function check(name, task) { try { results.push({ name, pass: true, evidence: await task() }); } catch (error) { results.push({ name, pass: false, error: error.stack }); } console.log(JSON.stringify(results.at(-1))); }
const action = (c, role, input) => c.request.post(`${base}/api/b/${fixture.businessId}/act`, { headers: { 'x-radar-client': '1' }, data: { action: role, input } });
try {
  await db.query("UPDATE calendar_entries SET status='failed' WHERE id=$1", [fixture.entries.remote]);
  const { c, p } = await context('Owner');
  await check('Desktop failure is simple, saved article intact, no automatic report', async () => {
    let reports = 0; p.on('request', req => { if (req.url().endsWith('/act') && req.postDataJSON()?.action === 'publish.reportIssue') reports++; });
    await p.goto(base + '/article/' + fixture.entries.local);
    await p.getByRole('button', { name: 'Report issue to the team', exact: true }).waitFor();
    assert.ok((await p.locator('body').innerText()).includes(message));
    assert.ok((await p.locator('body').innerText()).includes('complete synthetic article stays available'));
    assert.doesNotMatch(await p.locator('body').innerText(), raw);
    assert.equal(reports, 0); assert.equal(await p.getByRole('button', { name: 'Retry', exact: true }).count(), 1);
    return { reportRequiresClick: true, safeMessage: true, draftPreserved: true };
  });
  await check('Reporting shows sending, blocks duplicate clicks, then confirms accepted receipt', async () => {
    let release, calls = 0, submitted;
    await p.route('**/api/b/*/act', async route => {
      const data = route.request().postDataJSON();
      if (data.action !== 'publish.reportIssue') return route.continue();
      calls++; submitted = data.input; await new Promise(resolve => { release = resolve; });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: { delivered: true, reference: 'synthetic-provider-acceptance' } }) });
    });
    const btn = p.getByRole('button', { name: 'Report issue to the team', exact: true }); await btn.focus(); await btn.press('Enter');
    const sending = p.getByRole('button', { name: 'Sending…', exact: true }); await sending.waitFor(); assert.equal(await sending.isDisabled(), true);
    await sending.evaluate(el => el.click()); assert.equal(calls, 1); assert.deepEqual(submitted, { entryId: fixture.entries.local });
    release(); const sent = p.getByRole('button', { name: 'Issue reported', exact: true }); await sent.waitFor(); assert.equal(await sent.isDisabled(), true);
    await p.unroute('**/api/b/*/act');
    return { sendingDisabled: true, requestCount: calls, serverOnlyContext: true, receipt: 'synthetic intercepted UI response; provider behavior tested separately' };
  });
  await check('Failed report stays retryable and never exposes response diagnostics', async () => {
    await p.reload(); await p.getByRole('button', { name: 'Report issue to the team', exact: true }).waitFor();
    await p.route('**/api/b/*/act', async route => route.request().postDataJSON()?.action === 'publish.reportIssue'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'QA_RAW_REPORT_PROVIDER_FAILURE', code: 'report_delivery_failed' }) }) : route.continue());
    await p.getByRole('button', { name: 'Report issue to the team', exact: true }).click();
    await p.getByText('Radar couldn’t send your report. Please try again.', { exact: true }).waitFor();
    assert.equal(await p.getByRole('button', { name: 'Report issue to the team', exact: true }).isEnabled(), true);
    assert.doesNotMatch(await p.locator('body').innerText(), raw); await p.unroute('**/api/b/*/act');
    return { safeError: true, retryEnabled: true };
  });
  await check('Actual stub reporting cannot falsely claim an email was sent', async () => {
    await p.getByRole('button', { name: 'Report issue to the team', exact: true }).click();
    await p.getByText('Your report was saved locally. No email was sent.', { exact: true }).waitFor();
    assert.equal(await p.getByRole('button', { name: 'Issue reported', exact: true }).count(), 0);
    return { realLocalAction: true, sentNotClaimed: true };
  });
  await check('Workspace, job polling and SSE expose safe publishing summaries only', async () => {
    const workspace = await c.request.get(base + '/api/b/' + fixture.businessId + '/workspace'); assert.equal(workspace.status(), 200); assert.doesNotMatch(await workspace.text(), raw);
    const job = await action(c, 'job.get', { id: fixture.jobId }); assert.equal(job.status(), 200); assert.doesNotMatch(await job.text(), raw); assert.match(await job.text(), /unable to publish/);
    await db.query('UPDATE jobs SET finished_at=now() WHERE id=$1', [fixture.jobId]);
    const stream = await p.evaluate(async bid => {
      const response = await fetch('/api/b/' + bid + '/events'); const reader = response.body.getReader(); const decoder = new TextDecoder(); let text = '';
      for (let n = 0; n < 4; n++) { const part = await reader.read(); text += decoder.decode(part.value || new Uint8Array()); if (text.includes('publish.entry')) break; }
      await reader.cancel(); return text;
    }, fixture.businessId);
    assert.ok(stream.includes('publish.entry')); assert.doesNotMatch(stream, raw);
    const persisted = (await db.query('SELECT publish_error FROM calendar_entries WHERE id=$1', [fixture.entries.local])).rows[0]; assert.match(JSON.stringify(persisted), /QA_RAW_DIAGNOSTIC_ONLY/);
    return { workspaceSafe: true, jobSafe: true, sseSafe: true, rawServerDiagnosticsPreserved: true };
  });
  await check('Dashboard uses simple message and keyboard opens saved article', async () => {
    await p.goto(base + '/dashboard'); const view = p.getByRole('button', { name: 'View article', exact: true }).first(); await view.waitFor();
    const dashboardText = await p.locator('body').innerText(); assert.ok(dashboardText.includes('Radar is unable to publish this post.')); assert.ok(dashboardText.includes('Your article is saved.')); assert.doesNotMatch(dashboardText, raw);
    await view.focus(); await view.press('Enter'); await p.waitForURL('**/article/' + fixture.entries.local);
    return { keyboardNavigation: true, safeDashboard: true };
  });
  await check('Mobile failure/report controls fit and remain keyboard accessible', async () => {
    await p.setViewportSize({ width: 390, height: 844 }); await p.goto(base + '/article/' + fixture.entries.local);
    const report = p.getByRole('button', { name: 'Report issue to the team', exact: true }); await report.waitFor(); await report.focus();
    assert.equal(await report.evaluate(el => el === document.activeElement), true);
    const dimensions = await p.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth })); assert.ok(dimensions.width <= dimensions.viewport + 1);
    assert.doesNotMatch(await p.locator('body').innerText(), raw); await p.screenshot({ path: '/tmp/radar-report-ui-mobile.png' });
    return dimensions;
  });
  await check('Viewer can report; duplicate incident across teammates/reload has one immutable local report', async () => {
    const { c: v, p: vp } = await context('Viewer'); await vp.goto(base + '/article/' + fixture.entries.local);
    await vp.getByRole('button', { name: 'Report issue to the team', exact: true }).waitFor(); assert.equal(await vp.getByRole('button', { name: 'Retry', exact: true }).count(), 0);
    const reports = await Promise.all([action(c, 'publish.reportIssue', { entryId: fixture.entries.local }), action(v, 'publish.reportIssue', { entryId: fixture.entries.local })]);
    const data = await Promise.all(reports.map(async r => { assert.equal(r.status(), 200); return (await r.json()).data; })); assert.equal(data[0].reference, data[1].reference); assert.equal(data[0].delivered, false);
    const rows = (await db.query('SELECT * FROM outbox_emails WHERE id=$1', [data[0].reference])).rows; assert.equal(rows.length, 1); const row = rows[0];
    assert.equal(row.to, 'kenny@thally.io'); assert.equal(row.subject, 'User Reported Issue on Radar'); assert.equal(row.status, 'logged');
    assert.doesNotMatch(row.text, /complete synthetic article stays available|QA_PRIVATE_UNKNOWN_FIELD/); assert.match(row.text, /QA_RAW_DIAGNOSTIC_ONLY/);
    const retry = await action(v, 'publish.retry', { entryId: fixture.entries.local }); assert.equal(retry.status(), 403); await v.close();
    return { viewerReportAllowed: true, viewerRetryForbidden: true, singleIncident: true, fixedRecipientAndSubject: true, noBodyInReport: true };
  });
  await check('Anonymous, outsider, forged fields and nonfailed entries cannot send arbitrary reports', async () => {
    const { c: o } = await context('Outsider'); const { c: a } = await context();
    assert.equal((await action(o, 'publish.reportIssue', { entryId: fixture.entries.local })).status(), 404);
    assert.equal((await action(a, 'publish.reportIssue', { entryId: fixture.entries.local })).status(), 401);
    assert.equal((await action(c, 'publish.reportIssue', { entryId: fixture.entries.local, to: 'attacker@example.test', subject: 'override' })).status(), 400);
    await db.query("UPDATE calendar_entries SET status='review' WHERE id=$1", [fixture.entries.remote]);
    assert.equal((await action(c, 'publish.reportIssue', { entryId: fixture.entries.remote })).status(), 409);
    await o.close(); await a.close(); return { outsider404: true, anonymous401: true, forgedFields400: true, nonfailed409: true };
  });
  await check('No browser runtime exceptions', async () => { assert.deepEqual(errors, []); return { pageErrors: 0 }; });
  await c.close();
} finally {
  await browser.close(); await db.end();
  await fs.writeFile(output + '/qa-report-browser-result.json', JSON.stringify({ environment: 'isolated synthetic PostgreSQL, stubs, no worker/external email; real Chrome against local Next development server', base, results, errors }, null, 2) + '\n');
}
process.exitCode = results.some(r => !r.pass) ? 1 : 0;
