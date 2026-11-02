import { cookies } from 'next/headers';
import { and, eq, gt } from 'drizzle-orm';
import { db, schema } from '../db';
import { env } from '../env';
import { randomToken } from '../crypto';

export const GOOGLE_STATE_COOKIE = 'radar_google_state';
const STATE_SECONDS = 600;

export async function createGoogleState(next: string) {
  const state = randomToken(32);
  await db.insert(schema.oauthStates).values({ state, provider: 'google-signin', data: { next } });
  (await cookies()).set(GOOGLE_STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', secure: env.isProd, path: '/', maxAge: STATE_SECONDS });
  return state;
}

/** A state is valid only in the browser that started it and can be consumed once, for ten minutes. */
export async function consumeGoogleState(state: string) {
  const jar = await cookies();
  if (!state || state.length > 256 || jar.get(GOOGLE_STATE_COOKIE)?.value !== state) return null;
  jar.delete(GOOGLE_STATE_COOKIE);
  const [st] = await db.delete(schema.oauthStates).where(and(eq(schema.oauthStates.state, state),
    eq(schema.oauthStates.provider, 'google-signin'), gt(schema.oauthStates.createdAt, new Date(Date.now() - STATE_SECONDS * 1000)))).returning();
  return st || null;
}
