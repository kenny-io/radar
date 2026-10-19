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
