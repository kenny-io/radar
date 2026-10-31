import { randomUUID } from 'node:crypto';
import { env } from '../env';
import { forbidden, RadarError } from '../errors';
import { clientIp } from '../abuse/ip';
import { enforce, HOUR } from '../abuse/rateLimit';
import { accountOf, ownAccess } from './access';
import { BillingError } from './errors';
import { getProvider } from './provider';

/** APP_URL is the only authority for the destination; request bodies and forwarded hosts cannot override it. */
export function portalReturnUrl(lapsed = false): string {
  try {
    const app = new URL(env.appUrl);
    if (app.username || app.password || (app.protocol !== 'https:' && (env.isProd || app.protocol !== 'http:')))
      throw new Error('invalid app url');
    return new URL(lapsed ? '/start-trial' : '/settings?section=billing', app).toString();
  } catch { throw BillingError.unavailable(); }
}

export function assertPortalOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (req.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== new URL(portalReturnUrl()).origin)) throw forbidden();
}

export async function openBillingPortal(u: { id: string; email?: string }, req: Request): Promise<{ url: string }> {
  assertPortalOrigin(req);
  const p = await getProvider();
  if (!p || p.name !== 'stripe') throw BillingError.unavailable();
  const a = await accountOf(u.id);
  if (!a?.stripeCustomerId) throw BillingError.noSubscription();
  await enforce([
    { key: `billing_portal:user:${u.id}`, limit: 20, windowSec: HOUR, error: () => new RadarError('Too many billing requests. Try again in an hour.', 429, 'rate_limited') },
    { key: `billing_portal:ip:${clientIp(req)}`, limit: 50, windowSec: HOUR, error: () => new RadarError('Too many billing requests. Try again in an hour.', 429, 'rate_limited') },
  ]);
  const returnUrl = portalReturnUrl(!(await ownAccess(u)));
  try {
    const s = await p.createPortalSession({ customer: a.stripeCustomerId, returnUrl, configuration: env.stripePortalConfigurationId || undefined }, `radar:portal:${u.id}:${randomUUID()}`);
    const url = new URL(s.url);
    if (url.protocol !== 'https:' || url.hostname !== 'billing.stripe.com' || url.username || url.password) throw new Error('invalid portal destination');
    return { url: s.url };
  } catch {
    // A portal URL contains a bearer secret. Neither it nor a raw provider error belongs in logs or user copy.
    throw BillingError.unavailable();
  }
}
