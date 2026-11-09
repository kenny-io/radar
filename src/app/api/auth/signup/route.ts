// Passwords are chosen only by the inbox holder, at confirmation. Signup never authenticates.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { isGuestEmail } from '@/server/auth/session';
import { handle, json } from '@/server/http/handle';
import { EMAIL_RE } from '@/lib/format';
import { assertAuthOrigin, authBody, limitAuthIp } from '@/server/auth/requests';
import { guardVerificationRequest, sendVerification, verificationResult } from '@/server/auth/verification';

const Body = z.object({ name: z.string().max(200), email: z.string().max(320), next: z.string().max(2000).optional(), turnstileToken: z.string().max(2048).optional() });
export const POST = handle(async (req: Request) => {
  assertAuthOrigin(req);
  await limitAuthIp(req, 'signup');
  const b = Body.parse(await authBody(req));
  const errors: Record<string, string> = {};
  if (!b.name.trim()) errors.name = 'Add your name';
  if (!EMAIL_RE.test(b.email.trim()) || isGuestEmail(b.email)) errors.email = 'Enter a valid email';
  if (Object.keys(errors).length) return json({ ok: false, errors }, 400);
  const email = b.email.trim().toLowerCase();
  await guardVerificationRequest(req, email, b.turnstileToken);
  const [created] = await db.insert(schema.users).values({ name: b.name.trim(), email }).onConflictDoNothing({ target: schema.users.email }).returning();
  const user = created || (await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1))[0];
  if (user && !user.guest && !user.emailVerifiedAt && !user.googleSub) await sendVerification(user, b.next);
  return json(verificationResult);
});
