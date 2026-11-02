// Public authentication endpoints share Postgres limits across every web replica.
import { env } from '../env';
import { sha256 } from '../crypto';
import { RadarError, forbidden } from '../errors';
import { clientIp } from '../abuse/ip';
import { enforce, HOUR } from '../abuse/rateLimit';

const tooMany = () => new RadarError('Too many sign-in attempts. Try again in 15 minutes.', 429, 'rate_limited');
export const AUTH_BODY_BYTES = 8192;
export const NEW_PASSWORD_BYTES = 72; // bcrypt compares only the first 72 UTF-8 bytes.

/** Missing Origin is allowed for API clients; browser cross-site requests are always refused. */
export function assertAuthOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (req.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== new URL(env.appUrl).origin)) throw forbidden();
}

export async function limitAuthIp(req: Request, mode: 'signup' | 'signin' | 'google') {
  const signup = mode === 'signup';
  await enforce([{ key: `auth:${mode}:ip:${clientIp(req)}`, limit: signup ? 10 : 30, windowSec: signup ? HOUR : 900,
    error: signup ? () => new RadarError('Too many account creation attempts. Try again in an hour.', 429, 'rate_limited') : tooMany }]);
}

export async function limitSigninAccount(email: string) {
  await enforce([{ key: `auth:signin:email:${sha256(email.trim().toLowerCase())}`, limit: 10, windowSec: 900, error: tooMany }]);
}

/** Stop reading oversized bodies even when Content-Length is absent or misleading. */
export async function authBody(req: Request): Promise<unknown> {
  const oversized = () => new RadarError('This request is too large.', 413, 'payload_too_large');
  if (Number(req.headers.get('content-length')) > AUTH_BODY_BYTES) throw oversized();
  const reader = req.body?.getReader();
  if (!reader) throw new RadarError('Enter your account details.', 400, 'invalid');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > AUTH_BODY_BYTES) { await reader.cancel(); throw oversized(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RadarError('Some fields aren’t valid.', 400, 'invalid'); }
}
