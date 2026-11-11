import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { z } from 'zod';

const M = vi.hoisted(() => ({ report: vi.fn(), put: vi.fn(), rows: [] as any[] }));
vi.mock('../observability/failures', () => ({ reportFailure: M.report }));
vi.mock('../db', () => ({
  db: {
    insert: () => ({ values: (row: any) => { M.rows.push(row); return Promise.resolve(); } }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ ai: { writing: 'gpt-6-sol', research: 'claude-opus-5.5' } }] }) }) }),
  },
  schema: { aiCalls: {}, businesses: { id: 'id' } },
}));
vi.mock('../services/storage', () => ({ objectKey: () => 'bid/images/test.png', putObject: M.put }));

beforeEach(() => {
  vi.resetModules(); M.report.mockReset().mockResolvedValue(undefined); M.put.mockReset().mockResolvedValue('/image.png'); M.rows.length = 0;
  vi.stubEnv('RADAR_AI_TIERS', 'off'); // the routing from before model tiers (tiered: tiers.run.test.ts)
  vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function configured(overrides: Record<string, any> = {}) {
  const { env } = await import('../env');
  Object.assign(env, { devStubs: false, openrouterKey: '', openaiKey: '', anthropicKey: '', xaiKey: '', perplexityKey: '', geminiKey: '', openrouterModelMap: '', openrouterImageModel: '', openrouterVisModels: '', ...overrides });
  return env;
}
const json = (data: any, status = 200) => Response.json(data, { status });
const directAnswer = () => json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'direct answer' }] }] });
const req = { bid: 'bid', style: 'illustration', brand: { primary: '#123456', secondary: '#abcdef' }, headline: 'Private headline', name: 'Private name', prompt: 'PRIVATE IMAGE PROMPT', seed: 3, w: 60, h: 40, kind: 'article-body' };
const imageAnswer = () => json({ data: [{ b64_json: createCanvas(20, 20).toBuffer('image/png').toString('base64') }] });
const visibilityCtx = { stub: { bid: 'bid', profile: {}, pages: [], manual: true } };

function expectPrivateContextExcluded() {
  for (const [, context] of M.report.mock.calls) {
    const serialized = JSON.stringify(context);
    expect(serialized).not.toMatch(/PRIVATE|Private headline|Private name/);
    expect(context).not.toHaveProperty('prompt'); expect(context).not.toHaveProperty('input');
  }
}

describe('AI provider failure observability', () => {
  it('awaits an exhausted-credit alert before a successful direct fallback', async () => {
    await configured({ openrouterKey: 'router-test', openaiKey: 'openai-test' });
    let release!: () => void;
    M.report.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const fetcher = vi.fn(async (url: any) => String(url).includes('openrouter.ai') ? json({ error: { code: 402, message: 'Insufficient credits' } }, 402) : directAnswer());
    vi.stubGlobal('fetch', fetcher);
    const { run } = await import('./index');
    const pending = run('writing', { purpose: 'article.draft', prompt: 'PRIVATE ARTICLE PROMPT' }, { businessId: 'bid', retries: 0 });
    await vi.waitFor(() => expect(M.report).toHaveBeenCalledTimes(1));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(M.report.mock.calls[0][0]).toMatchObject({ status: 402 });
    expect(M.report.mock.calls[0][1]).toMatchObject({ source: 'ai', operation: 'article.draft', businessId: 'bid', provider: 'openrouter', model: 'openai/gpt-6-sol', retrying: true });
    release();
    await expect(pending).resolves.toMatchObject({ text: 'direct answer', provider: 'OpenAI' });
    expectPrivateContextExcluded();
  });

  it('reports provider timeout before preserving a successful fallback result', async () => {
    await configured({ openrouterKey: 'router-test', openaiKey: 'openai-test' });
    const timeout = Object.assign(new Error('Provider timed out'), { name: 'TimeoutError' });
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      if (String(url).includes('openrouter.ai')) throw timeout;
      expect(M.report).toHaveBeenCalledWith(timeout, expect.objectContaining({ provider: 'openrouter', retrying: true }));
      return directAnswer();
    }));
    const { run } = await import('./index');
    await expect(run('writing', { purpose: 'article.draft', prompt: 'PRIVATE' }, { retries: 0 })).resolves.toMatchObject({ provider: 'OpenAI' });
    expectPrivateContextExcluded();
  });

  it('keeps terminal provider diagnostics as a non-enumerable cause while preserving safe client copy', async () => {
    await configured({ openaiKey: 'openai-test' });
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { message: 'Quota exhausted' } }, 429)));
    const { run } = await import('./index');
    const error = await run('writing', { purpose: 'social.generate', prompt: 'PRIVATE SOCIAL PROMPT' }, { retries: 0 }).catch(error => error);
    expect(error).toMatchObject({ code: 'ai_failed', status: 502, userMessage: 'Radar couldn’t finish this. Try again.' });
    expect(error.cause).toMatchObject({ status: 429 });
    expect(Object.keys(error)).not.toContain('cause');
    expect(JSON.stringify(error)).not.toMatch(/Quota|OpenAI|PRIVATE/);
    expect(M.report).toHaveBeenCalledTimes(1);
    expect(M.report.mock.calls[0][1]).toMatchObject({ source: 'ai', provider: 'OpenAI', retrying: false });
    expectPrivateContextExcluded();
  });

  it('reports invalid structured output without copying generated values into validation diagnostics', async () => {
    await configured({ openaiKey: 'openai-test' });
    vi.stubGlobal('fetch', vi.fn(async () => json({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"choice":"PRIVATE GENERATED VALUE"}' }] }] })));
    const { run } = await import('./index');
    await expect(run('writing', { purpose: 'article.outline', prompt: 'PRIVATE', schema: z.object({ choice: z.enum(['safe']) }) }, { retries: 0 })).rejects.toMatchObject({ code: 'ai_failed' });
    expect(M.report.mock.calls[0][0].message).toContain('Structured output failed validation');
    expect(M.report.mock.calls[0][0].message).not.toContain('PRIVATE');
    expectPrivateContextExcluded();
  });
});

describe('image failure observability', () => {
  it('reports credit failure before switching image providers and keeps the requested output', async () => {
    await configured({ openrouterKey: 'router-test', openaiKey: 'openai-test' });
    const fetcher = vi.fn(async (url: any) => {
      if (String(url).includes('openrouter.ai')) return json({ error: { code: 402, message: 'Insufficient credits' } }, 402);
      expect(M.report).toHaveBeenCalledTimes(1);
      return imageAnswer();
    });
    vi.stubGlobal('fetch', fetcher);
    const { renderImageFile } = await import('../services/images');
    await expect(renderImageFile({ ...req, modelRequired: true })).resolves.toMatchObject({ url: '/image.png', type: 'image/png' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(M.report.mock.calls[0][0]).toMatchObject({ status: 402 });
    expect(M.report.mock.calls[0][1]).toMatchObject({ source: 'image', provider: 'openrouter', businessId: 'bid', retrying: true });
    expectPrivateContextExcluded();
  });

  it('reports optional image degradation and a separate storage failure without hiding either outcome', async () => {
    await configured({ openaiKey: 'openai-test' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('provider unavailable', { status: 503 })));
    const { renderImageFile } = await import('../services/images');
    await expect(renderImageFile(req)).resolves.toMatchObject({ url: '/image.png' });
    expect(M.report.mock.calls.some(([error, ctx]) => error.status === 503 && ctx.provider === 'openai' && ctx.degraded)).toBe(true);
    const stored = M.put.mock.calls[0][1];
    expect(stored.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const storageFailure = new Error('storage unavailable'); M.put.mockRejectedValue(storageFailure);
    await expect(renderImageFile({ ...req, style: 'branded' })).rejects.toBe(storageFailure);
    expect(M.report).toHaveBeenLastCalledWith(storageFailure, expect.objectContaining({ operation: 'image.store', businessId: 'bid' }));
    expectPrivateContextExcluded();
  });

  it('reports an invalid image response when decoding fails and still creates the intended optional template', async () => {
    await configured({ openaiKey: 'openai-test' });
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [{ b64_json: Buffer.from('not an image').toString('base64') }] })));
    const { renderImageFile } = await import('../services/images');
    await expect(renderImageFile(req)).resolves.toMatchObject({ url: '/image.png' });
    expect(M.report).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ source: 'image', operation: 'image.generate', degraded: true }));
    expect(M.put).toHaveBeenCalledTimes(1); expectPrivateContextExcluded();
  });

  it('reports an unavailable explicitly requested model and never creates a template instead', async () => {
    await configured(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const { renderImageFile } = await import('../services/images');
    await expect(renderImageFile({ ...req, modelRequired: true })).rejects.toMatchObject({ code: 'image_unavailable', status: 503 });
    expect(fetcher).not.toHaveBeenCalled(); expect(M.put).not.toHaveBeenCalled();
    expect(M.report).toHaveBeenCalledWith(expect.objectContaining({ code: 'image_unavailable' }), expect.objectContaining({ operation: 'image.generate', businessId: 'bid' }));
    expectPrivateContextExcluded();
  });
});

describe('AI visibility route observability', () => {
  it('alerts on OpenRouter failure before successful official API fallback', async () => {
    await configured({ openrouterKey: 'router-test', openaiKey: 'openai-test' });
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      if (String(url).includes('openrouter.ai')) return json({ error: { code: 402, message: 'Insufficient credits' } }, 402);
      expect(M.report).toHaveBeenCalledTimes(1); return directAnswer();
    }));
    const { askEngine } = await import('../services/visibility/engines');
    await expect(askEngine('ChatGPT', 'PRIVATE VISIBILITY PROMPT', visibilityCtx)).resolves.toMatchObject({ text: 'direct answer' });
    expect(M.report.mock.calls[0][1]).toMatchObject({ source: 'visibility', provider: 'openrouter', model: 'openai/gpt-6-sol', businessId: 'bid', retrying: true });
    expectPrivateContextExcluded();
  });

  it('reports a configured direct failure but leaves an intentionally unconfigured engine quiet', async () => {
    await configured({ openaiKey: 'openai-test' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('provider outage', { status: 503 })));
    const { askEngine, EngineUnavailable } = await import('../services/visibility/engines');
    await expect(askEngine('ChatGPT', 'PRIVATE', visibilityCtx)).rejects.toMatchObject({ status: 503 });
    expect(M.report).toHaveBeenCalledTimes(1);
    expect(M.report.mock.calls[0][1]).toMatchObject({ provider: 'ChatGPT', model: 'gpt-6-sol' });
    await expect(askEngine('Perplexity', 'PRIVATE', visibilityCtx)).rejects.toBeInstanceOf(EngineUnavailable);
    expect(M.report).toHaveBeenCalledTimes(1); expectPrivateContextExcluded();
  });
});
