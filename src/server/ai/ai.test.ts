import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { claudeSchema } from './adapters/anthropic';
import { isAccountError } from './index';

describe('claudeSchema', () => {
  const S = z.object({
    format: z.enum(['a', 'b']),
    pattern: z.string().min(3).max(9),
    items: z.array(z.object({ n: z.number().int().min(0).max(5) })).min(2).max(4),
    url: z.string().url().nullable(),
  });
  const out = claudeSchema(z.toJSONSchema(S as any, { target: 'draft-7' } as any));
  const json = JSON.stringify(out);

  it('keeps property names that look like keywords', () => {
    expect(Object.keys(out.properties).sort()).toEqual(['format', 'items', 'pattern', 'url']);
  });
  it('removes constraints Claude rejects', () => {
    for (const k of ['"minimum"', '"maximum"', '"minLength"', '"maxLength"', '"maxItems"', '"$schema"']) expect(json).not.toContain(k);
    expect(out.properties.items.minItems).toBe(1);
  });
  it('closes every object', () => {
    expect(out.additionalProperties).toBe(false);
    expect(out.properties.items.items.additionalProperties).toBe(false);
  });
});

describe('isAccountError', () => {
  it('treats billing, auth and quota failures as account errors', () => {
    expect(isAccountError({ status: 401 })).toBe(true);
    expect(isAccountError({ status: 402 })).toBe(true);
    expect(isAccountError(new Error('HTTP 429: {"error":{"message":"You have no credits remaining."}}'))).toBe(true);
    expect(isAccountError(new Error('HTTP 429: You exceeded your current quota'))).toBe(true);
  });
  it('leaves rate limits and outages to normal retries', () => {
    expect(isAccountError(new Error('HTTP 429: Rate limit reached, slow down'))).toBe(false);
    expect(isAccountError({ status: 500 })).toBe(false);
    expect(isAccountError({ status: 400 })).toBe(false);
  });
});

import { fitToSchema } from './index';
describe('fitToSchema', () => {
  const S = z.object({ markets: z.array(z.string().max(12)).max(2), score: z.number().int().min(0).max(100), note: z.string().max(10).nullable(), kids: z.array(z.object({ t: z.string().max(5) })) });
  const js: any = z.toJSONSchema(S as any, { target: 'draft-7' } as any);
  it('brings overshooting output within limits so validation passes', () => {
    const fixed = fitToSchema({ markets: ['United States of America', 'UK', 'EU'], score: 140.6, note: 'a very long note here', kids: [{ t: 'toolong' }] }, js);
    expect(S.safeParse(fixed).success).toBe(true);
    expect(fixed.markets).toEqual(['United', 'UK']);
    expect(fixed.score).toBe(100);
    expect(fixed.kids[0].t.length).toBeLessThanOrEqual(5);
  });
  it('leaves valid output and nulls untouched', () => {
    const ok = { markets: ['UK'], score: 5, note: null, kids: [] };
    expect(fitToSchema(ok, js)).toEqual(ok);
  });
});

import { summarize, jobProducedOutcome } from '../events';
describe('impact events', () => {
  it('keeps ids, counts and platforms but drops drafts, secrets and long text', () => {
    const s: any = summarize({ input: { id: 'r1', plat: 'reddit', text: 'draft', drafts: { help: 'x' }, apiKey: 'sk', note: 'n' }, result: { added: 2, url: 'https://x.com/a', long: 'z'.repeat(300), list: [{ a: 1 }] } });
    expect(s).toEqual({ input: { id: 'r1', plat: 'reddit' }, result: { added: 2, url: 'https://x.com/a', list: { count: 1 } } });
  });
  it('counts only jobs that did real work', () => {
    expect(jobProducedOutcome('brief.scan', { added: 0 })).toBe(true);
    expect(jobProducedOutcome('social.autoRun', { packId: null })).toBe(false);
    expect(jobProducedOutcome('article.draft', { skipped: 'missing' })).toBe(false);
    expect(jobProducedOutcome('gsc.backfill', {})).toBe(false);
  });
});

import { classifyProviderError } from '../services/keywords/provider';
describe('keyword provider errors', () => {
  it('recognises an empty account', () => {
    expect(classifyProviderError({ code: 40200, message: 'DataForSEO task error 40200: Payment Required.' })).toBe('credit');
    expect(classifyProviderError({ status: 402 })).toBe('credit');
    expect(classifyProviderError({ status: 500, message: 'DataForSEO 500' })).toBe('error');
  });
});

import { vi } from 'vitest';
import { openaiRun } from './adapters/openai';
import { imagePrompt } from '../services/images';
const sse = (events: any[]) => new Response(new ReadableStream({ start(c) { for (const e of events) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(e)}\n\n`)); c.close(); } }), { status: 200 });
describe('streaming errors', () => {
  it('turns an in-stream quota error into an account error instead of an empty article', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse([{ type: 'response.created' }, { type: 'response.failed', response: { error: { code: 'insufficient_quota', message: 'You have no credits remaining.' } } }])));
    let err: any = null;
    try { await openaiRun({ apiModel: 'm', prompt: 'p', maxTokens: 10, timeoutMs: 5000, onDelta: () => {} }, { base: 'https://api.openai.com/v1', key: 'k' }); } catch (e) { err = e; }
    vi.unstubAllGlobals();
    expect(err).toBeTruthy();
    expect(isAccountError(err)).toBe(true);
  });
  it('still returns streamed text on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse([{ type: 'response.output_text.delta', delta: 'Hello ' }, { type: 'response.output_text.delta', delta: 'world' }, { type: 'response.completed', response: { usage: { output_tokens: 2 } } }])));
    const out = await openaiRun({ apiModel: 'm', prompt: 'p', maxTokens: 10, timeoutMs: 5000, onDelta: () => {} }, { base: 'https://api.openai.com/v1', key: 'k' });
    vi.unstubAllGlobals();
    expect(out.text).toBe('Hello world');
  });
});
describe('image prompt', () => {
  it('uses brand colors and forbids text', () => {
    const p = imagePrompt({ style: 'illustration', headline: 'Move docs', name: 'Thally', brand: { primary: '#6B7A3A', secondary: '#F5E08A' } as any, seed: 1 });
    expect(p).toContain('#6B7A3A'); expect(p).toMatch(/No words, letters/);
  });
});
