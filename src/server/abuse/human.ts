// Human-check seam (architecture §8). Passes when TURNSTILE_SECRET_KEY is unset; otherwise Cloudflare siteverify.
// Called only when POST /api/b creates a guest. No widget is designed or shipped yet.
import { env } from '../env';

export async function verifyHuman(token: string | null | undefined, ip: string): Promise<boolean> {
  if (!env.turnstileSecretKey) return true;
  if (!token) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env.turnstileSecretKey, response: token, ...(ip && ip !== 'unknown' ? { remoteip: ip } : {}) }),
    });
    const j: any = await r.json().catch(() => ({}));
    return !!j.success;
  } catch (e: any) { console.warn('[abuse] human check unavailable', e?.message || e); return false; }
}
