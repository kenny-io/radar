// Retest a384c862 (5): over-limit edit after scheduling fails at send with err_code too_long (real worker, dev stubs).
// Method: schedule X tomorrow (API), edit over the limit in the UI, move only due_at to now+70s in the test DB, wait for the worker.
import assert from 'node:assert/strict';
import { session, check, finish, base, fixture, evidence, db, pubs, packData } from './lib.mjs';
const { p, act, c, errors } = await session('Editor'); const j = async r => ({ status: r.status(), body: await r.json().catch(() => null) });
const W = await (await c.request.get(`${base}/api/b/${fixture.businessId}/workspace`)).json(); const tomorrow = new Date(Date.parse(W.today + 'T12:00Z') + 864e5).toISOString().slice(0, 10);
const id = (await j(await act('social.createCustom', { name: 'QA too long at send', posts: [{ platform: 'x', text: 'Fits today.' }, { platform: 'linkedin', text: 'LinkedIn control post.' }] }))).body.data.packId;
await check('5 Over-limit edit after scheduling → worker marks failed with err_code too_long; message and UI line unchanged; nothing sent', async () => {
  for (const [k, ch] of [['x', 'x'], ['linkedin', 'li_profile']]) { const s = await j(await act('social.schedule', { sid: `s:${id}:${k}`, date: tomorrow, time: '09:00', acctId: W.social.accounts.find(a => a.ch === ch).id })); assert.equal(s.status, 200, JSON.stringify(s)); }
  await p.goto(`${base}/social?pack=${id}`); await p.locator('h1').first().waitFor(); await p.locator('.tabs button').filter({ hasText: /^X$/ }).click();
  const long = 'Edited after scheduling ' + 'y'.repeat(280); await p.getByLabel('X post text', { exact: true }).fill(long); await p.getByText(/Fix this before .* or it won’t post\./).waitFor();
  for (let i = 0; i < 40 && (await packData(id)).posts.x.text !== long; i++) await p.waitForTimeout(250);
  const t0 = Date.now(); await db.query("UPDATE social_pubs SET due_at=date_trunc('second', now())+interval '70 seconds' WHERE business_id=$1 AND sid LIKE $2", [fixture.businessId, `s:${id}:%`]);
  let rows; for (;;) { rows = await pubs(id); if (rows.every(r => r.status === 'posted' || r.status === 'failed')) break; if (Date.now() - t0 > 240000) throw Error('timeout ' + JSON.stringify(rows.map(r => r.status))); await new Promise(r => setTimeout(r, 3000)); }
  const x = rows.find(r => r.platform === 'x'), li = rows.find(r => r.platform === 'linkedin');
  await p.reload(); await p.locator('.tabs button').filter({ hasText: /^X$/ }).click(); await p.getByText(/^Didn’t post /).waitFor(); const side = await p.locator('.pack-side').innerText(); await p.screenshot({ path: evidence + '/r5-too-long-failed.png', fullPage: true });
  const out = { x: { status: x.status, err_code: x.err_code, err: x.err, remote_url: x.remote_url, payload: x.payload }, linkedin: { status: li.status }, failedPanel: side.split('\n').filter(l => /Didn’t post|Shorten|Nothing was published/.test(l)), textKept: [...(await packData(id)).posts.x.text].length, tryAgainDisabled: await p.getByRole('button', { name: 'Try again', exact: true }).isDisabled() };
  assert.equal(x.status, 'failed'); assert.equal(x.err_code, 'too_long'); assert.equal(x.err, 'Shorten to 280 characters to post on X. It’s 304 now.'); assert.equal(x.remote_url, null); assert.equal(li.status, 'posted');
  assert(out.failedPanel.some(l => l === 'Shorten to 280 characters to post on X. It’s 304 now. Nothing was published.'), JSON.stringify(out.failedPanel)); assert.equal(out.textKept, 304); return out;
}, p);
await check('No page errors', async () => { assert.deepEqual(errors.filter(e => !/status of 4\d\d/.test(e)), []); });
await finish('r-c-toolong-results.json');
