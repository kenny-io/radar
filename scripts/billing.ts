// Node 22 loads .env/.env.local before imports via the package scripts. Secrets never belong in CLI arguments.
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BillingSetupError, billingSetupSummary, provisionBilling, setupAppUrl, setupMode, type BillingSetupResult } from '../src/server/billing/setup';

export interface SavedBillingConfig { APP_URL?: string; STRIPE_PRICE_ID?: string; STRIPE_PORTAL_CONFIGURATION_ID?: string; STRIPE_WEBHOOK_ENDPOINT_ID?: string; STRIPE_WEBHOOK_SECRET?: string; STRIPE_API_VERSION?: string }
const outputPath = (root: string, mode: 'test' | 'live') => path.join(root, '.data', 'stripe-billing', `${mode}.env`);
async function safeDirectory(dir: string, create: boolean) {
  try {
    const stat = await lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new BillingSetupError('Stripe output directory must be a real local directory, not a symlink.');
  } catch (e: any) {
    if (e.code !== 'ENOENT') throw e;
    if (create) await mkdir(dir, { mode: 0o700 }); else return false;
  }
  return true;
}
export async function prepareBillingStorage(root: string, mode: 'test' | 'live') {
  await safeDirectory(path.join(root, '.data'), true);
  await safeDirectory(path.join(root, '.data', 'stripe-billing'), true);
  const probe = `${outputPath(root, mode)}.${randomUUID()}.tmp`;
  const f = await open(probe, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  await f.close(); await unlink(probe);
}
export async function readBillingConfig(root: string, mode: 'test' | 'live'): Promise<SavedBillingConfig> {
  if (!(await safeDirectory(path.join(root, '.data'), false)) || !(await safeDirectory(path.join(root, '.data', 'stripe-billing'), false))) return {};
  const target = outputPath(root, mode);
  let f;
  try { f = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (e: any) { if (e.code === 'ENOENT') return {}; throw new BillingSetupError('Cannot safely read the Stripe setup file; check its ownership and remove symlinks.'); }
  try {
    const stat = await f.stat();
    if (!stat.isFile() || stat.size > 32768 || (stat.mode & 0o077) !== 0)
      throw new BillingSetupError('Stripe setup file must be a regular file with owner-only permissions (chmod 600).');
    const source = await f.readFile('utf8');
    const out: SavedBillingConfig = {};
    for (const line of source.split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const m = /^(APP_URL|STRIPE_PRICE_ID|STRIPE_PORTAL_CONFIGURATION_ID|STRIPE_WEBHOOK_ENDPOINT_ID|STRIPE_WEBHOOK_SECRET|STRIPE_API_VERSION)=([^\r\n]*)$/.exec(line);
      if (!m) throw new BillingSetupError('Stripe setup file has an unexpected format; review it locally without sharing secrets.');
      out[m[1] as keyof SavedBillingConfig] = m[2];
    }
    return out;
  } finally { await f.close(); }
}
export async function saveBillingConfig(root: string, r: BillingSetupResult) {
  await prepareBillingStorage(root, r.mode);
  const target = outputPath(root, r.mode);
  try {
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new BillingSetupError('Refusing to replace a non-regular Stripe setup file.');
  } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
  const values: Record<string, string | null> = {
    APP_URL: r.appUrl, STRIPE_API_VERSION: r.apiVersion, STRIPE_PRICE_ID: r.priceId,
    STRIPE_PORTAL_CONFIGURATION_ID: r.portalConfigurationId, STRIPE_WEBHOOK_ENDPOINT_ID: r.webhookEndpointId, STRIPE_WEBHOOK_SECRET: r.webhookSecret,
  };
  const text = '# Private Stripe setup output. Do not commit, paste into chat, or share this file.\n' + Object.entries(values)
    .filter(([, value]) => value != null).map(([name, value]) => `${name}=${value}`).join('\n') + '\n';
  const temp = `${target}.${randomUUID()}.tmp`;
  const f = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await f.writeFile(text, 'utf8'); await f.sync(); } catch (e) { await unlink(temp).catch(() => {}); throw e; } finally { await f.close(); }
  try { await rename(temp, target); await chmod(target, 0o600); }
  catch (e) { await unlink(temp).catch(() => {}); throw e; }
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  if (args.includes('--help')) {
    console.log('Usage: npm run billing:check | npm run billing:setup [-- --live]\nRead keys from environment/.env.local. Setup creates or reuses Radar product/price, portal and webhook only. It never enables billing or creates subscriptions.');
    return 0;
  }
  const command = args[0] || 'check';
  if (!['check', 'setup'].includes(command) || args.slice(1).some(a => a !== '--live')) {
    console.error('Use billing:check or billing:setup [-- --live]. Credentials must be environment variables, never arguments.'); return 1;
  }
  try {
    const { env } = await import('../src/server/env');
    const mode = setupMode(env.stripeSecretKey);
    if (command === 'setup' && mode === 'live' && !args.includes('--live')) throw new BillingSetupError('Live setup requires --live. No Stripe changes were made.');
    const appUrl = setupAppUrl(env.appUrl, mode);
    const root = process.cwd();
    const saved = await readBillingConfig(root, mode);
    if (saved.APP_URL && saved.APP_URL !== appUrl)
      throw new BillingSetupError('Saved Stripe setup belongs to another APP_URL. Move the protected .data/stripe-billing file to a secure backup before setting up this origin.');
    if (process.env.STRIPE_WEBHOOK_ENDPOINT_ID && saved.STRIPE_WEBHOOK_ENDPOINT_ID && process.env.STRIPE_WEBHOOK_ENDPOINT_ID !== saved.STRIPE_WEBHOOK_ENDPOINT_ID)
      throw new BillingSetupError('Saved Stripe setup belongs to another webhook endpoint. Move the protected .data/stripe-billing file to a secure backup before replacing it.');
    if (command === 'setup') {
      try { execFileSync('git', ['check-ignore', '-q', '--', `.data/stripe-billing/${mode}.env`], { cwd: root, stdio: 'ignore' }); }
      catch { throw new BillingSetupError('Refusing to save webhook secrets: .data/stripe-billing must be ignored by Git.'); }
      await prepareBillingStorage(root, mode); // Verify persistence is possible before creating a webhook secret.
    }
    const { stripeRequest } = await import('../src/server/billing/stripe');
    const result = await provisionBilling({ apply: command === 'setup', allowLive: args.includes('--live'),
      secretKey: env.stripeSecretKey, publishableKey: env.stripePublishableKey, appUrl, apiVersion: env.stripeApiVersion,
      priceId: env.stripePriceId || saved.STRIPE_PRICE_ID, portalConfigurationId: env.stripePortalConfigurationId || saved.STRIPE_PORTAL_CONFIGURATION_ID,
      webhookEndpointId: process.env.STRIPE_WEBHOOK_ENDPOINT_ID || saved.STRIPE_WEBHOOK_ENDPOINT_ID,
      webhookSecret: env.stripeWebhookSecret, savedWebhookSecret: saved.STRIPE_WEBHOOK_SECRET, savedWebhookEndpointId: saved.STRIPE_WEBHOOK_ENDPOINT_ID,
      persistWebhookSecret: result => saveBillingConfig(root, result),
    }, stripeRequest);
    if (command === 'setup') {
      await saveBillingConfig(root, result);
      console.log(`Saved private setup output to .data/stripe-billing/${mode}.env (0600). Copy the required variables securely into web and worker environments; keys are not stored in this file.`);
    }
    for (const line of billingSetupSummary(result)) console.log(line);
    return result.missing.length ? 1 : 0;
  } catch (e: any) {
    // Stripe errors may echo invalid keys or request values: never print provider bodies, messages or stack traces.
    console.error(e instanceof BillingSetupError ? e.message : 'Stripe configuration could not be verified. Check account access, API-key permissions, network access and local output permissions. No billing flag was changed.');
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; });
}
