import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import pg from 'pg';
const base = 'http://localhost:3822';
const fixture = JSON.parse(await fs.readFile('.data/ai-support/fixture.json', 'utf8'));
const environment = JSON.parse(await fs.readFile('.data/ai-support/local-env.json', 'utf8'));
assert.equal(new URL(environment.DATABASE_URL).pathname, '/radar_support_qa');
const db = new pg.Pool({ connectionString: environment.DATABASE_URL });
await db.query("DELETE FROM rate_limits WHERE key LIKE 'support:%'");
const before = (await db.query('SELECT count(*)::int AS count FROM outbox_emails')).rows[0].count;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' });
await context.addCookies([{ name: 'radar_session', value: fixture.session, url: base, httpOnly: true, sameSite: 'Lax' }]);
const p = await context.newPage(); const errors = []; const results = [];
p.on('pageerror', error => errors.push(error.message));
try {
  await p.goto(base + '/dashboard', { waitUntil: 'domcontentloaded' });
  await p.getByRole('button', { name: 'Open Radar support', exact: true }).click();
  const textbox = p.getByRole('textbox', { name: 'Your question', exact: true });
  await textbox.fill('How do I publish an article?');
  const response = p.waitForResponse(response => response.url().endsWith('/support') && response.request().postDataJSON().kind === 'ask');
  await textbox.press('Enter');
  const answer = await response;
  assert.equal(answer.status(), 200);
  assert.equal((await answer.json()).data.needsHuman, true);
  await p.getByRole('log').getByText('I can’t answer that reliably right now.', { exact: false }).waitFor();
  results.push({ name: 'Production ignores dev stubs and missing AI providers yield honest human-help fallback', pass: true });
  await p.getByRole('button', { name: 'Email support', exact: true }).click();
  const mailResponse = p.waitForResponse(response => response.url().endsWith('/support') && response.request().postDataJSON().kind === 'handoff');
  await p.getByRole('button', { name: 'Send to support', exact: true }).click();
  const mail = await mailResponse;
  assert.equal(mail.status(), 503); assert.equal((await mail.json()).code, 'support_unavailable');
  await p.getByRole('alert').filter({ hasText: 'Email support is temporarily unavailable' }).waitFor();
  assert((await p.getByRole('log').innerText()).includes('How do I publish an article?'));
  assert.equal(await p.getByRole('heading', { name: /Sent to the team|Saved as a development test/ }).count(), 0);
  const after = (await db.query('SELECT count(*)::int AS count FROM outbox_emails')).rows[0].count;
  assert.equal(after, before); assert.deepEqual(errors, []);
  await p.screenshot({ path: '.data/ai-support/production-unavailable.png', fullPage: true });
  results.push({ name: 'Production missing email credentials returns503 without outbox capture or false success; transcript stays available', pass: true });
} catch (error) { results.push({ name: 'Production smoke', pass: false, error: error.message }); }
finally {
  await fs.writeFile('.data/ai-support/production-results.json', JSON.stringify({ base, environment: 'Production Next server; local fixture database; all live provider credentials empty; dev-stub flag deliberately present but disabled by production', results, errors }, null, 2));
  console.log(JSON.stringify(results)); await context.close(); await browser.close(); await db.end();
  process.exitCode = results.some(result => !result.pass) ? 1 : 0;
}
