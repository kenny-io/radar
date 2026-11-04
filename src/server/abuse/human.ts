// Human-check seam (architecture §8). Passes when GUEST_TURNSTILE_SECRET_KEY is unset; otherwise Cloudflare siteverify.
// Called only when POST /api/b creates a guest. No widget is designed or shipped yet.
import { env } from '../env';

export async function verifyHuman(token: string | null | undefined, ip: string): Promise<boolean> {
  if (!env.guestTurnstileSecretKey) return true;
  if (!token) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env.guestTurnstileSecretKey, response: token, ...(ip && ip !== 'unknown' ? { remoteip: ip } : {}) }),
    });
    const j: any = await r.json().catch(() => ({}));
    return !!j.success;
  } catch (e: any) { console.warn('[abuse] human check unavailable', e?.message || e); return false; }
}

export const SIGNUP_TURNSTILE_ACTION = 'turnstile-spin-v2';
/** Signup and security-mail requests always fail closed outside explicit development stubs. */
export async function verifySignupHuman(token: string | null | undefined, ip: string): Promise<boolean> {
  if (env.devStubs && !env.isProd) return true;
  if (!env.turnstileSecretKey || !env.turnstileSiteKey || !token || token.length > 2048) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ secret: env.turnstileSecretKey, response: token, ...(ip && ip !== 'unknown' ? { remoteip: ip } : {}) }),
    });
    if (!r.ok) return false;
    const result: any = await r.json();
    return result.success === true && result.hostname === new URL(env.appUrl).hostname && result.action === SIGNUP_TURNSTILE_ACTION;
  } catch { return false; }
}
