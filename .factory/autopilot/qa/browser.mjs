import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import pg from 'pg';

const base = 'http://localhost:3831';
const output = '.factory/autopilot/qa';
const fixture = JSON.parse(await fs.readFile('.data/autopilot/fixture.json', 'utf8'));
const env = JSON.parse(await fs.readFile('.data/autopilot/local-env.json', 'utf8'));
assert.equal(new URL(env.DATABASE_URL).pathname, '/radar_autopilot_release_qa');
const db = new pg.Pool({ connectionString: env.DATABASE_URL });
// Reset only the synthetic browser fixture so the script is repeatable without touching integration fixtures.
await db.query("DELETE FROM jobs WHERE business_id=$1 AND kind='autopilot.run'", [fixture.businessId]);
await db.query("UPDATE businesses SET autopilot='{}' WHERE id=$1", [fixture.businessId]);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const contexts = [];
const results = [];
const browserErrors = [];
const makeContext = async role => {
  const c = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }); contexts.push(c);
  await c.addCookies([{ name: 'radar_session', value: fixture.sessions[role], url: base }]);
  const p = await c.newPage(); p.setDefaultTimeout(30000); p.on('pageerror', e => browserErrors.push({ role, message: e.message }));
  return { c, p };
};
const check = async (name, fn) => {
  try { results.push({ name, pass: true, detail: await fn() }); }
  catch (e) { results.push({ name, pass: false, error: e.stack }); }
  console.log(JSON.stringify(results.at(-1)));
};
const api = async (c, action, input = {}) => c.request.post(base + '/api/b/' + fixture.businessId + '/act', { data: { action, input } });
const business = async () => (await db.query('SELECT autopilot,blog,social_auto FROM businesses WHERE id=$1', [fixture.businessId])).rows[0];
let owner;
try {
  owner = await makeContext('Owner');
  const { c, p } = owner;
  await check('AC1/7 Owner sees default-off Autopilot with explicit publication permission', async () => {
    await p.goto(base + '/settings?section=autopilot');
    const sw = p.getByRole('switch', { name: 'Autopilot', exact: true }); await sw.waitFor();
    assert.equal(await sw.getAttribute('aria-checked'), 'false'); assert(await sw.isEnabled());
    await p.getByText('Turning this on authorizes Radar to publish articles and social posts without your review.', { exact: false }).waitFor();
    await p.getByText(fixture.users.Owner.email, { exact: true }).waitFor();
    await p.screenshot({ path: output + '/settings-off-desktop.png', fullPage: true });
    return { defaultOff: true, ownerEmail: true, explicitPermission: true };
  });
  await check('AC7 Save failure preserves off state and exposes actionable error', async () => {
    await p.route('**/api/b/*/act', async route => {
      if (route.request().postDataJSON()?.action === 'settings.autopilot') {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Autopilot QA save unavailable. Try again.' }) });
      } else await route.continue();
    });
    await p.getByRole('switch', { name: 'Autopilot', exact: true }).click();
    await p.getByRole('alert').filter({ hasText: 'Autopilot QA save unavailable. Try again.' }).waitFor();
    assert.equal(await p.getByRole('switch', { name: 'Autopilot', exact: true }).getAttribute('aria-checked'), 'false');
    assert.equal((await business()).autopilot.enabled, undefined);
    await p.screenshot({ path: output + '/settings-save-error.png', fullPage: true });
    await p.unroute('**/api/b/*/act');
    return { errorVisible: true, statePreserved: true };
  });
  await check('AC1/2/7 Keyboard enables Autopilot and refresh retains persisted state', async () => {
    const before = await business();
    const response = p.waitForResponse(r => r.url().endsWith('/act') && r.request().postDataJSON()?.action === 'settings.autopilot' && r.status() === 200);
    await p.getByRole('switch', { name: 'Autopilot', exact: true }).focus(); await p.keyboard.press('Space'); await response;
    await p.waitForFunction(() => document.querySelector('[role=switch][aria-label=Autopilot]')?.getAttribute('aria-checked') === 'true');
    const saved = await business(); assert.equal(saved.autopilot.enabled, true); assert(saved.autopilot.activationId);
    assert.deepEqual(saved.blog, before.blog); assert.deepEqual(saved.social_auto, before.social_auto);
    await p.reload(); await p.getByRole('switch', { name: 'Autopilot', exact: true }).waitFor();
    assert.equal(await p.getByRole('switch', { name: 'Autopilot', exact: true }).getAttribute('aria-checked'), 'true');
    const jobs = (await db.query("SELECT payload FROM jobs WHERE business_id=$1 AND kind='autopilot.run' AND status IN ('queued','running')", [fixture.businessId])).rows;
    assert.equal(jobs.length, 1); assert.equal(jobs[0].payload.activationId, saved.autopilot.activationId);
    await p.screenshot({ path: output + '/settings-on-desktop.png', fullPage: true });
    return { keyboard: true, persistence: true, oneDurableJob: true, legacyPreferencesPreserved: true };
  });
  await check('AC7 Run-now state avoids duplicate active work and can queue a completed check again', async () => {
    const button = p.getByRole('button', { name: 'Checking program…', exact: true }); await button.waitFor(); assert(await button.isDisabled());
    // A completed worker run is a fixture state for this control check; worker behavior has separate integration coverage.
    await db.query("UPDATE jobs SET status='done',finished_at=now() WHERE business_id=$1 AND kind='autopilot.run' AND status='queued'", [fixture.businessId]);
    await p.reload(); await p.getByRole('button', { name: 'Run now', exact: true }).waitFor();
    const response = p.waitForResponse(r => r.url().endsWith('/act') && r.request().postDataJSON()?.action === 'settings.autopilotRun' && r.status() === 200);
    await p.getByRole('button', { name: 'Run now', exact: true }).click(); await response;
    assert.equal((await db.query("SELECT count(*)::int AS n FROM jobs WHERE business_id=$1 AND kind='autopilot.run' AND status IN ('queued','running')", [fixture.businessId])).rows[0].n, 1);
    return { activeWorkDisabled: true, runNowQueues: true };
  });
  await check('AC7 Social preferences deep link honors active program with separate drafts paused', async () => {
    const saved = (await business()).social_auto;
    await db.query("UPDATE businesses SET social_auto=social_auto || '{\"on\":false}'::jsonb WHERE id=$1", [fixture.businessId]);
    await p.reload(); await p.getByRole('button', { name: 'Social draft settings', exact: true }).waitFor();
    await p.getByRole('button', { name: 'Social draft settings', exact: true }).click();
    const modal = p.getByRole('dialog', { name: 'Draft settings', exact: true }); await modal.waitFor();
    assert.equal(await modal.getByRole('switch', { name: 'Automatic drafts', exact: true }).getAttribute('aria-checked'), 'false');
    assert(await modal.getByRole('tab', { name: 'Custom', exact: true }).isEnabled());
    await modal.getByRole('tab', { name: 'Custom', exact: true }).click();
    assert(await modal.getByRole('button', { name: 'Tue', exact: true }).isEnabled());
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
    await modal.waitFor({ state: 'hidden' });
    await p.waitForURL(base + '/social');
    await p.getByText(/autonomous publishing enabled/).waitFor();
    await p.screenshot({ path: output + '/social-autopilot-context.png', fullPage: true });
    await db.query('UPDATE businesses SET social_auto=$2 WHERE id=$1', [fixture.businessId, saved]);
    await p.goto(base + '/settings?section=autopilot'); await p.getByRole('switch', { name: 'Autopilot', exact: true }).waitFor();
    return { deepLinkOpened: true, savedPauseRetained: true, programPreferencesEditable: true, closeRemovedParameter: true, libraryShowsAutonomy: true };
  });
  for (const role of ['Admin', 'Editor', 'Viewer']) await check('AC1/8 ' + role + ' reads status but cannot change or run Autopilot', async () => {
    const { c: member, p: page } = await makeContext(role);
    await page.goto(base + '/settings?section=autopilot');
    const sw = page.getByRole('switch', { name: 'Autopilot', exact: true }); await sw.waitFor(); assert(await sw.isDisabled());
    assert.equal(await page.getByRole('button', { name: 'Run now', exact: true }).count(), 0);
    const toggle = await api(member, 'settings.autopilot', { enabled: false }); assert.equal(toggle.status(), 403);
    const run = await api(member, 'settings.autopilotRun'); assert.equal(run.status(), 403);
    assert.equal((await business()).autopilot.enabled, true);
    return { readOnlyUI: true, toggle403: true, run403: true };
  });
  await check('AC8 Outsider cannot read business or invoke Autopilot', async () => {
    const { c: outsider } = await makeContext('Outsider');
    assert.equal((await outsider.request.get(base + '/api/b/' + fixture.businessId + '/workspace')).status(), 404);
    assert.equal((await api(outsider, 'settings.autopilot', { enabled: true })).status(), 404);
    assert.equal((await api(outsider, 'settings.autopilotRun')).status(), 404);
    return { workspace404: true, toggle404: true, run404: true };
  });
  await check('AC7 Mobile settings fit without horizontal overflow and toggle remains usable', async () => {
    await p.setViewportSize({ width: 390, height: 844 }); await p.goto(base + '/settings?section=autopilot');
    await p.getByRole('switch', { name: 'Autopilot', exact: true }).waitFor();
    const size = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert(size.scroll <= size.client + 1); await p.screenshot({ path: output + '/settings-on-mobile.png', fullPage: true }); return size;
  });
  await check('AC1/6/7 Disable is persisted; off run-now is refused', async () => {
    const previous = await business();
    const response = p.waitForResponse(r => r.url().endsWith('/act') && r.request().postDataJSON()?.action === 'settings.autopilot' && r.status() === 200);
    await p.getByRole('switch', { name: 'Autopilot', exact: true }).click(); await response;
    await p.reload(); await p.getByRole('switch', { name: 'Autopilot', exact: true }).waitFor();
    assert.equal(await p.getByRole('switch', { name: 'Autopilot', exact: true }).getAttribute('aria-checked'), 'false');
    const off = await business(); assert.equal(off.autopilot.enabled, false); assert.deepEqual(off.blog, previous.blog); assert.deepEqual(off.social_auto, previous.social_auto);
    assert.equal((await api(c, 'settings.autopilotRun')).status(), 400);
    return { disabledPersisted: true, legacyPreferencesPreserved: true, offRunRejected: true };
  });
  await check('AC7 No browser runtime exceptions', async () => { assert.deepEqual(browserErrors, []); return { count: browserErrors.length }; });
} finally {
  await browser.close(); await db.end();
  await fs.writeFile(output + '/browser-results.json', JSON.stringify({ at: new Date().toISOString(), results, browserErrors }, null, 2));
}
process.exitCode = results.some(result => !result.pass) ? 1 : 0;
