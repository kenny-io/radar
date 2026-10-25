import { cookies } from 'next/headers';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq, and, gt, lt, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { randomToken, sha256 } from '../crypto';
import { env } from '../env';
import type { User } from '@/lib/types';

export const SESSION_COOKIE = 'radar_session';
/** Anonymous onboarding visitor (architecture §6). Its own cookie, so currentUser() never sees it. */
export const GUEST_COOKIE = 'radar_guest';
const DAYS = 30;
const GUEST_HOURS = 72;
export const GUEST_EMAIL_DOMAIN = 'guest.radar.invalid';
export const isGuestEmail = (email: string) => email.trim().toLowerCase().endsWith('@' + GUEST_EMAIL_DOMAIN);

export type SessionUser = User;
/** A signed-in user or a guest. A guest only ever has an Owner member row on its own onboarding draft. */
export type Actor = SessionUser & { guest: boolean };

export const hashPassword = (pw: string) => bcrypt.hash(pw, 11);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
const cookieOpts = (expires: Date) => ({ httpOnly: true, sameSite: 'lax' as const, secure: env.isProd, path: '/', expires });
const userCols = { id: schema.users.id, name: schema.users.name, email: schema.users.email, appearance: schema.users.appearance };

export async function createSession(userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + DAYS * 864e5);
  await db.insert(schema.sessions).values({ id: sha256(token), userId, expiresAt });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieOpts(expiresAt));
}

/** Sign out: ends the user session and any guest session in this browser, and clears both cookies. */
export async function destroySession() {
  const jar = await cookies();
  for (const name of [SESSION_COOKIE, GUEST_COOKIE]) {
    const t = jar.get(name)?.value;
    if (t) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(t)));
    jar.delete(name);
  }
}

/** The signed-in user. Never a guest: reads only radar_session and filters guest = false. */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (!t) return null;
  const rows = await db.select(userCols)
    .from(schema.sessions).innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sha256(t)), gt(schema.sessions.expiresAt, new Date()), eq(schema.users.guest, false))).limit(1);
  return rows[0] || null;
}

/** The guest of this browser (radar_guest, live session, guest = true). Read-only: safe in pages and guards. */
export async function currentGuest(): Promise<Actor | null> {
  const jar = await cookies();
  const t = jar.get(GUEST_COOKIE)?.value;
  if (!t) return null;
  const rows = await db.select(userCols)
    .from(schema.sessions).innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sha256(t)), gt(schema.sessions.expiresAt, new Date()), eq(schema.users.guest, true))).limit(1);
  return rows[0] ? { ...rows[0], guest: true } : null;
}

/** User first, then guest. Only POST /api/b, /api/b/:bid/{act,workspace,events} and GSC OAuth use it. */
export async function currentActor(): Promise<Actor | null> {
  const u = await currentUser();
  if (u) return { ...u, guest: false };
  return currentGuest();
}

/** Create a guest row and its 72h session, and set radar_guest. Route handlers only (sets a cookie). */
export async function createGuest(): Promise<Actor> {
  const [u] = await db.insert(schema.users).values({ name: '', email: `guest+${crypto.randomUUID()}@${GUEST_EMAIL_DOMAIN}`, guest: true }).returning(userCols);
  const token = randomToken();
  const expiresAt = new Date(Date.now() + GUEST_HOURS * 3600e3);
  await db.insert(schema.sessions).values({ id: sha256(token), userId: u.id, expiresAt });
  (await cookies()).set(GUEST_COOKIE, token, cookieOpts(expiresAt));
  return { ...u, guest: true };
}

/** Slide the guest session to 72h from now, at most once an hour (each guest write). Route handlers only. */
export async function touchGuest() {
  const jar = await cookies();
  const t = jar.get(GUEST_COOKIE)?.value;
  if (!t) return;
  const r = await db.update(schema.sessions).set({ expiresAt: sql`now() + interval '${sql.raw(String(GUEST_HOURS))} hours'` })
    .where(and(eq(schema.sessions.id, sha256(t)), gt(schema.sessions.expiresAt, new Date()), lt(schema.sessions.expiresAt, new Date(Date.now() + (GUEST_HOURS - 1) * 3600e3))))
    .returning({ expiresAt: schema.sessions.expiresAt });
  if (r[0]) jar.set(GUEST_COOKIE, t, cookieOpts(r[0].expiresAt));
}

/** Route handlers only. */
export async function clearGuestCookie() {
  const jar = await cookies();
  if (jar.get(GUEST_COOKIE)) jar.delete(GUEST_COOKIE);
}
