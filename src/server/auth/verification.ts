// Mailbox confirmation and safe recovery of legacy unverified password accounts.
import { and, eq, gt, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { env } from '../env';
import { randomToken, sha256 } from '../crypto';
import { RadarError } from '../errors';
import { clientIp } from '../abuse/ip';
import { enforce, HOUR } from '../abuse/rateLimit';
import { verifySignupHuman } from '../abuse/human';
import { sendAuthMail } from '../services/mail';
import { safeNext } from '../billing/guard';
import { hashPassword } from './session';

export const VERIFICATION_MINUTES = 30;
export const verificationResult = { ok: true, verificationRequired: true } as const;
const unavailable = () => new RadarError('Account confirmation is temporarily unavailable. Please try again later.', 503, 'auth_unavailable');
const invalid = () => new RadarError('This confirmation link has expired or already been used. Request a new email.', 400, 'verification_invalid');

/** Check config before looking up an address, so missing configuration cannot enumerate accounts. */
export function assertVerificationConfigured() {
  if (env.devStubs && !env.isProd) return;
  if (!env.resendKey) throw unavailable();
  if (!env.signupTurnstileRequired) return;
  if (!env.turnstileSiteKey || !env.turnstileSecretKey) throw unavailable();
  // Cloudflare's public test credentials must never become production bot protection.
  if (env.isProd && (/^[123]x00000000000000000000/.test(env.turnstileSiteKey) || /^[123]x00000000000000000000/.test(env.turnstileSecretKey))) throw unavailable();
}

export async function guardVerificationRequest(req: Request, email: string, token?: string) {
  assertVerificationConfigured();
  await enforce([{ key: `auth:verification:shared-ip:${clientIp(req)}`, limit: 10, windowSec: HOUR, error: () => new RadarError('Too many account confirmation attempts. Try again in an hour.', 429, 'rate_limited') }]);
  if (env.signupTurnstileRequired && !(await verifySignupHuman(token, clientIp(req)))) throw new RadarError('Radar couldn’t confirm you’re a person. Please try again.', 403, 'human_check_failed');
  await enforce([
    { key: `auth:verification:email:${sha256(email)}`, limit: 3, windowSec: HOUR, error: () => new RadarError('Please wait before requesting another confirmation email.', 429, 'rate_limited') },
    { key: 'auth:verification:global', limit: 300, windowSec: HOUR, error: () => new RadarError('Account confirmation is busy. Please try again later.', 503, 'busy') },
  ]);
}

export async function sendVerification(user: Pick<typeof schema.users.$inferSelect, 'id' | 'email'>, next?: string | null) {
  const token = randomToken(32);
  const hash = sha256(token);
  await db.insert(schema.emailVerificationTokens).values({ tokenHash: hash, userId: user.id, email: user.email,
    expiresAt: new Date(Date.now() + VERIFICATION_MINUTES * 60000), next: safeNext(next),
  });
  try {
    await sendAuthMail(user.email, `Confirm your email for Radar\n\nOpen this link to confirm your email and choose your password:\n${env.appUrl}/verify-email#token=${token}\n\nThis link works once and expires in ${VERIFICATION_MINUTES} minutes. If you did not request this, you can ignore this email. No account access is granted until you confirm.`);
  } catch {
    await db.delete(schema.emailVerificationTokens).where(eq(schema.emailVerificationTokens.tokenHash, hash));
    throw new RadarError('Radar couldn’t send the confirmation email. Please try again.', 503, 'mail_unavailable');
  }
}

/** Locks identity before token consumption. Multiple distinct links and double submissions cannot activate twice. */
export async function confirmEmail(token: string, password: string) {
  const tokenHash = sha256(token);
  // Do not spend bcrypt CPU on unknown or expired tokens.
  const [candidate] = await db.select().from(schema.emailVerificationTokens).where(and(eq(schema.emailVerificationTokens.tokenHash, tokenHash), gt(schema.emailVerificationTokens.expiresAt, new Date()))).limit(1);
  if (!candidate) throw invalid();
  const passwordHash = await hashPassword(password);
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM users WHERE id = ${candidate.userId} FOR UPDATE`);
    const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, candidate.userId)).limit(1);
    if (!user || user.guest || user.emailVerifiedAt || user.googleSub || user.email !== candidate.email) throw invalid();
    const [consumed] = await tx.delete(schema.emailVerificationTokens).where(and(eq(schema.emailVerificationTokens.tokenHash, tokenHash), gt(schema.emailVerificationTokens.expiresAt, new Date()))).returning();
    if (!consumed) throw invalid();
    const [verified] = await tx.update(schema.users).set({ passwordHash, emailVerifiedAt: new Date() }).where(eq(schema.users.id, user.id)).returning();
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
    await tx.delete(schema.emailVerificationTokens).where(eq(schema.emailVerificationTokens.userId, user.id));
    return { user: verified, next: consumed.next };
  });
}
