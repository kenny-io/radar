/** Run only after the PM supplies a private authenticated context and exact deployed revision.
 * Default: two labelled AI questions and handoff disclosure, with NO email send.
 * A coordinated one-email run additionally requires --send-one-email AND context.allowSend === true.
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const directory = '.data/ai-support/release';
await fs.mkdir(directory, { recursive: true, mode: 0o700 });
const contextPath = process.env.RADAR_RELEASE_CONTEXT || directory + '/context.json';
const config = JSON.parse(await fs.readFile(contextPath, 'utf8'));
assert.equal(config.baseUrl, 'https://radar.thally.io');
assert.match(config.deployedRevision || '', /^[0-9a-f]{7,40}$/);
assert(config.storageState || config.storageStatePath, 'PM-supplied production browser state required');
const send = process.argv.includes('--send-one-email');
assert(!send || config.allowSend === true, 'PM must coordinate the one release email explicitly');
const marker = 'RADAR SUPPORT RELEASE QA ' + new Date().toISOString();
const startedAt = new Date().toISOString();
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ storageState: config.storageState || config.storageStatePath, viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(45000);
const errors = [], questions = [], results = [];
let handoffRequests = 0;
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => {
  if (new URL(request.url()).pathname.endsWith('/support') && request.method() === 'POST' && request.postDataJSON()?.kind === 'handoff') handoffRequests++;
});
try {
  await page.goto(config.baseUrl + '/dashboard', { waitUntil: 'domcontentloaded' });
  assert.equal(new URL(page.url()).pathname, '/dashboard', 'QA account must have normal dashboard access');
  await page.getByRole('button', { name: 'Open Radar support', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Radar support', exact: true });
  await dialog.waitFor();
  const composer = page.getByRole('textbox', { name: 'Your question', exact: true });
  assert(await composer.evaluate(element => element === document.activeElement));
  results.push({ name: 'Production signed-in dashboard shows accessible support launcher and panel', pass: true });
  async function ask(message) {
    const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/support') && response.request().method() === 'POST' && response.request().postDataJSON()?.kind === 'ask', { timeout: 65000 });
    await composer.fill(message);
    const began = Date.now();
    await composer.press('Enter');
    const response = await responsePromise;
    const payload = await response.json();
    assert.equal(response.status(), 200);
    assert.equal(payload.data?.kind, 'answer');
    assert(typeof payload.data.reply === 'string' && payload.data.reply.trim().length > 20);
    await dialog.locator('.support-message-assistant').last().getByText(payload.data.reply, { exact: true }).waitFor();
    const record = { question: message, reply: payload.data.reply, needsHuman: payload.data.needsHuman, status: response.status(), durationMs: Date.now() - began };
    questions.push(record);
    return record;
  }
  const ordinary = await ask(marker + '\nHow do I publish an article from Radar’s Content Calendar? Explain the steps without changing anything.');
  assert.equal(ordinary.needsHuman, false, 'Known Radar product guidance should receive a substantive AI answer');
  assert(!ordinary.reply.includes('I can’t answer that reliably right now'), 'Must exercise a real configured AI provider, not generic failure fallback');
  results.push({ name: 'Live product-navigation question receives substantive AI answer', pass: true, durationMs: ordinary.durationMs, needsHuman: ordinary.needsHuman });
  await page.screenshot({ path: directory + '/live-answer.png', fullPage: true });
  const human = await ask(marker + '\nThis is a test with no customer private data. I need a person to investigate an account-specific billing issue. Please do not change the account, promise a refund, or send email automatically.');
  assert.equal(human.needsHuman, true);
  assert.equal(handoffRequests, 0);
  results.push({ name: 'Live account-specific question offers human help without automatic mail', pass: true, durationMs: human.durationMs, needsHuman: human.needsHuman });
  await page.getByRole('button', { name: 'Email support', exact: true }).click();
  await page.getByRole('heading', { name: 'Send this to our team?', exact: true }).waitFor();
  assert((await dialog.innerText()).includes('support@thally.io'));
  assert.equal(handoffRequests, 0);
  await page.screenshot({ path: directory + '/live-handoff-disclosure.png', fullPage: true });
  results.push({ name: 'Live handoff disclosure names support inbox before any send', pass: true });
  await fs.writeFile(directory + '/conversation.json', JSON.stringify({ deployedRevision: config.deployedRevision, marker, page: 'dashboard', messages: questions.flatMap(item => [{ role: 'user', text: item.question }, { role: 'assistant', text: item.reply }]), latestQuestion: human.question, requestId: crypto.randomUUID() }, null, 2), { mode: 0o600 });
  if (send) {
    const alreadySent = await fs.access(directory + '/email-send-attempt.json').then(() => true).catch(() => false);
    assert.equal(alreadySent, false, 'A team release email was already attempted; coordinate before any retry');
    // Record intent before sending so reruns cannot silently send a second test.
    await fs.writeFile(directory + '/email-send-attempt.json', JSON.stringify({ marker, deployedRevision: config.deployedRevision, startedAt: new Date().toISOString() }), { mode: 0o600, flag: 'wx' });
    const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/support') && response.request().method() === 'POST' && response.request().postDataJSON()?.kind === 'handoff', { timeout: 30000 });
    await page.getByRole('button', { name: 'Send to support', exact: true }).click();
    const response = await responsePromise;
    const payload = await response.json();
    assert.equal(response.status(), 200);
    assert.equal(payload.data?.kind, 'handoff');
    assert.equal(payload.data.delivered, true, 'Production must report provider-accepted delivery');
    assert.equal(handoffRequests, 1, 'Only the coordinated one test email may be sent');
    await page.getByRole('heading', { name: 'Sent to the team.', exact: true }).waitFor();
    await page.screenshot({ path: directory + '/live-email-accepted.png', fullPage: true });
    await fs.writeFile(directory + '/email-send-attempt.json', JSON.stringify({ marker, deployedRevision: config.deployedRevision, acceptedAt: new Date().toISOString(), reference: payload.data.reference, request: response.request().postDataJSON(), response: payload }), { mode: 0o600 });
    results.push({ name: 'One labelled support email accepted by provider and confirmed in UI', pass: true, reference: payload.data.reference, actualRequests: handoffRequests });
  }
  assert.deepEqual(errors, []);
  results.push({ name: 'No application browser exceptions', pass: true });
} catch (error) {
  results.push({ name: 'Release browser verification', pass: false, error: error.message });
  await page.screenshot({ path: directory + '/release-failure.png', fullPage: true }).catch(() => {});
} finally {
  await fs.writeFile(directory + '/browser-results.json', JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), deployedRevision: config.deployedRevision, baseUrl: config.baseUrl, sendCoordinated: send, marker, results, questions, errors, handoffRequests }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ deployedRevision: config.deployedRevision, results, actualAIRequests: questions.length, handoffRequests }));
  await context.close(); await browser.close();
  process.exitCode = results.some(result => !result.pass) ? 1 : 0;
}
