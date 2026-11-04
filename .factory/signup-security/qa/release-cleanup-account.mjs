// One-purpose, explicitly authorized deletion of the verified synthetic release fixture only.
// Production credentials remain in Railway; identities and raw query results never reach stdout.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const statePath = process.argv[2];
const project = '863ea66d-04b9-40e8-b27f-89a4f75c026e';
const environment = '168aae6e-c038-4198-910a-e388afaac157';
const service = '0c4df5c5-938d-421e-a16a-1c0781ac5118';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
async function privateRead(file) { const stat = await fs.lstat(file); assert(stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o077)); return JSON.parse(await fs.readFile(file, 'utf8')); }
async function privateWrite(file, value) { const temp = file + '.' + crypto.randomBytes(8).toString('hex'); await fs.writeFile(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); await fs.rename(temp, file); }
async function remoteCleanup(payload) {
  const pg = require('pg'); const assert = require('node:assert/strict');
  assert.equal(payload.purpose, 'signup-security-live-confirmation');
  assert(/^[^@+]+\+radar-signup-[a-z0-9-]+@gmail\.com$/i.test(payload.recipient));
  assert(/^[0-9a-f-]{36}$/.test(payload.userId)); assert.equal(payload.name, 'Radar signup security release check');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  let deleted = false;
  try {
    await client.connect(); await client.query(payload.mode === 'inspect' ? 'BEGIN READ ONLY' : 'BEGIN');
    await client.query('SET LOCAL statement_timeout = 10000');
    const params = [payload.userId, payload.recipient, payload.name, payload.preparedAt, payload.signupAt];
    const user = (await client.query(`SELECT id,created_at::text AS exact_created_at FROM users WHERE id=$1 AND email=$2 AND name=$3 AND created_at >= $4::timestamptz AND created_at <= $5::timestamptz AND NOT guest AND google_sub IS NULL AND email_verified_at IS NOT NULL ${payload.mode === 'inspect' ? '' : 'FOR UPDATE'}`, params)).rows;
    assert.equal(user.length, 1);
    const exactCreatedAt = user[0].exact_created_at;
    if (payload.mode !== 'inspect') assert.equal(exactCreatedAt, payload.exactCreatedAt);
    const counts = (await client.query(`SELECT
      (SELECT count(*)::int FROM businesses WHERE owner_id=$1) AS businesses,
      (SELECT count(*)::int FROM members WHERE user_id=$1) AS members,
      (SELECT count(*)::int FROM billing_accounts WHERE user_id=$1) AS billing,
      (SELECT count(*)::int FROM sessions WHERE user_id=$1) AS sessions,
      (SELECT count(*)::int FROM email_verification_tokens WHERE user_id=$1) AS tokens,
      (SELECT count(*)::int FROM oauth_states WHERE user_id=$1) AS oauth_states`, [payload.userId])).rows[0];
    for (const count of Object.values(counts)) assert.equal(count, 0);
    const events = (await client.query(`SELECT id,kind,business_id,created_at FROM events WHERE user_id=$1 ${payload.mode === 'inspect' ? '' : 'FOR UPDATE'}`, [payload.userId])).rows;
    assert.equal(events.length, 1);
    for (const event of events) { assert.equal(event.kind, 'user.signed_up'); assert.equal(event.business_id, null); assert(new Date(event.created_at) >= new Date(payload.preparedAt)); }
    const outbox = (await client.query(`SELECT id,subject,text,html,status,created_at FROM outbox_emails WHERE "to"=$1 ${payload.mode === 'inspect' ? '' : 'FOR UPDATE'}`, [payload.recipient])).rows;
    assert.equal(outbox.length, 1);
    for (const mail of outbox) { assert.equal(mail.subject, 'Confirm your email for Radar'); assert.equal(mail.text, '[Security email content redacted]'); assert.equal(mail.html, null); assert.equal(mail.status, 'sent'); assert(new Date(mail.created_at) >= new Date(payload.preparedAt)); }
    if (payload.mode === 'inspect') { await client.query('ROLLBACK'); return { exactCreatedAt, guardedFixture: true, counts, events: events.length, outbox: outbox.length }; }
    // Every identity, commercial-data, session, token, OAuth and provenance guard above completes before the first DELETE.
    const removedEvents = await client.query('DELETE FROM events WHERE user_id=$1 AND id=$2 AND business_id IS NULL AND created_at >= $3::timestamptz RETURNING id', [payload.userId, events[0].id, payload.preparedAt]);
    assert.equal(removedEvents.rowCount, 1);
    const removedOutbox = await client.query('DELETE FROM outbox_emails WHERE "to"=$1 AND id=$2 AND created_at >= $3::timestamptz RETURNING id', [payload.recipient, outbox[0].id, payload.preparedAt]);
    assert.equal(removedOutbox.rowCount, 1);
    const removedUser = await client.query('DELETE FROM users WHERE id=$1 AND email=$2 AND name=$3 AND created_at=$4::timestamptz AND NOT guest AND google_sub IS NULL AND email_verified_at IS NOT NULL RETURNING id', [payload.userId, payload.recipient, payload.name, payload.exactCreatedAt]);
    assert.equal(removedUser.rowCount, 1);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM users WHERE id=$1 OR email=$2', [payload.userId, payload.recipient])).rows[0].n, 0);
    await client.query('COMMIT'); deleted = true;
    return { guardedFixture: true, exactIdentityAndCreatedAtMatched: true, deletedUsers: 1, deletedEvents: 1, deletedOutboxRows: 1, deletedSessions: 0, deletedTokens: 0, deletedBusinesses: 0, deletedBillingRows: 0, remainingFixtureUsers: 0 };
  } catch { await client.query('ROLLBACK').catch(() => {}); throw new Error(deleted ? 'Post-commit failure' : 'Cleanup guards or transaction failed'); }
  finally { await client.end(); }
}
function runRemote(payload) {
  const code = `(${remoteCleanup.toString()})(JSON.parse(Buffer.from(process.argv[1],"base64").toString("utf8"))).then(result=>process.stdout.write("RADAR_CLEANUP_JSON:"+JSON.stringify(result)+"\\n")).catch(()=>{process.stderr.write("Bounded cleanup stopped\\n");process.exitCode=1;});`;
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const result = spawnSync('railway', ['ssh', '-p', project, '-e', environment, '-s', service, 'node', '-e', quote(code), quote(data)], { encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0 || result.error) throw new Error('Cleanup stopped; inspect private state before any retry');
  const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('RADAR_CLEANUP_JSON:')); assert(line);
  return JSON.parse(line.slice('RADAR_CLEANUP_JSON:'.length));
}
try {
  assert.equal(process.env.RADAR_RELEASE_PROBE_CLEANUP_APPROVED, '1');
  assert(statePath && path.isAbsolute(statePath));
  const state = await privateRead(statePath); assert.equal(state.stage, 'verified'); assert.equal(state.purpose, 'signup-security-live-confirmation'); assert.equal(state.base, 'https://radar.thally.io'); assert.equal(state.dbTransport, 'railway-ssh'); assert(!state.session);
  const payload = { purpose: state.purpose, userId: state.userId, recipient: state.recipient, name: 'Radar signup security release check', preparedAt: state.preparedAt, signupAt: state.signupAt, mode: 'inspect' };
  const baseline = runRemote(payload); assert(baseline.guardedFixture);
  state.cleanupExactCreatedAt = baseline.exactCreatedAt; state.stage = 'cleanup-in-flight'; await privateWrite(statePath, state);
  const result = runRemote({ ...payload, mode: 'delete', exactCreatedAt: baseline.exactCreatedAt });
  assert.equal(result.deletedUsers, 1);
  state.stage = 'cleaned'; state.cleanedAt = new Date().toISOString(); delete state.password; delete state.session;
  state.cleanup = { at: state.cleanedAt, sourceCommit: state.sourceCommit, harnessSha256: crypto.createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).digest('hex'), ...result };
  if (state.receiptPath) { const receipt = await privateRead(state.receiptPath); delete receipt.token; await privateWrite(state.receiptPath, receipt); }
  await privateWrite(statePath, state);
  console.log(JSON.stringify({ purpose: state.purpose, ...state.cleanup, privateCredentialsRemoved: true, gmailMessageUntouched: true }));
} catch { console.error(JSON.stringify({ pass: false, cleanupStopped: true, noAutomaticRetry: true, inspectPrivateState: true })); process.exitCode = 1; }
