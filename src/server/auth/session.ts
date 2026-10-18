import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { eq, and, gt } from 'drizzle-orm';
import { db, schema } from '../db';
import { randomToken, sha256 } from '../crypto';
import { env } from '../env';

export const SESSION_COOKIE = 'radar_session';
const DAYS = 30;

export const hashPassword = (pw: string) => bcrypt.hash(pw, 11);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export async function createSession(userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + DAYS * 864e5);
  await db.insert(schema.sessions).values({ id: sha256(token), userId, expiresAt });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: env.isProd, path: '/', expires: expiresAt });
}

export async function destroySession() {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (t) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(t)));
  jar.delete(SESSION_COOKIE);
}

export async function currentUser() {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (!t) return null;
  const rows = await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
    .from(schema.sessions).innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sha256(t)), gt(schema.sessions.expiresAt, new Date()))).limit(1);
  return rows[0] || null;
}
