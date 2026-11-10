// The owner's rule for operator alerts: a provider that fails while a fallback or a retry is still to come is the system
// working as designed, so it is logged and nothing is emailed. One alert goes out when the whole call fails.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';

const M = vi.hoisted(() => ({ deliver: vi.fn(async (..._args: any[]) => {}) }));
vi.mock('../observability/delivery', () => ({ persistAndDeliverAlert: M.deliver }));
vi.mock('../db', () => ({
  db: {
    insert: () => ({ values: () => Promise.resolve() }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ ai: { writing: 'gpt-6-sol', research: 'claude-opus-5.5' } }] }) }) }),
  },
  schema: { aiCalls: {}, businesses: { id: 'id' } },
}));
vi.mock('../services/storage', () => ({ objectKey: () => 'bid/images/test.png', putObject: vi.fn(async () => '/image.png') }));

let logged: any[] = [];
beforeEach(() => {
  vi.resetModules(); M.deliver.mockClear(); logged = [];
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('RADAR_FAILURE_ALERTS', 'on'); vi.stubEnv('RADAR_DEV_STUBS', '0');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation((tag: any, line: any) => { if (tag === '[radar.failure]') logged.push(JSON.parse(line)); });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function configured(keys: Record<string, string>) {
  const { env } = await import('../env');
  Object.assign(env, { devStubs: false, openrouterKey: '', openaiKey: '', anthropicKey: '', xaiKey: '', perplexityKey: '', geminiKey: '', openrouterModelMap: '', openrouterImageModel: '', openrouterVisModels: '', ...keys });
}
const noCredit = () => Response.json({ error: { code: 402, message: 'Insufficient credits' } }, { status: 402 });
const claude = () => Response.json({ content: [{ type: 'text', text: 'written by Claude' }], usage: { input_tokens: 1, output_tokens: 1 } });
/** Each provider answers from its own stub; returns the hosts in the order they were called. */
function providers(answer: { openrouter: () => Response; openai: () => Response; anthropic: () => Response }) {
  const called: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: any) => {
    const host = String(url).includes('openrouter.ai') ? 'openrouter' : String(url).includes('api.openai.com') ? 'openai' : 'anthropic';
    called.push(host); return answer[host]();
  }));
  return called;
}
const alerts = () => M.deliver.mock.calls.map(c => (c[0] as any).context);

describe('operator alerts across the AI fallback chain', () => {
  it('OpenRouter and OpenAI are out of credit, Claude writes it: both failures are logged and no alert is sent', async () => {
    await configured({ openrouterKey: 'router-test', openaiKey: 'openai-test', anthropicKey: 'anthropic-test' });
    const called = providers({ openrouter: noCredit, openai: noCredit, anthropic: claude });
    const { run } = await import('./index');
    await expect(run('writing', { purpose: 'article.draft', prompt: 'Write it' }, { businessId: 'bid', retries: 0 })).resolves.toMatchObject({ text: 'written by Claude', provider: 'Anthropic' });
    expect(called).toEqual(['openrouter', 'openai', 'anthropic']);
    expect(logged.map(e => [e.context.provider, e.error.status, e.context.retrying])).toEqual([['openrouter', 402, true], ['OpenAI', 402, true]]);
    expect(alerts()).toEqual([]);
  });

  it('every provider is out of credit: exactly one alert, for the failure that ended the call', async () => {
    await configured({ openrouterKey: 'router-test', openaiKey: 'openai-test', anthropicKey: 'anthropic-test' });
    const called = providers({ openrouter: noCredit, openai: noCredit, anthropic: noCredit });
    const { run } = await import('./index');
    await expect(run('writing', { purpose: 'article.draft', prompt: 'Write it' }, { businessId: 'bid', retries: 0 })).rejects.toMatchObject({ code: 'ai_failed' });
    expect(called).toEqual(['openrouter', 'openai', 'anthropic']);
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toMatchObject({ source: 'ai', operation: 'article.draft', businessId: 'bid', provider: 'Anthropic', retrying: false });
    expect((M.deliver.mock.calls[0][0] as any).error.status).toBe(402);
  });

  it('a transient error that succeeds on the retry sends no alert; one that fails every retry sends one', async () => {
    await configured({ openaiKey: 'openai-test' });
    let n = 0;
    const ok = () => Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'second try' }] }] });
    providers({ openrouter: noCredit, anthropic: noCredit, openai: () => n++ ? ok() : Response.json({ error: { message: 'overloaded' } }, { status: 503 }) });
    const { run } = await import('./index');
    await expect(run('writing', { purpose: 'social.copy', prompt: 'Write it' }, { retries: 1 })).resolves.toMatchObject({ text: 'second try' });
    expect(logged).toHaveLength(1); expect(alerts()).toEqual([]);
    providers({ openrouter: noCredit, anthropic: noCredit, openai: () => Response.json({ error: { message: 'overloaded' } }, { status: 503 }) });
    await expect(run('writing', { purpose: 'social.copy', prompt: 'Write it' }, { retries: 1 })).rejects.toMatchObject({ code: 'ai_failed' });
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toMatchObject({ provider: 'OpenAI', attempt: 2, maxAttempts: 2, retrying: false });
  }, 15_000);
});

describe('operator alerts across the image and AI visibility fallbacks', () => {
  const image = () => Response.json({ data: [{ b64_json: createCanvas(20, 20).toBuffer('image/png').toString('base64') }] });
  const req = { bid: 'bid', style: 'illustration', brand: { primary: '#123456', secondary: '#abcdef' }, headline: 'Headline', name: 'Name', prompt: 'Prompt', seed: 3, w: 60, h: 40, kind: 'article-body', modelRequired: true };
  /** Production reports always run inside a job or action scope, which is what collapses nested reports of one failure. */
  const inJob = async <T,>(fn: () => Promise<T>) => { const { withFailureContext } = await import('../observability/failures'); return withFailureContext({ source: 'job', operation: 'test.job' }, fn); };

  it('an image OpenRouter cannot pay for is made by OpenAI: no alert; when OpenAI fails too: one alert', async () => {
    await configured({ openrouterKey: 'router-test', openaiKey: 'openai-test' });
    providers({ openrouter: noCredit, openai: image, anthropic: noCredit });
    const { renderImageFile } = await import('../services/images');
    await expect(inJob(() => renderImageFile(req as any))).resolves.toMatchObject({ url: '/image.png' });
    expect(logged.map(e => [e.context.provider, e.context.retrying])).toEqual([['openrouter', true]]);
    expect(alerts()).toEqual([]);
  });
  it('every image provider fails: one alert', async () => {
    await configured({ openrouterKey: 'router-test', openaiKey: 'openai-test' });
    providers({ openrouter: () => new Response('unavailable', { status: 503 }), openai: () => new Response('unavailable', { status: 503 }), anthropic: noCredit });
    const { renderImageFile } = await import('../services/images');
    await expect(inJob(() => renderImageFile(req as any))).rejects.toBeTruthy();
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toMatchObject({ source: 'image', provider: 'openai', retrying: false });
  });
  const ctx = { stub: { bid: 'bid', profile: {}, pages: [], manual: true } };
  it('an AI visibility question OpenRouter cannot answer is answered by the official API: no alert', async () => {
    await configured({ openrouterKey: 'router-test', openaiKey: 'openai-test' });
    providers({ openrouter: noCredit, anthropic: noCredit, openai: () => Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'direct answer' }] }] }) });
    const { askEngine } = await import('../services/visibility/engines');
    await expect(inJob(() => askEngine('ChatGPT', 'Who is best?', ctx))).resolves.toMatchObject({ text: 'direct answer' });
    expect(logged.map(e => [e.context.provider, e.context.retrying])).toEqual([['openrouter', true]]);
    expect(alerts()).toEqual([]);
  });
  it('OpenRouter and the official API both fail an AI visibility question: one alert', async () => {
    await configured({ openrouterKey: 'router-test', openaiKey: 'openai-test' });
    const called = providers({ openrouter: () => new Response('unavailable', { status: 503 }), anthropic: noCredit, openai: () => new Response('unavailable', { status: 503 }) });
    const { askEngine } = await import('../services/visibility/engines');
    await expect(inJob(() => askEngine('ChatGPT', 'Who is best?', ctx))).rejects.toBeTruthy();
    expect(called).toEqual(['openrouter', 'openai']);
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]).toMatchObject({ source: 'visibility', provider: 'ChatGPT' });
    expect(alerts()[0].retrying).not.toBe(true);
  });
});

