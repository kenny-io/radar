import { afterEach, describe, expect, it, vi } from 'vitest';

// Placeholders only: none of these is a real credential, snapshot or host.
const BUSINESS = '5b0c7f0e-3a51-4c0e-9d1f-2f6a8f1f4b10';
const OTHER_BUSINESS = '9d2e4c11-7b6a-4f3e-8a55-0c1d2e3f4a5b';
const SNAPSHOT = '0f8fad5b-d9cb-469f-a165-70867728950e';
const PROXY = 'https://model-proxy.example.test/model';
const VALID: Record<string, string> = {
  RADAR_PUBLISH_SANDBOX: 'all',
  DAYTONA_API_KEY: 'placeholder-daytona-key',
  RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID: SNAPSHOT,
  RADAR_PUBLISH_MODEL_PROXY_URL: PROXY,
  RADAR_PUBLISH_CAPABILITY_SECRET: 'c'.repeat(32),
};
const OPTIONAL = ['RADAR_PUBLISH_SANDBOX_MODEL', 'RADAR_PUBLISH_SANDBOX_MAX_USD', 'RADAR_PUBLISH_SANDBOX_MAX_CALLS', 'RADAR_PUBLISH_SANDBOX_TRANSCRIPT_DIR', 'AI_MODEL_MAP'];

/** Loads the module against a fully valid environment with `vars` applied on top (undefined unsets a variable). */
async function load(vars: Record<string, string | undefined> = {}) {
  for (const name of OPTIONAL) vi.stubEnv(name, undefined);
  for (const [name, value] of Object.entries({ ...VALID, ...vars })) vi.stubEnv(name, value);
  vi.resetModules();
  return (await import('./config')).sandboxPublisher;
}
const publisher = async (vars: Record<string, string | undefined> = {}, businessId = BUSINESS) => (await load(vars))(businessId);

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('the rollout switch', () => {
  it.each([['unset', undefined], ['empty', ''], ['off', 'off'], ['OFF with spaces', '  OFF '], ['off beside a business id', `${BUSINESS},off`], ['off beside all', 'all,off']])(
    'is off when RADAR_PUBLISH_SANDBOX is %s, even with everything else configured', async (_label, value) => {
      expect(await publisher({ RADAR_PUBLISH_SANDBOX: value })).toEqual({ enabled: false, reason: 'off' });
    });

  it('stays quiet about configuration while it is off', async () => {
    const result = await publisher({ RADAR_PUBLISH_SANDBOX: undefined, DAYTONA_API_KEY: undefined, RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID: undefined, RADAR_PUBLISH_MODEL_PROXY_URL: undefined, RADAR_PUBLISH_CAPABILITY_SECRET: undefined });
    expect(result).toEqual({ enabled: false, reason: 'off' });
  });

  it('enables every business with `all`', async () => {
    const sandboxPublisher = await load({ RADAR_PUBLISH_SANDBOX: 'ALL' });
    expect(sandboxPublisher(BUSINESS).enabled).toBe(true);
    expect(sandboxPublisher(OTHER_BUSINESS).enabled).toBe(true);
  });

  it('enables only the businesses a list names', async () => {
    const sandboxPublisher = await load({ RADAR_PUBLISH_SANDBOX: ` ${BUSINESS.toUpperCase()} , 11111111-2222-4333-8444-555555555555 ` });
    expect(sandboxPublisher(BUSINESS).enabled).toBe(true);
    expect(sandboxPublisher(OTHER_BUSINESS)).toEqual({ enabled: false, reason: 'not-listed' });
  });

  it('does not report configuration problems for a business that is not listed', async () => {
    expect(await publisher({ RADAR_PUBLISH_SANDBOX: OTHER_BUSINESS, DAYTONA_API_KEY: undefined })).toEqual({ enabled: false, reason: 'not-listed' });
  });

  it('follows the switch at call time, so unsetting it rolls back without a reload', async () => {
    const sandboxPublisher = await load();
    expect(sandboxPublisher(BUSINESS).enabled).toBe(true);
    vi.stubEnv('RADAR_PUBLISH_SANDBOX', undefined);
    expect(sandboxPublisher(BUSINESS)).toEqual({ enabled: false, reason: 'off' });
    vi.stubEnv('RADAR_PUBLISH_SANDBOX', OTHER_BUSINESS);
    expect(sandboxPublisher(BUSINESS)).toEqual({ enabled: false, reason: 'not-listed' });
  });
});

describe('a complete configuration', () => {
  it('returns the validated settings with the design defaults', async () => {
    const result = await publisher();
    expect(result).toEqual({
      enabled: true,
      daytonaKey: 'placeholder-daytona-key',
      snapshotId: SNAPSHOT,
      proxyUrl: new URL(PROXY),
      capabilitySecret: 'c'.repeat(32),
      model: { catalogueId: 'claude-opus-5.5', apiId: 'claude-opus-5-5' },
      maxUsd: 6,
      maxCalls: 200,
      attemptMs: 810_000,
      transcriptDir: null,
    });
    if (result.enabled) expect([result.proxyUrl.href, result.proxyUrl.hostname]).toEqual([PROXY, 'model-proxy.example.test']);
  });

  it('accepts another Anthropic catalogue model and its own caps', async () => {
    const result = await publisher({ RADAR_PUBLISH_SANDBOX_MODEL: 'claude-sonnet-5.5', RADAR_PUBLISH_SANDBOX_MAX_USD: '2.5', RADAR_PUBLISH_SANDBOX_MAX_CALLS: '50' });
    expect(result).toMatchObject({ enabled: true, model: { catalogueId: 'claude-sonnet-5.5', apiId: 'claude-sonnet-5-5' }, maxUsd: 2.5, maxCalls: 50 });
  });

  it('calls the provider id the AI client is configured to use for that model', async () => {
    const result = await publisher({ AI_MODEL_MAP: JSON.stringify({ 'claude-opus-5.5': 'claude-opus-5-5-20261001' }) });
    expect(result).toMatchObject({ enabled: true, model: { catalogueId: 'claude-opus-5.5', apiId: 'claude-opus-5-5-20261001' } });
  });

  it('keeps a transcript directory outside production only', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(await publisher({ RADAR_PUBLISH_SANDBOX_TRANSCRIPT_DIR: '.data/transcripts' })).toMatchObject({ enabled: true, transcriptDir: '.data/transcripts' });
    vi.stubEnv('NODE_ENV', 'production');
    expect(await publisher({ RADAR_PUBLISH_SANDBOX_TRANSCRIPT_DIR: '.data/transcripts' })).toMatchObject({ enabled: true, transcriptDir: null });
  });
});

describe('switched on but unconfigured', () => {
  const unconfigured = (...missing: string[]) => ({ enabled: false, reason: 'unconfigured', missing });

  it.each(['DAYTONA_API_KEY', 'RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID', 'RADAR_PUBLISH_MODEL_PROXY_URL', 'RADAR_PUBLISH_CAPABILITY_SECRET'])(
    'is disabled and names %s when it is missing', async name => {
      expect(await publisher({ [name]: undefined })).toEqual(unconfigured(name));
      expect(await publisher({ [name]: '   ' })).toEqual(unconfigured(name));
    });

  it('names every problem at once and never echoes a value', async () => {
    const shortSecret = 'short-placeholder-secret';
    const badUrl = 'https://someone:placeholder-password@model-proxy.example.test/model';
    const result = await publisher({ DAYTONA_API_KEY: undefined, RADAR_PUBLISH_CAPABILITY_SECRET: shortSecret, RADAR_PUBLISH_MODEL_PROXY_URL: badUrl, RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID: 'radar-publisher-latest' });
    expect(result).toEqual(unconfigured('DAYTONA_API_KEY', 'RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID', 'RADAR_PUBLISH_MODEL_PROXY_URL', 'RADAR_PUBLISH_CAPABILITY_SECRET'));
    const serialised = JSON.stringify(result);
    for (const value of [shortSecret, 'placeholder-password', 'radar-publisher-latest']) expect(serialised).not.toContain(value);
  });

  describe('model proxy URL', () => {
    it.each([
      ['plain http', 'http://model-proxy.example.test/model'],
      ['another scheme', 'wss://model-proxy.example.test/model'],
      ['a user name and password', 'https://someone:placeholder-password@model-proxy.example.test/model'],
      ['a user name', 'https://someone@model-proxy.example.test/model'],
      ['a query', 'https://model-proxy.example.test/model?key=1'],
      ['an empty query', 'https://model-proxy.example.test/model?'],
      ['a hash', 'https://model-proxy.example.test/model#section'],
      ['an empty hash', 'https://model-proxy.example.test/model#'],
      ['no path', 'https://model-proxy.example.test'],
      ['the root path', 'https://model-proxy.example.test/'],
      ['a trailing slash', 'https://model-proxy.example.test/model/'],
      ['a route below the base', 'https://model-proxy.example.test/model/v1/messages'],
      ['a similar path', 'https://model-proxy.example.test/models'],
      ['a path that only ends in the word', 'https://model-proxy.example.test/supermodel'],
      ['a bare host', 'model-proxy.example.test/model'],
      ['text that is not a URL', 'not a url'],
    ])('rejects %s', async (_label, value) => {
      expect(await publisher({ RADAR_PUBLISH_MODEL_PROXY_URL: value })).toEqual(unconfigured('RADAR_PUBLISH_MODEL_PROXY_URL'));
    });
  });

  describe('snapshot id', () => {
    it.each([
      ['a snapshot name', 'radar-publisher-3f2a9c1'],
      ['an upper-case UUID', SNAPSHOT.toUpperCase()],
      ['a UUID without dashes', SNAPSHOT.replaceAll('-', '')],
      ['a truncated UUID', SNAPSHOT.slice(0, -1)],
      ['a UUID with a suffix', SNAPSHOT + '-1'],
      ['a braced UUID', `{${SNAPSHOT}}`],
      ['the nil UUID', '00000000-0000-0000-0000-000000000000'],
    ])('rejects %s', async (_label, value) => {
      expect(await publisher({ RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID: value })).toEqual(unconfigured('RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID'));
    });
  });

  it('requires a capability secret of 32 characters or more', async () => {
    expect(await publisher({ RADAR_PUBLISH_CAPABILITY_SECRET: 'c'.repeat(31) })).toEqual(unconfigured('RADAR_PUBLISH_CAPABILITY_SECRET'));
    expect((await publisher({ RADAR_PUBLISH_CAPABILITY_SECRET: 'c'.repeat(32) })).enabled).toBe(true);
  });

  it.each([['a model outside the catalogue', 'claude-unknown-9'], ['a catalogue model from another provider', 'gpt-6-sol'], ['a provider API id', 'claude-opus-5-5']])(
    'rejects %s', async (_label, value) => {
      expect(await publisher({ RADAR_PUBLISH_SANDBOX_MODEL: value })).toEqual(unconfigured('RADAR_PUBLISH_SANDBOX_MODEL'));
    });

  it.each(['0', '-1', 'six', '2,5', '1e3', 'Infinity'])('rejects a spend cap of %s instead of guessing one', async value => {
    expect(await publisher({ RADAR_PUBLISH_SANDBOX_MAX_USD: value })).toEqual(unconfigured('RADAR_PUBLISH_SANDBOX_MAX_USD'));
  });

  it.each(['0', '-5', '1.5', 'many'])('rejects a call cap of %s instead of guessing one', async value => {
    expect(await publisher({ RADAR_PUBLISH_SANDBOX_MAX_CALLS: value })).toEqual(unconfigured('RADAR_PUBLISH_SANDBOX_MAX_CALLS'));
  });
});
