import { and, eq, gt, isNotNull, isNull } from 'drizzle-orm';
import { db, schema } from '../db';
import { randomToken, sha256 } from '../crypto';
import { env } from '../env';
import { RadarError } from '../errors';
import { enforce, HOUR } from '../abuse/rateLimit';
import { clientIp } from '../abuse/ip';
import { NEW_PASSWORD_BYTES } from './requests';
import { hashPassword, isGuestEmail } from './session';
import { queueLifecycle } from '../services/lifecycle/queue';

const RESET_LIFETIME_MS = 3600e3;
const badToken = () => new RadarError('This reset link has expired or has already been used. Request a new one.', 400, 'invalid_reset');
const tooMany = () => new RadarError('Too many password reset attempts. Try again later.', 429, 'rate_limited');

export async function limitResetRequest(req: Request, email: string) {
  await enforce([
    { key: `auth:reset-request:ip:${clientIp(req)}`, limit: 10, windowSec: 900, error: tooMany },
    { key: `auth:reset-request:email:${sha256(email)}`, limit: 3, windowSec: HOUR, error: tooMany },
  ]);
}

export async function limitResetConsume(req: Request) {
  await enforce([{ key: `auth:reset-consume:ip:${clientIp(req)}`, limit: 10, windowSec: 900, error: tooMany }]);
}

/** No provider request or account-existence result leaves this function. Unknown and Google-only accounts are no-ops. */
export async function requestPasswordReset(email: string) {
  if (isGuestEmail(email)) return;
  await db.transaction(async tx => {
    // Serialize requests and resets for one account before inserting a new token.
    const [user] = await tx.select().from(schema.users).where(and(eq(schema.users.email, email), eq(schema.users.guest, false), isNotNull(schema.users.passwordHash))).for('update');
    if (!user) return;
    const token = randomToken(32);
    const tokenHash = sha256(token);
    await tx.insert(schema.passwordResetTokens).values({ tokenHash, userId: user.id, expiresAt: new Date(Date.now() + RESET_LIFETIME_MS) });
    // Fragment never reaches access logs, HTTP requests or Referrer headers. Only the encrypted mail payload retains it.
    const resetUrl = `${env.appUrl}/reset-password#token=${encodeURIComponent(token)}`;
    await queueLifecycle(tx, { type: 'password_reset', userId: user.id, eventKey: `password-reset:${tokenHash}`, data: { name: user.name, resetUrl } });
  });
}

export async function consumePasswordReset(token: string, password: string) {
  if (password.length < 8) throw new RadarError('Use at least 8 characters.', 400, 'invalid_password');
  if (Buffer.byteLength(password, 'utf8') > NEW_PASSWORD_BYTES) throw new RadarError('Use a password of 72 bytes or fewer (some characters use more than one byte).', 400, 'invalid_password');
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw badToken();
  const R = schema.passwordResetTokens;
  const hash = sha256(token);
  const [candidate] = await db.select({ userId: R.userId }).from(R).where(and(eq(R.tokenHash, hash), isNull(R.usedAt), gt(R.expiresAt, new Date()))).limit(1);
  if (!candidate) throw badToken();
  const passwordHash = await hashPassword(password);
  await db.transaction(async tx => {
    // A user lock, before any token row lock, prevents two distinct valid tokens from racing or deadlocking.
    const [user] = await tx.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.id, candidate.userId), eq(schema.users.guest, false), isNotNull(schema.users.passwordHash))).for('update');
    if (!user) throw badToken();
    const now = new Date();
    const [consumed] = await tx.update(R).set({ usedAt: now }).where(and(eq(R.tokenHash, hash), eq(R.userId, user.id), isNull(R.usedAt), gt(R.expiresAt, now))).returning({ userId: R.userId });
    if (!consumed) throw badToken();
    await tx.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, user.id));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
    await tx.update(R).set({ usedAt: now }).where(and(eq(R.userId, user.id), isNull(R.usedAt)));
  });
}
