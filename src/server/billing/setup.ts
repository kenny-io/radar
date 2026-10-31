// Standalone provisioning: no customer, payment or subscription mutations. The CLI owns secret persistence.
import { createHash } from 'node:crypto';
import { PRICE_CENTS, WEBHOOK_EVENTS } from '../../lib/billing';

export const BILLING_LOOKUP_KEY = 'radar_monthly_usd_50_v1';
const META = { radar_app: 'radar', radar_config_version: '1' };
type Obj = Record<string, any>;
export type SetupRequest = (method: 'GET' | 'POST', path: string, options?: { params?: Obj; key?: string }) => Promise<any>;
export class BillingSetupError extends Error {}
const fail = (message: string): never => { throw new BillingSetupError(message); };

export interface BillingSetupOptions {
  apply: boolean;
  allowLive?: boolean;
  secretKey: string;
  publishableKey?: string;
  appUrl: string;
  apiVersion: string;
  priceId?: string;
  portalConfigurationId?: string;
  webhookEndpointId?: string;
  webhookSecret?: string;
  savedWebhookSecret?: string;
  savedWebhookEndpointId?: string;
  /** Persist a newly issued secret immediately, even if subsequent response validation fails. */
  persistWebhookSecret?: (result: BillingSetupResult) => Promise<void>;
}
export interface BillingSetupResult {
  mode: 'test' | 'live';
  appUrl: string;
  apiVersion: string;
  priceId: string | null;
  portalConfigurationId: string | null;
  webhookEndpointId: string | null;
  /** Must only be persisted in the protected output file, never logged or serialized to stdout. */
  webhookSecret: string | null;
  created: string[];
  missing: string[];
  warnings: string[];
}

export function setupMode(secretKey: string): 'test' | 'live' {
  const mode = /^(?:sk|rk)_(test|live)_[A-Za-z0-9]+$/.exec(secretKey)?.[1];
  if (!mode) return fail('Set STRIPE_SECRET_KEY to a Stripe test or live secret/restricted key.');
  return mode as 'test' | 'live';
}
export function setupAppUrl(value: string, mode: 'test' | 'live'): string {
  let u: URL;
  try { u = new URL(value); } catch { return fail('APP_URL must be an absolute HTTP(S) origin.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.username || u.password || u.search || u.hash || !['', '/'].includes(u.pathname) ||
    (u.protocol !== 'https:' && !(mode === 'test' && local && u.protocol === 'http:')) || (mode === 'live' && local))
    return fail('APP_URL must be an HTTPS origin; test mode alone permits HTTP on localhost.');
  return u.origin;
}
const validId = (id: string, prefix: string, setting: string) => {
  if (!new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(id)) fail(`${setting} is not a valid Stripe object ID.`);
  return encodeURIComponent(id);
};
const owned = (o: Obj) => o.metadata?.radar_app === META.radar_app && o.metadata?.radar_config_version === META.radar_config_version;
const one = (items: Obj[], label: string): Obj | null => {
  if (items.length > 1) return fail(`Multiple matching ${label} found. Set the explicit Stripe object ID after reviewing the account.`);
  return items[0] || null;
};
function assertMode(o: Obj, live: boolean, label: string) {
  if (o.livemode !== live) fail(`${label} does not match STRIPE_SECRET_KEY mode.`);
}
export function assertSetupPrice(p: Obj, live: boolean) {
  assertMode(p, live, 'STRIPE_PRICE_ID');
  if (!p.active || p.type !== 'recurring' || p.currency !== 'usd' || p.unit_amount !== PRICE_CENTS ||
    p.billing_scheme !== 'per_unit' || p.recurring?.interval !== 'month' || p.recurring?.interval_count !== 1 ||
    p.recurring?.usage_type !== 'licensed' || p.transform_quantity || p.custom_unit_amount)
    fail('STRIPE_PRICE_ID must be active, fixed $50 USD per month, recurring, licensed per-unit, with interval_count=1 and no quantity transformation.');
}
export function assertSetupPortal(p: Obj, live: boolean) {
  assertMode(p, live, 'STRIPE_PORTAL_CONFIGURATION_ID');
  const f = p.features || {};
  if (!p.active || !f.invoice_history?.enabled || !f.payment_method_update?.enabled ||
    !f.customer_update?.enabled || !['name', 'email', 'address'].every(k => f.customer_update.allowed_updates?.includes(k)) ||
    !f.subscription_cancel?.enabled || f.subscription_cancel.mode !== 'at_period_end' || f.subscription_update?.enabled)
    fail('STRIPE_PORTAL_CONFIGURATION_ID must enable invoices, payment methods, billing name/email/address and period-end cancellation; disable subscription price/quantity updates.');
}
function assertWebhook(w: Obj, url: string, version: string, live: boolean) {
  assertMode(w, live, 'STRIPE_WEBHOOK_ENDPOINT_ID');
  const events: string[] = w.enabled_events || [];
  if (w.status !== 'enabled' || w.url !== url || w.api_version !== version ||
    events.length !== WEBHOOK_EVENTS.length || !WEBHOOK_EVENTS.every(e => events.includes(e)))
    fail('Stripe webhook must be enabled at APP_URL/api/billing/webhook, use STRIPE_API_VERSION, and select exactly Radar’s seven billing events. Review the existing endpoint; setup will not overwrite it.');
}

/** Paginate before selecting: a matching object on a later page must not create a duplicate. */
async function list(request: SetupRequest, path: string, params: Obj = {}): Promise<Obj[]> {
  const result: Obj[] = []; let cursor: string | undefined;
  for (let pages = 0; pages < 1000; pages++) {
    const page = await request('GET', path, { params: { ...params, limit: 100, starting_after: cursor } });
    if (!Array.isArray(page.data)) return fail('Stripe returned an invalid list response.');
    result.push(...page.data);
    if (!page.has_more) return result;
    const next = page.data.at(-1)?.id;
    if (!next || next === cursor) return fail('Stripe pagination could not advance.');
    cursor = next;
  }
  return fail('Stripe result set is too large; set explicit object IDs.');
}

export async function provisionBilling(o: BillingSetupOptions, request: SetupRequest): Promise<BillingSetupResult> {
  const mode = setupMode(o.secretKey); const live = mode === 'live';
  if (o.apply && live && !o.allowLive) fail('Live setup requires --live. No Stripe changes were made.');
  const appUrl = setupAppUrl(o.appUrl, mode);
  if (!/^\d{4}-\d{2}-\d{2}\.[a-z]+$/.test(o.apiVersion)) fail('Set STRIPE_API_VERSION to the pinned Stripe API version.');
  if (o.publishableKey && !new RegExp(`^pk_${mode}_[A-Za-z0-9]+$`).test(o.publishableKey)) fail('STRIPE_PUBLISHABLE_KEY does not match STRIPE_SECRET_KEY mode.');
  if (o.webhookSecret && !/^whsec_[A-Za-z0-9]+$/.test(o.webhookSecret)) fail('STRIPE_WEBHOOK_SECRET is not a Stripe signing secret.');
  if (o.savedWebhookSecret && !/^whsec_[A-Za-z0-9]+$/.test(o.savedWebhookSecret)) fail('The saved STRIPE_WEBHOOK_SECRET is not a Stripe signing secret.');
  const r: BillingSetupResult = { mode, appUrl, apiVersion: o.apiVersion, priceId: null, portalConfigurationId: null,
    webhookEndpointId: null, webhookSecret: null, created: [], missing: [], warnings: [
      'Configuration checks cannot prove webhook signing-secret delivery, payment/3-D Secure, invoice collection or portal behavior. Run the Stripe test-mode acceptance checks before enabling billing.',
    ] };
  if (!o.publishableKey) r.missing.push('STRIPE_PUBLISHABLE_KEY');
  const webhookUrl = `${appUrl}/api/billing/webhook`;
  // Scope idempotency to the app origin and pinned contract. Re-running does not touch account defaults.
  const scope = createHash('sha256').update(`${appUrl}:${o.apiVersion}`).digest('hex').slice(0, 20);
  const key = (kind: string) => `radar:setup:v1:${mode}:${scope}:${kind}`;

  // Inspect every selected existing object before making any writes.
  let price = o.priceId
    ? await request('GET', `/prices/${validId(o.priceId, 'price', 'STRIPE_PRICE_ID')}`)
    : one(await list(request, '/prices', { lookup_keys: [BILLING_LOOKUP_KEY] }), 'Radar prices');
  let product: Obj | null = null;
  if (price) {
    assertSetupPrice(price, live);
    const productId = typeof price.product === 'string' ? price.product : price.product?.id;
    if (!productId) fail('STRIPE_PRICE_ID has no product.');
    product = typeof price.product === 'object' ? price.product : await request('GET', `/products/${validId(productId, 'prod', 'Stripe product')}`);
    if (!product?.active || product.deleted) fail('The Stripe price product is not active.');
    // Products are scoped by mode but do not have a livemode field.
  } else {
    product = one((await list(request, '/products')).filter(owned), 'Radar products');
    if (product && !product.active) fail('The Radar product is archived; review it before setup.');
  }
  let portal = o.portalConfigurationId
    ? await request('GET', `/billing_portal/configurations/${validId(o.portalConfigurationId, 'bpc', 'STRIPE_PORTAL_CONFIGURATION_ID')}`)
    : one((await list(request, '/billing_portal/configurations')).filter(owned), 'Radar portal configurations');
  if (portal) assertSetupPortal(portal, live);
  let webhook = o.webhookEndpointId
    ? await request('GET', `/webhook_endpoints/${validId(o.webhookEndpointId, 'we', 'STRIPE_WEBHOOK_ENDPOINT_ID')}`)
    : one((await list(request, '/webhook_endpoints')).filter(w => w.url === webhookUrl), 'webhook endpoints at APP_URL');
  if (webhook) assertWebhook(webhook, webhookUrl, o.apiVersion, live);

  if (o.apply) {
    if (!price) {
      if (!product) {
        product = await request('POST', '/products', { key: key('product'), params: { name: 'Radar', metadata: META } });
        r.created.push('product');
      }
      price = await request('POST', '/prices', { key: key('price'), params: { product: product!.id, currency: 'usd', unit_amount: PRICE_CENTS,
        recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }, billing_scheme: 'per_unit', lookup_key: BILLING_LOOKUP_KEY, metadata: META } });
      assertSetupPrice(price!, live); r.created.push('price');
    }
    if (!portal) {
      portal = await request('POST', '/billing_portal/configurations', { key: key('portal'), params: {
        business_profile: { headline: 'Manage your Radar billing' }, default_return_url: `${appUrl}/settings?section=billing`, metadata: META,
        features: { customer_update: { enabled: true, allowed_updates: ['name', 'email', 'address'] }, invoice_history: { enabled: true },
          payment_method_update: { enabled: true }, subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
          subscription_update: { enabled: false } },
      } });
      assertSetupPortal(portal!, live); r.created.push('portal configuration');
      if (portal!.is_default === true) r.warnings.push('Stripe made the first portal configuration the account default. Pass STRIPE_PORTAL_CONFIGURATION_ID explicitly for Radar and review other apps that use the default portal configuration.');
    }
    if (!webhook) {
      webhook = await request('POST', '/webhook_endpoints', { key: key('webhook'), params: {
        url: webhookUrl, api_version: o.apiVersion, enabled_events: [...WEBHOOK_EVENTS], metadata: META, description: 'Radar billing',
      } });
      r.created.push('webhook endpoint');
      if (!/^whsec_[A-Za-z0-9]+$/.test(webhook!.secret || '')) fail('Stripe did not return a webhook signing secret. Recover it from the Dashboard before enabling billing.');
      r.webhookSecret = webhook!.secret;
      r.priceId = price?.id || null; r.portalConfigurationId = portal?.id || null; r.webhookEndpointId = webhook!.id;
      await o.persistWebhookSecret?.(r);
      assertWebhook(webhook!, webhookUrl, o.apiVersion, live);
    }
  }
  r.priceId = price?.id || null; r.portalConfigurationId = portal?.id || null; r.webhookEndpointId = webhook?.id || null;
  if (!r.webhookSecret && webhook) {
    // Saved secrets are reusable only for the exact endpoint that produced them.
    r.webhookSecret = o.webhookSecret || (o.savedWebhookEndpointId === webhook.id ? o.savedWebhookSecret || null : null);
  }
  if (!r.priceId) r.missing.push('STRIPE_PRICE_ID');
  if (!r.portalConfigurationId) r.missing.push('STRIPE_PORTAL_CONFIGURATION_ID');
  if (!r.webhookEndpointId) r.missing.push('Stripe webhook endpoint');
  if (!r.webhookSecret) r.missing.push('STRIPE_WEBHOOK_SECRET');
  return r;
}

/** Deliberately allowlist printable output; the result also contains a signing secret. */
export function billingSetupSummary(r: BillingSetupResult): string[] {
  return [
    `Stripe ${r.mode} configuration ${r.missing.length ? 'incomplete' : 'checks passed'}.`,
    ...(r.priceId ? [`STRIPE_PRICE_ID=${r.priceId}`] : []),
    ...(r.portalConfigurationId ? [`STRIPE_PORTAL_CONFIGURATION_ID=${r.portalConfigurationId}`] : []),
    ...(r.webhookEndpointId ? [`STRIPE_WEBHOOK_ENDPOINT_ID=${r.webhookEndpointId}`] : []),
    ...(r.created.length ? [`Created: ${r.created.join(', ')}.`] : []),
    ...(r.missing.length ? [`Missing: ${r.missing.join(', ')}.`] : []),
    ...r.warnings,
  ];
}
