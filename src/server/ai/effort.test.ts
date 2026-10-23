// Reasoning effort: short copy asks Grok to think less (Grok 4.7 defaults to "high" and took minutes on a 280-char post).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { openaiRun } from './adapters/openai';

const calls: any[] = [];
const ok = () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi', annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
function mock(handler: (body: any) => Response) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (_u: any, init: any) => { const b = JSON.parse(init.body); calls.push(b); return handler(b); }));
}
const call = { apiModel: 'grok-4.7', prompt: 'p', maxTokens: 100, timeoutMs: 5000, effort: 'low' as const };
afterEach(() => vi.unstubAllGlobals());

describe('reasoning effort', () => {
  it('sends reasoning.effort to xAI', async () => {
    mock(() => ok());
    await openaiRun(call, { base: 'https://api.x.ai/v1', key: 'k' });
    expect(calls[0].reasoning).toEqual({ effort: 'low' });
  });
  it('does not send it to OpenAI', async () => {
    mock(() => ok());
    await openaiRun({ ...call, apiModel: 'gpt-6-sol' }, { base: 'https://api.openai.com/v1', key: 'k' });
    expect(calls[0].reasoning).toBeUndefined();
  });
  it('retries once without it if the model rejects the setting', async () => {
    mock(b => (b.reasoning ? new Response('{"error":"reasoning effort not supported for this model"}', { status: 400 }) : ok()));
    const r = await openaiRun(call, { base: 'https://api.x.ai/v1', key: 'k' });
    expect(r.text).toBe('hi'); expect(calls.length).toBe(2); expect(calls[1].reasoning).toBeUndefined();
  });
});
