// recordAiCall: the one writer of ai_calls. What it writes, and that it can never throw into, be awaited by or delay
// the work it records.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({ values: (_row: any): any => Promise.resolve(), inserted: [] as any[] }));
vi.mock('../db', () => ({ db: { insert: () => ({ values: (row: any) => { H.inserted.push(row); return H.values(row); } }) }, schema: { aiCalls: {} } }));
import { env } from '../env';
import { recordAiCall } from './record';

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
