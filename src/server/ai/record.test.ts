// recordAiCall: the one writer of ai_calls. What it writes, and that it can never throw into, be awaited by or delay
// the work it records.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({ values: (_row: any): any => Promise.resolve(), inserted: [] as any[] }));
vi.mock('../db', () => ({ db: { insert: () => ({ values: (row: any) => { H.inserted.push(row); return H.values(row); } }) }, schema: { aiCalls: {} } }));
import { env } from '../env';
import { costOf } from './prices';
import { recordAiCall, recordAiCallNow } from './record';

const saved = { ...env };
const base = { businessId: 'biz', task: 'writing', purpose: 'social.post', model: 'claude-opus-5.5', provider: 'Anthropic', latencyMs: 120, ok: true };
beforeEach(() => { H.inserted.length = 0; H.values = () => Promise.resolve(); });
afterEach(() => { Object.assign(env, saved); });

describe('recordAiCall: the row', () => {
  it('has exactly the ai_calls columns, with the cost worked out from the price table', () => {
    recordAiCall({ ...base, inputTokens: 1000, outputTokens: 500 });
    expect(H.inserted).toEqual([{ businessId: 'biz', task: 'writing', purpose: 'social.post', model: 'claude-opus-5.5', provider: 'Anthropic', latencyMs: 120, inputTokens: 1000, outputTokens: 500, costUsd: expect.closeTo(0.014, 10), ok: true, error: null }]);
  });
  it('a cost the route reported wins over the table, including a reported zero', () => {
    recordAiCall({ ...base, provider: 'openrouter', inputTokens: 1000, outputTokens: 500, costUsd: 0.0042 });
    recordAiCall({ ...base, provider: 'openrouter', inputTokens: 1000, outputTokens: 500, costUsd: 0 });
    expect(H.inserted.map(r => r.costUsd)).toEqual([0.0042, 0]);
  });
  it('a model with no known rate, and a call that reported nothing, log a null cost', () => {
    recordAiCall({ ...base, model: 'gemini-flash-latest', provider: 'Google', inputTokens: 1000, outputTokens: 500 });
    recordAiCall({ ...base, ok: false, error: new Error('HTTP 500: down') });
    recordAiCall({ ...base, businessId: undefined });
    expect(H.inserted.map(r => [r.businessId, r.inputTokens, r.outputTokens, r.costUsd, r.error])).toEqual([['biz', 1000, 500, null, null], ['biz', null, null, null, 'HTTP 500: down'], [null, null, null, null, null]]);
  });
  it('a billed attempt that failed keeps its tokens and cost', () => {
    recordAiCall({ ...base, ok: false, inputTokens: 100, outputTokens: 50, error: new Error('Structured output failed validation: invalid_type') });
    expect(H.inserted[0]).toMatchObject({ ok: false, inputTokens: 100, outputTokens: 50, costUsd: expect.closeTo(0.0014, 10), error: 'Structured output failed validation: invalid_type' });
  });
  it('per-search fees, images and requests are costed from what the caller says was billed', () => {
    recordAiCall({ ...base, task: 'visibility', purpose: 'visibility.collect', model: 'claude-sonnet-5-5', inputTokens: 1000, outputTokens: 1000, searches: 2 });
    recordAiCall({ ...base, task: 'image', purpose: 'image.social', model: 'grok-imagine-image', provider: 'SpaceX', images: 1 });
    recordAiCall({ ...base, task: 'search', purpose: 'brief.search', model: 'perplexity-search', provider: 'Perplexity', requests: 1 });
    expect(H.inserted.map(r => r.costUsd)).toEqual([expect.closeTo(0.032, 10), expect.closeTo(0.02, 10), expect.closeTo(0.005, 10)]);
    // The units are for costing only: they are not columns.
    for (const r of H.inserted) expect(Object.keys(r).sort()).toEqual(['businessId', 'costUsd', 'error', 'inputTokens', 'latencyMs', 'model', 'ok', 'outputTokens', 'provider', 'purpose', 'task']);
  });
  it('the error is a short message with every configured provider key removed', () => {
    Object.assign(env, { openrouterKey: 'sk-or-v1-SECRETSECRET', anthropicKey: 'sk-ant-SECRET', openaiKey: 'sk-oa-SECRET', xaiKey: 'xai-SECRET', perplexityKey: 'pplx-SECRET', geminiKey: 'AIza-SECRET' });
    recordAiCall({ ...base, ok: false, error: new Error('HTTP 401: bad key sk-or-v1-SECRETSECRET, also sk-ant-SECRET sk-oa-SECRET xai-SECRET pplx-SECRET AIza-SECRET sk-ant-SECRET') });
    recordAiCall({ ...base, ok: false, error: 'x'.repeat(480) + ' sk-ant-SECRET ' + 'y'.repeat(600) });
    recordAiCall({ ...base, ok: false, error: 'empty response' });
    expect(H.inserted[0].error).toBe('HTTP 401: bad key [redacted], also [redacted] [redacted] [redacted] [redacted] [redacted] [redacted]');
    expect(H.inserted[1].error).toHaveLength(500);
    expect(JSON.stringify(H.inserted)).not.toContain('SECRET');
    expect(H.inserted[2].error).toBe('empty response');
  });
});

describe('recordAiCall never reaches the work it records', () => {
  it('returns nothing, at once, while the insert is still pending', async () => {
    let finish!: () => void;
    H.values = () => new Promise<void>(resolve => { finish = resolve; });
    const out = recordAiCall({ ...base, inputTokens: 1, outputTokens: 1 });
    expect(out).toBeUndefined();
    expect(H.inserted).toHaveLength(1);
    finish();
  });
  it('an insert that rejects is swallowed: no throw and no unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      H.values = () => Promise.reject(new Error('connection terminated'));
      expect(() => recordAiCall({ ...base })).not.toThrow();
      await new Promise(r => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally { process.off('unhandledRejection', unhandled); }
  });
  it('an insert that throws synchronously is swallowed too', () => {
    H.values = () => { throw new Error('pool is closed'); };
    expect(() => recordAiCall({ ...base })).not.toThrow();
  });
  it('a lazy query that only fails when run (a thenable, like the real query builder) is swallowed', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      H.values = () => ({ then: (_ok: any, fail: any) => fail(new Error('relation "ai_calls" does not exist')) });
      expect(() => recordAiCall({ ...base })).not.toThrow();
      await new Promise(r => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally { process.off('unhandledRejection', unhandled); }
  });
  it('a record that cannot even be read does not throw', () => {
    const hostile: any = { ...base, get error() { throw new Error('getter'); } };
    expect(() => recordAiCall(hostile)).not.toThrow();
  });
});

// Prompt caching, as the sandbox publisher's model proxy reports it: uncached input, cache reads and cache writes are
// separate counts billed at separate rates. Rates: platform.claude.com/docs/en/about-claude/pricing (2026-11-12).
describe('costOf: prompt-cache tokens', () => {
  const cached = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 100_000, cacheWriteTokens: 20_000, cacheWrite1hTokens: 5_000 };
  it('prices uncached input, cache reads, 5-minute writes, 1-hour writes and output each at its own rate', () => {
    // Opus 5.5: 4 in, 20 out, 0.20 read, 5 write, 8 one-hour write, per 1M.
    expect(costOf('claude-opus-5.5', cached, 'Anthropic')).toBeCloseTo((1000 * 4 + 500 * 20 + 100_000 * 0.20 + 20_000 * 5 + 5_000 * 8) / 1e6, 10);
    expect(costOf('claude-opus-5-5', cached)).toBeCloseTo(0.174, 10);
    expect(costOf('claude-sonnet-5-5', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 })).toBeCloseTo(0.10, 10);
    expect(costOf('claude-fable-5-2', { cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000, cacheWrite1hTokens: 1_000_000 })).toBeCloseTo(0.20 + 10 + 16, 10);
  });
  it('a cache read is far cheaper than the same tokens uncached, and a cache write dearer', () => {
    const uncached = costOf('claude-opus-5-5', { inputTokens: 100_000, outputTokens: 0 })!;
    expect(costOf('claude-opus-5-5', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 100_000 })!).toBeCloseTo(uncached / 20, 10);
    expect(costOf('claude-opus-5-5', { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 100_000 })!).toBeCloseTo(uncached * 1.25, 10);
    expect(costOf('claude-opus-5-5', { inputTokens: 0, outputTokens: 0, cacheWrite1hTokens: 100_000 })!).toBeCloseTo(uncached * 2, 10);
  });
  it('a call that reports no cache tokens costs exactly what it did before', () => {
    expect(costOf('claude-opus-5.5', { inputTokens: 1000, outputTokens: 500 })).toBeCloseTo(0.014, 10);
    expect(costOf('claude-opus-5.5', { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: null })).toBeCloseTo(0.014, 10);
    expect(costOf('gpt-6-sol', { inputTokens: 1000, outputTokens: 500 })).toBeCloseTo(0.007, 10);
  });
  it('cached tokens on a model with no published cache rate are an unknown cost, never a guess', () => {
    expect(costOf('gpt-6-sol', { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 10 })).toBeNull();
    expect(costOf('grok-4.7', { inputTokens: 1000, outputTokens: 500, cacheWriteTokens: 10 })).toBeNull();
    expect(costOf('unknown-model', { cacheReadTokens: 10 })).toBeNull();
  });
  it('the long-prompt threshold counts cached tokens as part of the prompt', () => {
    // Haiku 5.5 over 100,000 prompt tokens: 0.50 in, 0.05 read. Under: 0.10 in, 0.01 read.
    expect(costOf('claude-haiku-5-5', { inputTokens: 10_000, outputTokens: 0, cacheReadTokens: 95_000 })).toBeCloseTo((10_000 * 0.50 + 95_000 * 0.05) / 1e6, 12);
    expect(costOf('claude-haiku-5-5', { inputTokens: 10_000, outputTokens: 0, cacheReadTokens: 80_000 })).toBeCloseTo((10_000 * 0.10 + 80_000 * 0.01) / 1e6, 12);
    expect(costOf('claude-haiku-5-5', { inputTokens: 100_000, outputTokens: 0 })).toBeCloseTo(0.01, 12);
  });
});

describe('recordAiCallNow: the awaited writer', () => {
  const proxyCall = { businessId: 'biz', task: 'writing', purpose: 'github.integration.agent', model: 'claude-opus-5.5', provider: 'Anthropic', latencyMs: 900, ok: true };
  it('writes the same columns as recordAiCall, with cached tokens folded into the one input column and priced apart', async () => {
    await recordAiCallNow({ ...proxyCall, inputTokens: 1000, outputTokens: 500, cacheReadTokens: 100_000, cacheWriteTokens: 20_000, cacheWrite1hTokens: 5_000 });
    expect(H.inserted).toEqual([{ businessId: 'biz', task: 'writing', purpose: 'github.integration.agent', model: 'claude-opus-5.5', provider: 'Anthropic', latencyMs: 900, inputTokens: 126_000, outputTokens: 500, costUsd: expect.closeTo(0.174, 10), ok: true, error: null }]);
  });
  it('recordAiCall folds and prices cached tokens the same way', () => {
    recordAiCall({ ...proxyCall, inputTokens: 1000, outputTokens: 500, cacheReadTokens: 100_000 });
    expect(H.inserted[0]).toMatchObject({ inputTokens: 101_000, outputTokens: 500, costUsd: expect.closeTo((1000 * 4 + 500 * 20 + 100_000 * 0.20) / 1e6, 10) });
  });
  it('a cost the caller worked out wins, and a call with no usage keeps null tokens', async () => {
    await recordAiCallNow({ ...proxyCall, inputTokens: 10, outputTokens: 10, cacheReadTokens: 10, costUsd: 0.5 });
    await recordAiCallNow({ ...proxyCall, ok: false, error: 'HTTP 529' });
    expect(H.inserted.map(r => [r.inputTokens, r.outputTokens, r.costUsd, r.ok, r.error])).toEqual([[20, 10, 0.5, true, null], [null, null, null, false, 'HTTP 529']]);
  });
  it('resolves only after the insert has finished', async () => {
    let finish!: () => void, done = false;
    H.values = () => new Promise<void>(resolve => { finish = resolve; });
    const pending = recordAiCallNow({ ...proxyCall, inputTokens: 1, outputTokens: 1 }).then(() => { done = true; });
    await new Promise(r => setTimeout(r, 10));
    expect(done).toBe(false);
    finish();
    await pending;
    expect(done).toBe(true);
  });
  it('rejects with the insert error, so the caller can report it: failing asynchronously, synchronously or while reading the record', async () => {
    H.values = () => Promise.reject(new Error('connection terminated'));
    await expect(recordAiCallNow({ ...proxyCall })).rejects.toThrow('connection terminated');
    H.values = () => { throw new Error('pool is closed'); };
    await expect(recordAiCallNow({ ...proxyCall })).rejects.toThrow('pool is closed');
    const hostile: any = { ...proxyCall, get error() { throw new Error('getter'); } };
    await expect(recordAiCallNow(hostile)).rejects.toThrow('getter');
  });
  it('removes provider keys from the error it stores', async () => {
    Object.assign(env, { anthropicKey: 'sk-ant-SECRET' });
    await recordAiCallNow({ ...proxyCall, ok: false, error: new Error('HTTP 401: sk-ant-SECRET rejected') });
    expect(H.inserted[0].error).toBe('HTTP 401: [redacted] rejected');
  });
});
