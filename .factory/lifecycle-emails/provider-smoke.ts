// Explicit operator smoke: actual Resend simulator only, isolated local DB, no human recipient or production DB.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const localUrl = 'postgres://postgres:radar@127.0.0.1:54329/radar_lifecycle_provider_20261103';
const result = spawnSync('railway', ['variables', '--service', 'web', '--json'], { encoding: 'utf8' });
if (result.status !== 0) throw new Error('Could not read existing sending configuration');
const runtime = JSON.parse(result.stdout);
if (!runtime.RESEND_API_KEY || runtime.MAIL_FROM !== 'Radar <radar@thally.io>') throw new Error('Unexpected sender configuration');
Object.assign(process.env, { DATABASE_URL: localUrl, NODE_ENV: 'development', RADAR_DEV_STUBS: '0',
  RADAR_SECRET_KEY: randomBytes(32).toString('hex'), RESEND_API_KEY: runtime.RESEND_API_KEY,
  MAIL_FROM: runtime.MAIL_FROM, APP_URL: 'https://radar.thally.io' });
const { db, pool, schema } = await import('../../src/server/db');
const { queueLifecycle } = await import('../../src/server/services/lifecycle/queue');
const { dispatchLifecycleBatch } = await import('../../src/server/services/lifecycle/dispatch');
const { randomToken, sha256 } = await import('../../src/server/crypto');
const { eq } = await import('drizzle-orm');
const recipient = `delivered+radar-lifecycle-${Date.now()}@resend.dev`;
if (!/^delivered\+radar-lifecycle-\d+@resend\.dev$/.test(recipient)) throw new Error('Simulator recipient required');
let uid: string | undefined;
try {
  const [user] = await db.insert(schema.users).values({ name: 'Radar delivery test', email: recipient, passwordHash: 'synthetic-local-fixture' }).returning();
  uid = user.id;
  const token = randomToken();
  await db.insert(schema.passwordResetTokens).values({ tokenHash: sha256(token), userId: uid, expiresAt: new Date(Date.now() + 3600e3) });
  await queueLifecycle(db, { type: 'welcome', userId: uid, eventKey: `provider-smoke:welcome:${uid}`, data: {} });
  await queueLifecycle(db, { type: 'password_reset', userId: uid, eventKey: `provider-smoke:reset:${uid}`, data: { resetUrl: `https://radar.thally.io/reset-password#token=${token}` } });
  await dispatchLifecycleBatch({ userIds: [uid], limit: 2 });
  const rows = await db.select({ type: schema.lifecycleEmails.type, status: schema.lifecycleEmails.status, providerId: schema.lifecycleEmails.providerId, attempts: schema.lifecycleEmails.attempts, error: schema.lifecycleEmails.lastError }).from(schema.lifecycleEmails).where(eq(schema.lifecycleEmails.userId, uid));
  console.log(JSON.stringify({ simulator: true, rows }));
  if (rows.length !== 2 || rows.some(row => row.status !== 'sent' || !row.providerId)) process.exitCode = 1;
} finally {
  if (uid) await db.delete(schema.users).where(eq(schema.users.id, uid));
  await pool.end();
}
