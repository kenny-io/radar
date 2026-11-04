// Phase-gated live account proof. Prepare is offline; every mutation needs explicit PM authorization.
// Never print identity, passwords, bearer links, cookies, database credentials, or provider responses.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import { spawnSync } from 'node:child_process';

const [phase, inputPath] = process.argv.slice(2);
const allowed = new Set(['prepare', 'signup', 'capture-receipt', 'confirm', 'audit', 'cleanup-preview']);
assert(allowed.has(phase) && inputPath, 'Expected prepare|signup|capture-receipt|confirm|audit|cleanup-preview and private input/state path');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
async function readPrivate(file) {
  const stat = await fs.lstat(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0, 'Private input must be a regular 0600 file');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
async function savePrivate(file, value, createOnly = false) {
  const directory = path.dirname(file); await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory); assert(stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o077), 'Private state directory must be 0700');
  if (createOnly) { await fs.writeFile(file, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); return; }
  const temporary = file + '.' + crypto.randomBytes(8).toString('hex');
  await fs.writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, file);
}
function validateState(state) {
  assert.equal(state.base, 'https://radar.thally.io');
  assert(/^[^@+]+\+radar-signup-[a-z0-9-]+@gmail\.com$/i.test(state.recipient), 'Use a new owner-approved Gmail plus alias');
  assert(/^[0-9a-f]{40}$/.test(state.sourceCommit), 'Full expected release commit required');
  assert.equal(state.purpose, 'signup-security-live-confirmation');
}
function authorize() { assert.equal(process.env.RADAR_RELEASE_PROBE_APPROVED, '1', 'Mutation phase requires explicit PM authorization'); }
// SQL and params remain separate through a base64 JSON payload. Runtime DB credentials never leave Railway.
const REMOTE_READ = String.raw`(async()=>{const pg=require("pg");const q=JSON.parse(Buffer.from(process.argv[1],"base64").toString("utf8"));if(typeof q.sql!=="string"||!/^\s*SELECT\b/i.test(q.sql)||/[;]|--|\/\*/.test(q.sql)||!Array.isArray(q.params))throw Error("read-only query required");const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});try{await client.connect();await client.query("BEGIN READ ONLY");await client.query("SET LOCAL statement_timeout = 10000");const result=await client.query(q.sql,q.params);await client.query("ROLLBACK");process.stdout.write("RADAR_PROBE_JSON:"+JSON.stringify({rows:result.rows})+"\n");}finally{await client.end();}})().catch(()=>{process.stderr.write("Scoped read-only probe failed\n");process.exitCode=1;});`;
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
async function connect(state) {
  if (state.dbTransport === 'railway-ssh') return {
    query: async (sql, params = []) => {
      if (sql === 'SET statement_timeout = 10000') return { rows: [] };
      assert(/^\s*SELECT\b/i.test(sql) && !/[;]|--|\/\*/.test(sql) && Array.isArray(params), 'Only scoped SELECT queries are allowed');
      const payload = Buffer.from(JSON.stringify({ sql, params })).toString('base64');
      const result = spawnSync('railway', ['ssh', '-p', '863ea66d-04b9-40e8-b27f-89a4f75c026e', '-e', '168aae6e-c038-4198-910a-e388afaac157', '-s', '0c4df5c5-938d-421e-a16a-1c0781ac5118', 'node', '-e', shellQuote(REMOTE_READ), shellQuote(payload)], { encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 });
      if (result.status !== 0 || result.error) throw new Error('Scoped Railway database read unavailable');
      const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('RADAR_PROBE_JSON:'));
      assert(line, 'Scoped database result missing'); const decoded = JSON.parse(line.slice('RADAR_PROBE_JSON:'.length)); assert(Array.isArray(decoded.rows)); return decoded;
    },
    end: async () => {},
  };
  assert(!state.dbTransport || state.dbTransport === 'direct', 'Unsupported database transport');
  const secrets = await readPrivate(state.dbEnvPath); assert(secrets.DATABASE_URL, 'Private DATABASE_URL missing');
  const pool = new pg.Pool({ connectionString: secrets.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
  await pool.query('SET statement_timeout = 10000'); return pool;
}

function getCookie(response, name) {
  return (response.headers.getSetCookie?.() || []).find(value => value.startsWith(name + '='));
}
function cookieValue(setCookie) { return setCookie?.split(';', 1)[0].split('=').slice(1).join('=') || ''; }
async function request(state, endpoint, body, session = '') {
  assert(/^\/api\/(auth\/(signup|signin|signout|verify-email)|me)$/.test(endpoint), 'Probe endpoint not allowlisted');
  const response = await fetch(state.base + endpoint, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'manual', signal: AbortSignal.timeout(20000),
    headers: { origin: state.base, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(session ? { cookie: 'radar_session=' + session } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text(); let data; try { data = JSON.parse(text); } catch { throw new Error('Probe received non-JSON response'); }
  return { response, data };
}
async function ownRows(pool, state) {
  const users = (await pool.query('SELECT id, guest, password_hash IS NOT NULL AS has_password, email_verified_at IS NOT NULL AS verified, google_sub IS NOT NULL AS has_google, created_at FROM users WHERE email=$1', [state.recipient])).rows;
  assert(users.length <= 1, 'Unexpected test identity collision');
  if (!users[0]) return { user: null, counts: { users: 0 } };
  const user = users[0]; assert(new Date(user.created_at).getTime() >= new Date(state.preparedAt).getTime() - 1000, 'Refusing to inspect pre-existing identity');
  if (state.userId) assert.equal(user.id, state.userId, 'Probe identity changed');
  const counts = (await pool.query(`SELECT
    (SELECT count(*)::int FROM sessions WHERE user_id=$1) AS sessions,
    (SELECT count(*)::int FROM email_verification_tokens WHERE user_id=$1) AS tokens,
    (SELECT count(*)::int FROM businesses WHERE owner_id=$1) AS businesses,
    (SELECT count(*)::int FROM members WHERE user_id=$1) AS members,
    (SELECT count(*)::int FROM billing_accounts WHERE user_id=$1) AS billing,
    (SELECT count(*)::int FROM events WHERE user_id=$1) AS events`, [user.id])).rows[0];
  return { user, counts };
}
async function assertNoPaidData(pool, state) {
  const rows = await ownRows(pool, state);
  assert(rows.user && !rows.user.guest && !rows.user.has_google);
  assert.equal(rows.counts.businesses, 0); assert.equal(rows.counts.members, 0); assert.equal(rows.counts.billing, 0);
  return rows;
}
async function captureReceipt(state) {
  // Read-only provider lookup; Gmail metadata remains the proof of actual inbox delivery.
  const gmail = await readPrivate(state.gmailReceiptPath);
  assert.equal(gmail.recipient, state.recipient); assert.equal(gmail.subject, 'Confirm your email for Radar');
  assert(gmail.messageId && gmail.rfcMessageId && gmail.receivedAt);
  assert(new Date(gmail.receivedAt).getTime() >= new Date(state.preparedAt).getTime() - 1000);
  const secrets = await readPrivate(state.dbEnvPath); const key = secrets.RESEND_API_KEY; assert(key, 'Private Resend key unavailable');
  async function providerGet(endpoint) {
    const response = await fetch('https://api.resend.com' + endpoint, { headers: { authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Object.assign(new Error('Provider receipt read unavailable'), { safeStatus: response.status });
    return response.json();
  }
  const listing = await providerGet('/emails'); assert(Array.isArray(listing.data));
  const matches = listing.data.filter(mail => Array.isArray(mail.to) && mail.to.map(value => value.toLowerCase()).includes(state.recipient.toLowerCase()) && mail.subject === gmail.subject && new Date(mail.created_at).getTime() >= new Date(state.preparedAt).getTime() - 1000);
  assert(matches.length >= 1 && matches.length <= 5, 'Expected a bounded set of this test recipient’s recent messages');
  let sent;
  for (const candidate of matches) {
    // Some provider list versions omit message_id. Retrieve only this exact recipient/subject's recent candidates.
    if (candidate.message_id && candidate.message_id !== gmail.rfcMessageId) continue;
    const detail = await providerGet('/emails/' + encodeURIComponent(candidate.id));
    assert(Array.isArray(detail.to) && detail.to.map(value => value.toLowerCase()).includes(state.recipient.toLowerCase()));
    assert.equal(detail.subject, gmail.subject);
    if (detail.message_id === gmail.rfcMessageId) { assert(!sent, 'Duplicate provider message identity'); sent = detail; }
  }
  assert(sent, 'Expected one outbound message matching actual inbox RFC Message-ID');
  const tokens = [...new Set([...String(sent.text || '').matchAll(/https:\/\/radar\.thally\.io\/verify-email#token=([A-Za-z0-9_-]{43})/g)].map(match => match[1]))];
  assert.equal(tokens.length, 1, 'Expected one private confirmation token');
  await savePrivate(state.receiptPath, { recipient: state.recipient, token: tokens[0], messageId: gmail.messageId, rfcMessageId: gmail.rfcMessageId, receivedAt: gmail.receivedAt, providerId: sent.id }, true);
  return { actualInboxMetadataMatched: true, providerRfcMessageIdMatched: true, privateTokenCaptured: true };
}
function evidence(state, checks) {
  return { purpose: state.purpose, expectedSourceCommit: state.sourceCommit, phase, at: new Date().toISOString(), checks };
}
async function persist(state, checks, statePath) {
  state.evidence ||= []; state.evidence.push(evidence(state, checks)); await savePrivate(statePath, state);
  console.log(JSON.stringify(state.evidence.at(-1))); // Boolean/count evidence only.
}

let state; let pool; let statePath = inputPath;
try {
  if (phase === 'prepare') {
    const input = await readPrivate(inputPath); statePath = input.statePath;
    assert(statePath && path.isAbsolute(statePath));
    state = { ...input, purpose: 'signup-security-live-confirmation', stage: 'prepared', preparedAt: new Date().toISOString(), password: crypto.randomBytes(24).toString('base64url'), session: '' };
    delete state.statePath; validateState(state); await savePrivate(statePath, state, true);
    console.log(JSON.stringify({ phase, ready: true, networkRequests: 0 }));
  } else {
    state = await readPrivate(statePath); validateState(state);
    if (phase === 'signup') {
      authorize(); assert.equal(state.stage, 'prepared'); pool = await connect(state);
      assert.equal((await ownRows(pool, state)).user, null, 'Refusing signup for an existing address');
      state.stage = 'signup-in-flight'; await savePrivate(statePath, state); // Ambiguous transport is never automatically retried.
      const { response, data } = await request(state, '/api/auth/signup', { name: 'Radar signup security release check', email: state.recipient });
      assert.equal(response.status, 200); assert.deepEqual(data, { ok: true, verificationRequired: true });
      assert(!cookieValue(getCookie(response, 'radar_session')), 'Signup unexpectedly authenticated');
      assert(response.headers.get('cache-control')?.includes('no-store'));
      const me = await request(state, '/api/me'); assert.equal(me.response.status, 401);
      const rows = await assertNoPaidData(pool, state); state.userId = rows.user.id;
      assert.equal(rows.user.verified, false); assert.equal(rows.user.has_password, false); assert.equal(rows.counts.sessions, 0); assert.equal(rows.counts.tokens, 1);
      const mails = (await pool.query('SELECT status, text, html FROM outbox_emails WHERE "to"=$1 AND created_at >= $2 ORDER BY created_at', [state.recipient, state.preparedAt])).rows;
      assert.equal(mails.length, 1); assert.equal(mails[0].status, 'sent'); assert.equal(mails[0].text, '[Security email content redacted]'); assert.equal(mails[0].html, null);
      state.stage = 'awaiting-mail'; state.signupAt = new Date().toISOString();
      await persist(state, { signupPending: true, noAuthenticatedSession: true, protectedMeDenied: true, tokenRows: 1, providerAccepted: true, productionOutboxRedacted: true, businessRows: 0, billingRows: 0 }, statePath);
    } else if (phase === 'capture-receipt') {
      assert.equal(state.stage, 'awaiting-mail');
      const checks = await captureReceipt(state); await persist(state, checks, statePath);
    } else if (phase === 'confirm') {
      authorize(); assert.equal(state.stage, 'awaiting-mail'); pool = await connect(state);
      const receipt = await readPrivate(state.receiptPath);
      assert.equal(receipt.recipient, state.recipient); assert(receipt.messageId && receipt.receivedAt); assert(/^[A-Za-z0-9_-]{43}$/.test(receipt.token));
      const stored = (await pool.query('SELECT token_hash, expires_at FROM email_verification_tokens WHERE user_id=$1', [state.userId])).rows;
      assert.equal(stored.length, 1); assert.equal(stored[0].token_hash, sha(receipt.token)); assert(new Date(stored[0].expires_at) > new Date());
      state.stage = 'confirmation-in-flight'; await savePrivate(statePath, state);
      const confirmed = await request(state, '/api/auth/verify-email', { token: receipt.token, password: state.password });
      assert.equal(confirmed.response.status, 200); assert.deepEqual(confirmed.data, { ok: true, next: '/onboarding' });
      const setCookie = getCookie(confirmed.response, 'radar_session'); const session = cookieValue(setCookie);
      assert(session && /;\s*HttpOnly/i.test(setCookie) && /;\s*Secure/i.test(setCookie) && /;\s*SameSite=Lax/i.test(setCookie));
      state.session = session; await savePrivate(statePath, state); // Needed only to revoke this test session if a later check fails.
      const me = await request(state, '/api/me', undefined, session); assert.equal(me.response.status, 200); assert.equal(me.data.user.id, state.userId); assert.equal(me.data.businesses.length, 0);
      const replay = await request(state, '/api/auth/verify-email', { token: receipt.token, password: state.password }); assert.equal(replay.response.status, 400); assert.equal(replay.data.code, 'verification_invalid');
      const out = await request(state, '/api/auth/signout', {}, session); assert.equal(out.response.status, 200);
      assert.equal((await request(state, '/api/me', undefined, session)).response.status, 401); state.session = ''; await savePrivate(statePath, state);
      const signin = await request(state, '/api/auth/signin', { email: state.recipient, password: state.password }); assert.equal(signin.response.status, 200); assert.equal(signin.data.next, '/onboarding');
      const fresh = cookieValue(getCookie(signin.response, 'radar_session')); assert(fresh && fresh !== session); state.session = fresh; await savePrivate(statePath, state);
      assert.equal((await request(state, '/api/me', undefined, fresh)).data.user.id, state.userId);
      assert.equal((await request(state, '/api/auth/signout', {}, fresh)).response.status, 200); state.session = '';
      const rows = await assertNoPaidData(pool, state); assert.equal(rows.user.verified, true); assert.equal(rows.user.has_password, true); assert.equal(rows.counts.tokens, 0); assert.equal(rows.counts.sessions, 0);
      state.stage = 'verified'; state.mailReceipt = { messageId: receipt.messageId, receivedAt: receipt.receivedAt }; state.confirmedAt = new Date().toISOString();
      await persist(state, { actualInboxReceipt: true, tokenHashMatchesReceipt: true, confirmationAuthenticated: true, secureCookie: true, protectedMeAllowed: true, tokenReplayRejected: true, signoutRevokedSession: true, passwordSigninWorks: true, finalSessions: 0, finalTokens: 0, businessRows: 0, billingRows: 0 }, statePath);
    } else {
      pool = await connect(state); const rows = await ownRows(pool, state);
      console.log(JSON.stringify(evidence(state, { stage: state.stage, userPresent: !!rows.user, verified: !!rows.user?.verified, ...rows.counts, cleanupNotExecuted: true })));
    }
  }
} catch (error) {
  // Error.message from database/fetch libraries can contain identity/connection details. Do not emit it.
  console.error(JSON.stringify({ phase, pass: false, reason: error instanceof assert.AssertionError ? 'Probe assertion failed; inspect source and private state' : 'Probe operation failed; inspect private state', noAutomaticRetry: true, ...(Number.isInteger(error?.safeStatus) ? { providerReadStatus: error.safeStatus } : {}) }));
  process.exitCode = 1;
} finally { if (pool) await pool.end(); }
