import { afterEach, describe, expect, it, vi } from 'vitest';

const KEYS = ['X_CLIENT_ID', 'X_CLIENT_SECRET', 'XAPP_CLIENT_ID', 'XAPP_CLIENT_SECRET', 'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDINAPP_CLIENT_ID', 'LINKEDINAPP_CLIENT_SECRET'];
const load = async (vars: Record<string, string>) => {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  vi.resetModules();
  return (await import('./env')).env;
};
afterEach(() => { for (const k of KEYS) delete process.env[k]; vi.resetModules(); });

describe('X app credentials', () => {
  it('reads X_CLIENT_ID / X_CLIENT_SECRET', async () => {
    const env = await load({ X_CLIENT_ID: 'a', X_CLIENT_SECRET: 'b' });
    expect([env.xClientId, env.xClientSecret]).toEqual(['a', 'b']);
  });
  it('accepts the XAPP_ names used in Railway', async () => {
    const env = await load({ XAPP_CLIENT_ID: 'c', XAPP_CLIENT_SECRET: 'd' });
    expect([env.xClientId, env.xClientSecret]).toEqual(['c', 'd']);
  });
  it('prefers X_ when both are set', async () => {
    const env = await load({ X_CLIENT_ID: 'a', XAPP_CLIENT_ID: 'c', X_CLIENT_SECRET: 'b', XAPP_CLIENT_SECRET: 'd' });
    expect([env.xClientId, env.xClientSecret]).toEqual(['a', 'b']);
  });
});

describe('LinkedIn profile app credentials', () => {
  it('accepts the LINKEDINAPP_ names used in Railway', async () => {
    const env = await load({ LINKEDINAPP_CLIENT_ID: 'e', LINKEDINAPP_CLIENT_SECRET: 'f' });
    expect([env.linkedinClientId, env.linkedinClientSecret]).toEqual(['e', 'f']);
  });
  it('prefers LINKEDIN_ when both are set, and never falls back to the page app', async () => {
    const env = await load({ LINKEDIN_CLIENT_ID: 'g', LINKEDINAPP_CLIENT_ID: 'e', LINKEDIN_CLIENT_SECRET: 'h', LINKEDINAPP_CLIENT_SECRET: 'f' });
    expect([env.linkedinClientId, env.linkedinClientSecret]).toEqual(['g', 'h']);
    expect([env.linkedinPageClientId, env.linkedinPageClientSecret]).toEqual(['', '']);
  });
});
