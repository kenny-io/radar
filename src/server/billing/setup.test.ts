import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BILLING_LOOKUP_KEY, billingSetupSummary, provisionBilling, setupAppUrl, type BillingSetupOptions, type SetupRequest } from './setup';
import { WEBHOOK_EVENTS } from '../../lib/billing';
import { main, prepareBillingStorage, readBillingConfig, saveBillingConfig } from '../../../scripts/billing';
import { env } from '../env';
import * as stripe from './stripe';

const version = '2026-05-27.dahlia';
const options = (overrides: Partial<BillingSetupOptions> = {}): BillingSetupOptions => ({ apply: true, secretKey: 'sk_test_private123',
  publishableKey: 'pk_test_public123', appUrl: 'https://radar.example', apiVersion: version, ...overrides });
const meta = { radar_app: 'radar', radar_config_version: '1' };
const price = (overrides = {}) => ({ id: 'price_monthly', active: true, livemode: false, type: 'recurring', currency: 'usd', unit_amount: 5000,
  billing_scheme: 'per_unit', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }, product: 'prod_radar', lookup_key: BILLING_LOOKUP_KEY, ...overrides });
const portal = (overrides = {}) => ({ id: 'bpc_radar', active: true, livemode: false, metadata: meta, features: {
  customer_update: { enabled: true, allowed_updates: ['name', 'email', 'address'] }, invoice_history: { enabled: true }, payment_method_update: { enabled: true },
  subscription_cancel: { enabled: true, mode: 'at_period_end' }, subscription_update: { enabled: false },
}, ...overrides });
const webhook = (overrides = {}) => ({ id: 'we_radar', livemode: false, metadata: meta, status: 'enabled', url: 'https://radar.example/api/billing/webhook',
  api_version: version, enabled_events: [...WEBHOOK_EVENTS], ...overrides });

function fixture(existing = false, pageSize = 100) {
  const store: Record<string, any[]> = { '/products': existing ? [{ id: 'prod_radar', active: true, metadata: meta }] : [],
    '/prices': existing ? [price()] : [], '/billing_portal/configurations': existing ? [portal()] : [], '/webhook_endpoints': existing ? [webhook()] : [] };
  const calls: { method: string; path: string; params?: any; key?: string }[] = [];
  const request: SetupRequest = async (method, requestPath, o = {}) => {
    calls.push({ method, path: requestPath, ...o });
    if (method === 'GET') {
      if (store[requestPath]) {
        let rows = store[requestPath];
        if (o.params?.lookup_keys) rows = rows.filter(x => o.params!.lookup_keys.includes(x.lookup_key));
        const start = o.params?.starting_after ? rows.findIndex(x => x.id === o.params!.starting_after) + 1 : 0;
        return { data: rows.slice(start, start + pageSize).map(({ secret, ...x }) => x), has_more: rows.length > start + pageSize };
      }
      const base = Object.keys(store).sort((a, b) => b.length - a.length).find(k => requestPath.startsWith(k + '/'))!;
      const object = store[base]?.find(x => x.id === requestPath.slice(base.length + 1));
      if (!object) throw new Error('Object missing');
      const { secret, ...safe } = object; return safe;
    }
    expect(o.key).toMatch(/^radar:setup:v1:test:/);
    let object: any;
    if (requestPath === '/products') object = { ...o.params, id: 'prod_radar', active: true };
    else if (requestPath === '/prices') object = price(o.params);
    else if (requestPath === '/billing_portal/configurations') object = portal(o.params);
    else if (requestPath === '/webhook_endpoints') object = webhook({ ...o.params, secret: 'whsec_private123' });
    else throw new Error('Forbidden mutation');
    store[requestPath].push(object); return object;
  };
  return { store, calls, request };
}

const dirs: string[] = [];
const tempRoot = async () => { const dir = await mkdtemp(path.join(tmpdir(), 'radar-stripe-setup-')); dirs.push(dir); return dir; };
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe('Stripe billing setup', () => {
  it('creates only the four infrastructure objects and reuses them on the next run', async () => {
    const f = fixture();
    const first = await provisionBilling(options(), f.request);
    expect(first).toMatchObject({ priceId: 'price_monthly', portalConfigurationId: 'bpc_radar', webhookEndpointId: 'we_radar', webhookSecret: 'whsec_private123', missing: [] });
    expect(first.created).toHaveLength(4);
    expect(f.calls.filter(c => c.method === 'POST').map(c => c.path)).toEqual(['/products', '/prices', '/billing_portal/configurations', '/webhook_endpoints']);
    expect(f.store['/webhook_endpoints'][0].enabled_events).toEqual(WEBHOOK_EVENTS);
    const start = f.calls.length;
    const second = await provisionBilling(options({ savedWebhookEndpointId: first.webhookEndpointId!, savedWebhookSecret: first.webhookSecret! }), f.request);
    expect(second).toMatchObject({ created: [], missing: [], webhookSecret: first.webhookSecret });
    expect(f.calls.slice(start).every(c => c.method === 'GET')).toBe(true);
    expect(f.store['/billing_portal/configurations'][0].is_default).toBeUndefined();
  });

  it('read-only preflight never writes, and reports missing configuration', async () => {
    const f = fixture();
    const result = await provisionBilling(options({ apply: false, publishableKey: '' }), f.request);
    expect(f.calls.every(c => c.method === 'GET')).toBe(true);
    expect(result.missing).toEqual(expect.arrayContaining(['STRIPE_PUBLISHABLE_KEY', 'STRIPE_PRICE_ID', 'STRIPE_PORTAL_CONFIGURATION_ID', 'STRIPE_WEBHOOK_SECRET']));
  });

  it('warns when Stripe automatically makes the first portal configuration the account default', async () => {
    const f = fixture();
    const request: SetupRequest = async (method, target, o) => {
      const r = await f.request(method, target, o);
      return method === 'POST' && target === '/billing_portal/configurations' ? { ...r, is_default: true } : r;
    };
    const result = await provisionBilling(options(), request);
    expect(result.warnings).toContain('Stripe made the first portal configuration the account default. Pass STRIPE_PORTAL_CONFIGURATION_ID explicitly for Radar and review other apps that use the default portal configuration.');
    const portalWrite = f.calls.find(c => c.method === 'POST' && c.path === '/billing_portal/configurations')!;
    expect(portalWrite.params).not.toHaveProperty('is_default');
    expect(billingSetupSummary(result).join('\n')).toContain('review other apps');
    expect(billingSetupSummary(result).join('\n')).not.toContain('whsec_private123');
  });

  it('checks existing resources without confusing a saved endpoint secret with another endpoint', async () => {
    const f = fixture(true);
    const r = await provisionBilling(options({ apply: false, savedWebhookSecret: 'whsec_other', savedWebhookEndpointId: 'we_other' }), f.request);
    expect(r.webhookSecret).toBeNull(); expect(r.missing).toContain('STRIPE_WEBHOOK_SECRET');
    expect(f.calls.every(c => c.method === 'GET')).toBe(true);
    const good = await provisionBilling(options({ apply: false, webhookSecret: 'whsec_env' }), f.request);
    expect(good.missing).toEqual([]);
  });

  it('paginates configurations before choosing or creating a resource', async () => {
    const f = fixture(true, 1);
    f.store['/billing_portal/configurations'].unshift(portal({ id: 'bpc_unrelated', metadata: {}, is_default: true }));
    const r = await provisionBilling(options(), f.request);
    expect(r.portalConfigurationId).toBe('bpc_radar');
    expect(f.calls.some(c => c.path === '/billing_portal/configurations' && c.params?.starting_after === 'bpc_unrelated')).toBe(true);
    expect(f.calls.every(c => c.method === 'GET')).toBe(true);
  });

  it('refuses duplicate tagged resources and does not overwrite account defaults', async () => {
    const f = fixture(true);
    f.store['/billing_portal/configurations'].push(portal({ id: 'bpc_duplicate' }));
    await expect(provisionBilling(options(), f.request)).rejects.toThrow('Multiple matching');
    expect(f.calls.every(c => c.method === 'GET')).toBe(true);
  });

  it.each([
    { unit_amount: 1000 }, { currency: 'eur' }, { active: false }, { type: 'one_time' }, { billing_scheme: 'tiered' },
    { recurring: { interval: 'month', interval_count: 3, usage_type: 'licensed' } },
    { recurring: { interval: 'month', interval_count: 1, usage_type: 'metered' } }, { transform_quantity: { divide_by: 10 } },
  ])('refuses an explicitly configured incompatible price before making writes: %o', async overrides => {
    const f = fixture(true); f.store['/prices'] = [price(overrides)];
    await expect(provisionBilling(options({ priceId: 'price_monthly' }), f.request)).rejects.toThrow('STRIPE_PRICE_ID');
    expect(f.calls.every(c => c.method === 'GET')).toBe(true);
  });

  it('reuses an explicitly configured valid price instead of silently replacing it', async () => {
    const f = fixture(true); f.store['/prices'] = [price({ id: 'price_custom', lookup_key: null })];
    const r = await provisionBilling(options({ priceId: 'price_custom', webhookSecret: 'whsec_env' }), f.request);
    expect(r.priceId).toBe('price_custom'); expect(r.created).toEqual([]);
  });

  it('refuses webhook drift and cross-mode keys before writes', async () => {
    const f = fixture(true); f.store['/webhook_endpoints'] = [webhook({ enabled_events: ['*'] })];
    await expect(provisionBilling(options(), f.request)).rejects.toThrow('exactly Radar');
    expect(f.calls.every(c => c.method === 'GET')).toBe(true);
    const request = vi.fn();
    await expect(provisionBilling(options({ secretKey: 'sk_live_private', publishableKey: 'pk_live_public' }), request)).rejects.toThrow('--live');
    await expect(provisionBilling(options({ publishableKey: 'pk_live_public' }), request)).rejects.toThrow('mode');
    expect(request).not.toHaveBeenCalled();
  });

  it('requires safe application origins', () => {
    expect(setupAppUrl('http://localhost:3000/', 'test')).toBe('http://localhost:3000');
    for (const url of ['http://example.com', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com?key=value'])
      expect(() => setupAppUrl(url, 'test')).toThrow('APP_URL');
    expect(() => setupAppUrl('http://localhost:3000', 'live')).toThrow('APP_URL');
  });

  it('writes owner-only output without API keys and preserves the signing secret on rerun', async () => {
    const root = await tempRoot(); const f = fixture(); const r = await provisionBilling(options(), f.request);
    await saveBillingConfig(root, r);
    const target = path.join(root, '.data/stripe-billing/test.env');
    const saved = await readBillingConfig(root, 'test');
    expect(saved.STRIPE_WEBHOOK_SECRET).toBe('whsec_private123');
    expect((await stat(target)).mode & 0o777).toBe(0o600);
    const source = await readFile(target, 'utf8');
    expect(source).not.toContain('sk_test_'); expect(source).not.toContain('pk_test_');
    const again = await provisionBilling(options({ savedWebhookSecret: saved.STRIPE_WEBHOOK_SECRET, savedWebhookEndpointId: saved.STRIPE_WEBHOOK_ENDPOINT_ID }), f.request);
    await saveBillingConfig(root, again);
    expect((await readBillingConfig(root, 'test')).STRIPE_WEBHOOK_SECRET).toBe('whsec_private123');
    expect(billingSetupSummary(r).join('\n')).not.toContain('whsec_private123');
  });

  it('persists a new webhook secret before rejecting an unexpected endpoint response', async () => {
    const root = await tempRoot(); const f = fixture();
    const request: SetupRequest = async (method, target, o) => {
      const r = await f.request(method, target, o);
      return method === 'POST' && target === '/webhook_endpoints' ? { ...r, api_version: 'unexpected' } : r;
    };
    await expect(provisionBilling(options({ persistWebhookSecret: result => saveBillingConfig(root, result) }), request)).rejects.toThrow('Stripe webhook');
    expect((await readBillingConfig(root, 'test')).STRIPE_WEBHOOK_SECRET).toBe('whsec_private123');
  });

  it('refuses unsafe secret files and symlink output directories', async () => {
    const root = await tempRoot(); const f = fixture(); const r = await provisionBilling(options(), f.request);
    await saveBillingConfig(root, r);
    await chmod(path.join(root, '.data/stripe-billing/test.env'), 0o644);
    await expect(readBillingConfig(root, 'test')).rejects.toThrow('owner-only');
    const other = await tempRoot(); await symlink(path.join(root, '.data'), path.join(other, '.data'));
    await expect(prepareBillingStorage(other, 'test')).rejects.toThrow('symlink');
  });

  it('disconnected CLI reports missing credentials without echoing arguments or raw errors', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['check', '--sk_test_neverprint'])).toBe(1);
    expect(error.mock.calls.flat().join(' ')).not.toContain('neverprint');
    try {
      execFileSync(process.execPath, ['--import', 'tsx', 'scripts/billing.ts', 'check'], { cwd: process.cwd(), env: { ...process.env, STRIPE_SECRET_KEY: '' }, stdio: 'pipe' });
      throw new Error('Expected check to fail');
    } catch (e: any) {
      expect(e.status).toBe(1); expect(e.stderr.toString()).toContain('Set STRIPE_SECRET_KEY');
      expect(e.stderr.toString()).not.toContain('stack');
    }
  });

  it('does not print a provider error that contains credentials', async () => {
    const original = { ...env };
    Object.assign(env, { stripeSecretKey: 'sk_test_neverprint', stripePublishableKey: 'pk_test_public', appUrl: 'https://radar.example',
      stripePriceId: '', stripePortalConfigurationId: '', stripeWebhookSecret: '' });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(stripe, 'stripeRequest').mockRejectedValue(new Error('Invalid API key sk_test_neverprint; whsec_neverprint'));
    try {
      expect(await main(['check'])).toBe(1);
      const output = error.mock.calls.flat().join(' ');
      expect(output).toContain('could not be verified'); expect(output).not.toContain('neverprint');
    } finally { Object.assign(env, original); }
  });
});
