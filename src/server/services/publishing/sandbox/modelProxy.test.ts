// The model proxy's request handler against a stub upstream: no network, no database. Each test drives real Request and
// Response objects through handleModelProxyRequest and looks at what the caller gets back, what the stub upstream was
// sent, what was recorded and what was logged.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DB = vi.hoisted(() => ({ inserted: [] as any[] }));
vi.mock('@/server/db', () => ({ db: { insert: () => ({ values: (row: any) => { DB.inserted.push(row); return Promise.resolve(); } }) }, schema: { aiCalls: {} } }));
import { recordAiCallNow, type AiCallRecord } from '@/server/ai/record';
import { mintPublishCapability } from './capability';
import { BUDGET_EXHAUSTED_MESSAGE, MODEL_PROXY_LIMITS, ModelProxyState, handleModelProxyRequest, readModelProxyEnvironment, serveModelProxyRequest, type ModelProxyDeps, type ModelProxyEvent } from './modelProxy';

const SECRET = 'unit-test-capability-secret-0123456789';
const PROVIDER_KEY = 'sk-ant-api03-PROVIDER-KEY-DO-NOT-LEAK';
const NOW = Date.UTC(2026, 10, 12, 9, 0, 0);
const RUN = '0b9f6f0e-3c1d-4c58-9d55-6b1f4a2e7c11';
const OTHER_RUN = '7f3f1a4e-56f1-4b7c-8a1e-0e1b9c2d3a4f';
const BUSINESS = '5d0c2a34-8f0b-4d0e-a1a2-0c9a3f5b7e21';
const PROMPT = 'PROMPT-MARKER integrate the article';
const ANSWER = 'ANSWER-MARKER done';
const BASE = 'https://model-proxy.test/model';

const capability = (over: Partial<Parameters<typeof mintPublishCapability>[0]> = {}, now = NOW) =>
  mintPublishCapability({ runId: RUN, bid: BUSINESS, entryId: 'e_tl6rSYPs', model: 'claude-opus-5-5', maxUsd: 6, maxCalls: 200, exp: Math.floor(now / 1000) + 870, ...over }, SECRET, now);

/** Opus 5.5 per 1M: 4 in, 20 out, 0.20 cache read, 5 five-minute write, 8 one-hour write. */
const USAGE = { input_tokens: 1000, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 25_000, cache_creation: { ephemeral_5m_input_tokens: 20_000, ephemeral_1h_input_tokens: 5_000 }, output_tokens: 500 };
const USAGE_COST = (1000 * 4 + 500 * 20 + 100_000 * 0.20 + 20_000 * 5 + 5_000 * 8) / 1e6; // 0.174
const messageJson = (usage: unknown = USAGE) => JSON.stringify({ id: 'msg_01StubStubStub', type: 'message', role: 'assistant', content: [{ type: 'text', text: ANSWER }], stop_reason: 'end_turn', usage });
const jsonAnswer = (usage?: unknown) => new Response(messageJson(usage), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_stub_1', 'anthropic-organization-id': 'org-internal' } });

const sse = (events: [string, unknown][]) => events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
const SSE_START = { type: 'message_start', message: { id: 'msg_01StreamStream', type: 'message', role: 'assistant', content: [], usage: { input_tokens: 12, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 4_000, cache_creation: { ephemeral_5m_input_tokens: 4_000, ephemeral_1h_input_tokens: 0 }, output_tokens: 3 } } };
const SSE_TEXT = { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `${ANSWER} — naïve café ✓` } };
const SSE_END = { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2_000 } };
const SSE_BODY = sse([['message_start', SSE_START], ['ping', { type: 'ping' }], ['content_block_delta', SSE_TEXT], ['message_delta', SSE_END], ['message_stop', { type: 'message_stop' }]]);
const SSE_COST = (12 * 4 + 2_000 * 20 + 90_000 * 0.20 + 4_000 * 5) / 1e6; // 0.078048

const bytes = (text: string) => new TextEncoder().encode(text);
/** A body the test feeds by hand, so it can hold a stream open, end it or watch it being cancelled. */
function manualBody() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const state = { cancelled: false };
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; }, cancel() { state.cancelled = true; } });
  return { stream, state, push: (text: string | Uint8Array) => controller.enqueue(typeof text === 'string' ? bytes(text) : text), close: () => controller.close(), fail: () => controller.error(new Error('socket hang up')) };
}
const sseAnswer = (body: BodyInit, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'request-id': 'req_stub_sse' } });
function inChunks(text: string, size: number): ReadableStream<Uint8Array> {
  const all = bytes(text);
  let at = 0;
  return new ReadableStream<Uint8Array>({ pull(controller) { if (at >= all.length) return controller.close(); controller.enqueue(all.slice(at, at += size)); } });
}

interface UpstreamCall { url: string; init: RequestInit; headers: Record<string, string>; body: any }
function harness(over: Partial<ModelProxyDeps> = {}) {
  const sent: UpstreamCall[] = [];
  const rows: AiCallRecord[] = [];
  const events: ModelProxyEvent[] = [];
  const h = {
    sent, rows, events,
    clock: NOW,
    state: new ModelProxyState(),
    upstream: (_call: UpstreamCall): Response | Promise<Response> => jsonAnswer(),
    deps: null as unknown as ModelProxyDeps,
    post(path: string, body: unknown, headers: Record<string, string> = { 'x-api-key': capability() }, init: RequestInit = {}) {
      return handleModelProxyRequest(new Request(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body), ...init }), h.deps);
    },
    messages(body: Record<string, unknown> = {}, headers?: Record<string, string>, init?: RequestInit) {
      return h.post('/v1/messages', { model: 'claude-opus-5-5', max_tokens: 4096, messages: [{ role: 'user', content: PROMPT }], ...body }, headers, init);
    },
  };
  h.deps = {
    capabilitySecret: SECRET, providerKey: PROVIDER_KEY, now: () => h.clock, state: h.state,
    fetch: async (url, init) => {
      const call = { url, init, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
      sent.push(call);
      return h.upstream(call);
    },
    record: async call => { rows.push(call); },
    log: event => { events.push(event); },
    ...over,
  };
  return h;
}
const errorOf = async (response: Response) => (await response.json()).error as { type: string; message: string };

describe('routes', () => {
  it('answers the health route without a capability, saying only ok', async () => {
    const h = harness();
    const response = await handleModelProxyRequest(new Request(`${BASE}/health`), h.deps);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect([...response.headers.keys()].sort()).toEqual(['cache-control', 'content-type']);
    expect(h.sent).toHaveLength(0);
    expect(h.rows).toHaveLength(0);
  });
  it('refuses everything outside the three routes, even with a valid capability, and never calls upstream', async () => {
    const h = harness();
    const key = { 'x-api-key': capability(), 'content-type': 'application/json' };
    const body = JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 10, messages: [] });
    const attempts: [string, string][] = [
      ['POST', 'https://model-proxy.test/v1/messages'], ['POST', 'https://model-proxy.test/'], ['POST', `${BASE}`], ['POST', `${BASE}/`],
      ['POST', `${BASE}/v1/messages/`], ['POST', `${BASE}/v1/messages/batches`], ['POST', `${BASE}/v1/complete`], ['POST', `${BASE}/v1/files`],
      ['POST', `${BASE}/v1/messages/count_tokens/x`], ['POST', `${BASE}//v1/messages`], ['POST', `${BASE}/V1/messages`], ['POST', `${BASE}/v1/messages%2Fbatches`],
      ['POST', `${BASE}/health`], ['POST', 'https://model-proxy.test/api/health'], ['POST', 'https://model-proxy.test/model/v1/../../admin'],
      ['GET', `${BASE}/v1/messages`], ['GET', `${BASE}/v1/models`], ['GET', `${BASE}/health/x`], ['GET', 'https://model-proxy.test/health'],
      ['PUT', `${BASE}/v1/messages`], ['DELETE', `${BASE}/v1/messages`], ['PATCH', `${BASE}/v1/messages/count_tokens`], ['HEAD', `${BASE}/health`], ['OPTIONS', `${BASE}/v1/messages`],
    ];
    for (const [method, url] of attempts) {
      const withBody = method !== 'GET' && method !== 'HEAD';
      const response = await handleModelProxyRequest(new Request(url, { method, headers: key, ...(withBody ? { body } : {}) }), h.deps);
      expect(response.status, `${method} ${url}`).toBe(404);
    }
    expect(h.sent).toHaveLength(0);
    expect(h.rows).toHaveLength(0);
  });
  it('ignores a query string and forwards to the fixed provider address', async () => {
    const h = harness();
    expect((await h.post('/v1/messages?beta=true&model=other', { model: 'x', max_tokens: 10, messages: [] })).status).toBe(200);
    h.upstream = () => new Response('{"input_tokens":42}', { status: 200, headers: { 'content-type': 'application/json' } });
    const counted = await h.post('/v1/messages/count_tokens?beta=true', { model: 'x', messages: [] });
    expect(await counted.json()).toEqual({ input_tokens: 42 });
    expect(h.sent.map(call => call.url)).toEqual(['https://api.anthropic.com/v1/messages', 'https://api.anthropic.com/v1/messages/count_tokens']);
  });
});

describe('authentication', () => {
  it('accepts the capability as x-api-key or as a bearer token', async () => {
    const h = harness();
    expect((await h.messages({}, { 'x-api-key': capability() })).status).toBe(200);
    expect((await h.messages({}, { authorization: `Bearer ${capability()}` })).status).toBe(200);
    expect((await h.messages({}, { authorization: 'Bearer not-a-capability', 'x-api-key': capability() })).status).toBe(200);
    expect(h.sent).toHaveLength(3);
  });
  it('refuses a missing, malformed, foreign, tampered or provider-style credential before calling upstream', async () => {
    const h = harness();
    const good = capability();
    const [prefix, payload, signature] = good.split('.');
    const forgedClaims = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), maxUsd: 9999 })).toString('base64url');
    const credentials: Record<string, string>[] = [
      {}, { 'x-api-key': '' }, { 'x-api-key': 'not-a-capability' }, { 'x-api-key': PROVIDER_KEY }, { authorization: `Basic ${good}` }, { authorization: good },
      { 'x-api-key': mintPublishCapability({ runId: RUN, bid: BUSINESS, entryId: 'e', model: 'claude-opus-5-5', maxUsd: 6, maxCalls: 200, exp: NOW / 1000 + 870 }, `${SECRET}-other`, NOW) },
      { 'x-api-key': `${prefix}.${forgedClaims}.${signature}` }, { 'x-api-key': `${prefix}.${payload}.${signature.slice(0, -2)}AA` }, { 'x-api-key': `rdrcap2.${payload}.${signature}` },
      { cookie: `capability=${good}` }, { 'x-capability': good },
    ];
    for (const headers of credentials) {
      const response = await h.messages({}, headers);
      expect(response.status, JSON.stringify(Object.keys(headers))).toBe(401);
      expect(await errorOf(response)).toEqual({ type: 'authentication_error', message: 'Unauthorized.' });
    }
    expect(h.sent).toHaveLength(0);
    expect(h.rows).toHaveLength(0);
  });
  it('stops accepting a capability at its expiry, mid-run', async () => {
    const h = harness();
    const key = { 'x-api-key': capability() };
    h.clock = NOW + 869_000;
    expect((await h.messages({}, key)).status).toBe(200);
    h.clock = NOW + 870_000;
    expect((await h.messages({}, key)).status).toBe(401);
    h.upstream = () => new Response('{"input_tokens":1}', { status: 200, headers: { 'content-type': 'application/json' } });
    expect((await h.post('/v1/messages/count_tokens', { messages: [] }, key)).status).toBe(401);
    expect(h.sent).toHaveLength(1);
  });
  it('refuses a capability whose lifetime is beyond the cap, and one from a different secret configuration', async () => {
    const h = harness();
    // Minted an hour ago for now + 870 s would be fine; minted now for an hour ahead cannot be minted at all, so present
    // one that is valid against a clock 30 minutes in the future.
    const future = capability({}, NOW + 30 * 60_000);
    expect((await h.messages({}, { 'x-api-key': future })).status).toBe(401);
    const short = harness({ capabilitySecret: 'too-short' });
    expect((await short.messages()).status).toBe(401);
    expect(h.sent.length + short.sent.length).toBe(0);
  });
});

describe('what is forwarded', () => {
  it('replaces the model with the capability model on both routes, whatever the caller asked for', async () => {
    const h = harness();
    await h.messages({ model: 'claude-fable-5-2' });
    await h.messages({ model: undefined });
    h.upstream = () => new Response('{"input_tokens":7}', { status: 200, headers: { 'content-type': 'application/json' } });
    await h.post('/v1/messages/count_tokens', { model: 'claude-fable-5-2', messages: [{ role: 'user', content: PROMPT }] });
    await h.messages({ model: 'claude-opus-5-5' }, { 'x-api-key': capability({ model: 'claude-sonnet-5-5', runId: OTHER_RUN }) });
    expect(h.sent.map(call => call.body.model)).toEqual(['claude-opus-5-5', 'claude-opus-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5']);
    expect(h.sent[2].body).toEqual({ model: 'claude-opus-5-5', messages: [{ role: 'user', content: PROMPT }] });
  });
  it('caps max_tokens and leaves a smaller request alone', async () => {
    const h = harness();
    for (const asked of [128_000, 32_001, 32_000, 4096, 1, 0]) await h.messages({ max_tokens: asked });
    expect(h.sent.map(call => call.body.max_tokens)).toEqual([32_000, 32_000, 32_000, 4096, 1, 0]);
    expect(MODEL_PROXY_LIMITS.maxTokens).toBe(32_000);
  });
  it('refuses a max_tokens that is missing or not a non-negative integer, without calling upstream', async () => {
    const h = harness();
    for (const asked of [undefined, null, '4096', 10.5, -1, 1e30, [4096], true]) {
      const response = await h.messages({ max_tokens: asked });
      expect(response.status, String(asked)).toBe(400);
      expect((await errorOf(response)).type).toBe('invalid_request_error');
    }
    expect(h.sent).toHaveLength(0);
    expect(h.state.usage(RUN)).toBeNull();
  });
  it('drops the caller credential and every other caller header, and signs with the provider key', async () => {
    const h = harness();
    const token = capability();
    await h.messages({}, { 'x-api-key': token, authorization: `Bearer ${token}`, cookie: 'session=abc', 'x-forwarded-for': '10.0.0.1', 'user-agent': 'claude-agent-sdk', 'anthropic-version': '2023-06-01', 'anthropic-beta': 'context-management-2025-06-27,prompt-caching-scope-2026-01-05' });
    const call = h.sent[0];
    expect(call.headers).toEqual({ 'content-type': 'application/json', 'x-api-key': PROVIDER_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'context-management-2025-06-27,prompt-caching-scope-2026-01-05' });
    expect(inspect(call.init, { depth: 6 })).not.toContain(token);
    expect(call.init.method).toBe('POST');
    expect(call.init.redirect).toBe('manual');
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });
  it('forwards a well-formed api version, defaults a missing or odd one, and drops an oversized or malformed beta header', async () => {
    const h = harness();
    await h.messages({}, { 'x-api-key': capability(), 'anthropic-version': '2026-10-21' });
    await h.messages({}, { 'x-api-key': capability() });
    await h.messages({}, { 'x-api-key': capability(), 'anthropic-version': 'latest', 'anthropic-beta': 'b'.repeat(2049) });
    expect(h.sent.map(call => [call.headers['anthropic-version'], 'anthropic-beta' in call.headers])).toEqual([['2026-10-21', false], ['2023-06-01', false], ['2023-06-01', false]]);
  });
  it('passes the rest of the request through unchanged', async () => {
    const h = harness();
    const request = {
      model: 'claude-opus-5-5', max_tokens: 8000, stream: true, system: [{ type: 'text', text: 'You integrate articles.', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }] }], thinking: { type: 'adaptive' }, output_config: { effort: 'high' }, metadata: { user_id: 'run' },
      tools: [{ name: 'Read', description: 'Read a file', input_schema: { type: 'object', properties: { file_path: { type: 'string' } } } }, { type: 'custom', name: 'Edit', input_schema: { type: 'object' }, eager_input_streaming: true }],
      tool_choice: { type: 'auto' }, context_management: { edits: [{ type: 'clear_thinking_20251015', keep: 'all' }] },
    };
    await h.post('/v1/messages', request);
    expect(h.sent[0].body).toEqual(request);
  });
  it('removes the fields that would change the price or the model: fast mode, inference region, fallbacks', async () => {
    const h = harness();
    await h.messages({ speed: 'fast', inference_geo: 'us', fallbacks: [{ model: 'claude-fable-5-2' }] });
    expect(h.sent[0].body).toEqual({ model: 'claude-opus-5-5', max_tokens: 4096, messages: [{ role: 'user', content: PROMPT }] });
  });
  it('refuses provider-executed features that would give the sandbox another way out', async () => {
    const h = harness();
    const cases: [Record<string, unknown>, string][] = [
      [{ mcp_servers: [{ type: 'url', url: 'https://evil.example/mcp', name: 'x' }] }, 'mcp_servers'],
      [{ container: { skills: [] } }, 'container'],
      [{ tools: [{ type: 'web_fetch_20260209', name: 'web_fetch' }] }, 'tools'],
      [{ tools: [{ type: 'web_search_20260209', name: 'web_search' }, { name: 'Read', input_schema: { type: 'object' } }] }, 'tools'],
      [{ tools: [{ type: 'code_execution_20260521', name: 'code_execution' }] }, 'tools'],
      [{ tools: [{ type: 'mcp_toolset', mcp_server_name: 'x' }] }, 'tools'],
      [{ tools: [{ name: 'Read', input_schema: { type: 'object' }, allowed_callers: ['code_execution_20260120'] }] }, 'tools'],
      [{ tools: 'all' }, 'tools'],
    ];
    for (const [extra, field] of cases) {
      const response = await h.messages(extra);
      expect(response.status, field).toBe(400);
      const error = await errorOf(response);
      expect(error.type).toBe('invalid_request_error');
      expect(error.message).toContain(field);
      expect(error.message).not.toContain('evil.example');
    }
    h.upstream = () => new Response('{"input_tokens":1}', { status: 200, headers: { 'content-type': 'application/json' } });
    expect((await h.post('/v1/messages/count_tokens', { messages: [], tools: [{ type: 'web_fetch_20260209', name: 'web_fetch' }] })).status).toBe(400);
    expect(h.sent).toHaveLength(0);
  });
  it('refuses a body that is too large, not JSON or not an object', async () => {
    const h = harness();
    const big = await h.post('/v1/messages', JSON.stringify({ model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'x'.repeat(MODEL_PROXY_LIMITS.requestBytes) }] }));
    expect(big.status).toBe(413);
    // Refused on the declared size alone, before any of the body is read.
    const declared = await h.post('/v1/messages', { model: 'x', max_tokens: 10, messages: [] }, { 'x-api-key': capability(), 'content-length': String(MODEL_PROXY_LIMITS.requestBytes + 1) });
    expect(declared.status).toBe(413);
    // The same refusal when the size is only discovered while reading.
    const stream = inChunks('x'.repeat(MODEL_PROXY_LIMITS.requestBytes + 10), 1_000_000);
    const streamed = await handleModelProxyRequest(new Request(`${BASE}/v1/messages`, { method: 'POST', headers: { 'x-api-key': capability() }, body: stream, duplex: 'half' } as RequestInit), h.deps);
    expect(streamed.status).toBe(413);
    for (const body of ['{not json', '[1,2]', '"text"', 'null', '']) expect((await h.post('/v1/messages', body)).status, body).toBe(400);
    expect(h.sent).toHaveLength(0);
  });
  it('refuses to run a model it cannot price, because the spend cap could not be enforced', async () => {
    const h = harness();
    const response = await h.messages({}, { 'x-api-key': capability({ model: 'claude-unlisted-9' }) });
    expect(response.status).toBe(400);
    expect(h.sent).toHaveLength(0);
    expect(h.events).toEqual([{ event: 'model-unpriced', runId: RUN, entryId: 'e_tl6rSYPs', businessId: BUSINESS, route: 'messages' }]);
  });
  it('answers 503 without calling upstream when the service has no provider key', async () => {
    const h = harness({ providerKey: '' });
    expect((await h.messages()).status).toBe(503);
    expect(h.sent).toHaveLength(0);
  });
});

describe('usage and recording', () => {
  it('returns a non-streamed answer unchanged and records its usage, cached tokens included, with the cost', async () => {
    const h = harness();
    h.clock = NOW;
    h.upstream = () => { h.clock = NOW + 1234; return jsonAnswer(); };
    const response = await h.messages();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('request-id')).toBe('req_stub_1');
    expect(response.headers.get('anthropic-organization-id')).toBeNull();
    expect(await response.text()).toBe(messageJson());
    await h.state.settled();
    expect(h.rows).toEqual([{
      businessId: BUSINESS, task: 'writing', purpose: 'github.integration.agent', model: 'claude-opus-5.5', provider: 'Anthropic', latencyMs: 1234,
      inputTokens: 1000, cacheReadTokens: 100_000, cacheWriteTokens: 20_000, cacheWrite1hTokens: 5_000, outputTokens: 500, costUsd: expect.closeTo(USAGE_COST, 10), ok: true, error: undefined,
    }]);
    expect(h.state.usage(RUN)).toEqual({ usd: expect.closeTo(0.174, 10), calls: 1 });
    expect(h.events).toEqual([]);
  });
  it('writes the ai_calls row through the real recorder: one input column holding uncached plus cached tokens', async () => {
    DB.inserted.length = 0;
    const h = harness({ record: recordAiCallNow });
    await (await h.messages()).text();
    await h.state.settled();
    expect(DB.inserted).toEqual([{ businessId: BUSINESS, task: 'writing', purpose: 'github.integration.agent', model: 'claude-opus-5.5', provider: 'Anthropic', latencyMs: 0, inputTokens: 126_000, outputTokens: 500, costUsd: expect.closeTo(0.174, 10), ok: true, error: null }]);
  });
  it('treats cache writes without a time-to-live breakdown as five-minute writes', async () => {
    const h = harness();
    h.upstream = () => jsonAnswer({ input_tokens: 10, cache_creation_input_tokens: 1000, output_tokens: 10 });
    await (await h.messages()).text();
    await h.state.settled();
    expect(h.rows[0]).toMatchObject({ inputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 1000, cacheWrite1hTokens: 0, outputTokens: 10, costUsd: expect.closeTo((10 * 4 + 10 * 20 + 1000 * 5) / 1e6, 12) });
  });
  it('streams an event stream through byte for byte while capturing usage split across chunks', async () => {
    const h = harness();
    // 7-byte chunks cut events, JSON and multi-byte characters at arbitrary points.
    h.upstream = () => sseAnswer(inChunks(SSE_BODY, 7));
    const response = await h.messages({ stream: true });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('request-id')).toBe('req_stub_sse');
    expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(SSE_BODY))).toBe(true);
    await h.state.settled();
    expect(h.rows).toEqual([expect.objectContaining({ businessId: BUSINESS, purpose: 'github.integration.agent', model: 'claude-opus-5.5', inputTokens: 12, cacheReadTokens: 90_000, cacheWriteTokens: 4_000, cacheWrite1hTokens: 0, outputTokens: 2_000, costUsd: expect.closeTo(SSE_COST, 10), ok: true })]);
    expect(h.state.usage(RUN)).toEqual({ usd: expect.closeTo(SSE_COST, 10), calls: 1 });
  });
  it('reads CRLF event streams and input counts restated on the final event', async () => {
    const h = harness();
    const end = { type: 'message_delta', delta: {}, usage: { input_tokens: 12, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 4_000, output_tokens: 700 } };
    h.upstream = () => sseAnswer(sse([['message_start', SSE_START], ['message_delta', end]]).replace(/\n/g, '\r\n'));
    await (await h.messages({ stream: true })).text();
    await h.state.settled();
    expect(h.rows[0]).toMatchObject({ inputTokens: 12, cacheReadTokens: 90_000, cacheWriteTokens: 4_000, outputTokens: 700, ok: true });
  });
  it('hands the caller the first events before the provider has finished, and records only at the end', async () => {
    const h = harness();
    const body = manualBody();
    h.upstream = () => sseAnswer(body.stream);
    const response = await h.messages({ stream: true });
    const reader = response.body!.getReader();
    body.push(sse([['message_start', SSE_START]]));
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('message_start');
    await h.state.settled();
    expect(h.rows).toHaveLength(0);
    body.push(sse([['message_delta', SSE_END]]));
    body.close();
    while (!(await reader.read()).done) { /* drain */ }
    await h.state.settled();
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]).toMatchObject({ ok: true, outputTokens: 2_000 });
  });
  it('records a stream that ends without its final usage as failed, with the tokens it did report', async () => {
    const h = harness();
    h.upstream = () => sseAnswer(sse([['message_start', SSE_START], ['content_block_delta', SSE_TEXT]]));
    await (await h.messages({ stream: true })).text();
    await h.state.settled();
    expect(h.rows[0]).toMatchObject({ ok: false, error: 'stream ended without final usage', inputTokens: 12, cacheReadTokens: 90_000, outputTokens: 3 });
    expect(h.rows[0].costUsd).toBeCloseTo((12 * 4 + 3 * 20 + 90_000 * 0.20 + 4_000 * 5) / 1e6, 10);
    expect(h.events).toEqual([{ event: 'call-failed', runId: RUN, entryId: 'e_tl6rSYPs', businessId: BUSINESS, route: 'messages', reason: 'incomplete', status: 200 }]);
  });
  it('names a provider error sent inside the stream, by its type only', async () => {
    const h = harness();
    const text = sse([['message_start', SSE_START], ['error', { type: 'error', error: { type: 'overloaded_error', message: `Overloaded ${ANSWER}` } }]]);
    h.upstream = () => sseAnswer(text);
    expect(await (await h.messages({ stream: true })).text()).toBe(text);
    await h.state.settled();
    expect(h.rows[0]).toMatchObject({ ok: false, error: 'stream error: overloaded_error' });
  });
  it('survives malformed stream events and still passes them on', async () => {
    const h = harness();
    const text = `data: {broken\n\n: comment\n\ndata: [DONE]\n\ndata: 17\n\n${sse([['message_start', SSE_START], ['message_delta', SSE_END]])}`;
    h.upstream = () => sseAnswer(text);
    expect(await (await h.messages({ stream: true })).text()).toBe(text);
    await h.state.settled();
    expect(h.rows[0]).toMatchObject({ ok: true, outputTokens: 2_000 });
  });
  it('records a successful answer that reports no usage, with no tokens and no cost', async () => {
    const h = harness();
    h.upstream = () => new Response('{"id":"msg_x","content":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
    expect((await h.messages()).status).toBe(200);
    await h.state.settled();
    expect(h.rows).toEqual([expect.objectContaining({ ok: true, error: 'usage not reported', costUsd: null })]);
    expect(h.rows[0].inputTokens).toBeUndefined();
  });
  it('does not record token counts: they are not billed', async () => {
    const h = harness();
    h.upstream = () => new Response('{"input_tokens":4242}', { status: 200, headers: { 'content-type': 'application/json' } });
    const response = await h.post('/v1/messages/count_tokens', { messages: [{ role: 'user', content: PROMPT }] });
    expect(await response.json()).toEqual({ input_tokens: 4242 });
    await h.state.settled();
    expect(h.rows).toHaveLength(0);
    expect(h.state.usage(RUN)).toEqual({ usd: 0, calls: 0 });
  });
  it('answers in full when the recorder fails, and says the usage went unrecorded', async () => {
    for (const record of [async () => { throw new Error('connection terminated'); }, () => { throw new Error('pool is closed'); }] as ModelProxyDeps['record'][]) {
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        const h = harness({ record });
        const plain = await h.messages();
        expect(plain.status).toBe(200);
        expect(await plain.text()).toBe(messageJson());
        h.upstream = () => sseAnswer(inChunks(SSE_BODY, 64));
        const streamed = await h.messages({ stream: true });
        expect(await streamed.text()).toBe(SSE_BODY);
        await h.state.settled();
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(unhandled).not.toHaveBeenCalled();
        expect(h.events.map(event => event.event)).toEqual(['usage-unrecorded', 'usage-unrecorded']);
        expect(h.events[0]).toMatchObject({ runId: RUN, entryId: 'e_tl6rSYPs', businessId: BUSINESS, route: 'messages', error: expect.any(Error) });
        // The spend still counts against the run.
        expect(h.state.usage(RUN)).toEqual({ usd: expect.closeTo(USAGE_COST + SSE_COST, 10), calls: 2 });
      } finally { process.off('unhandledRejection', unhandled); }
    }
  });
  it('a throwing log observer changes nothing', async () => {
    const h = harness({ log: () => { throw new Error('logger down'); }, record: async () => { throw new Error('db down'); } });
    expect((await h.messages()).status).toBe(200);
    await h.state.settled();
  });
});

describe('run budget', () => {
  const exhausted = async (response: Response) => {
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toEqual({ type: 'invalid_request_error', message: BUDGET_EXHAUSTED_MESSAGE });
  };
  it('stops a run once its spend reaches the cap', async () => {
    const h = harness();
    const key = { 'x-api-key': capability({ maxUsd: 0.2 }) };
    expect((await h.messages({}, key)).status).toBe(200); // 0.174 spent
    expect((await h.messages({}, key)).status).toBe(200); // 0.348 spent: over the cap only after the fact
    await exhausted(await h.messages({}, key));
    await exhausted(await h.messages({ stream: true }, key));
    expect(h.sent).toHaveLength(2);
    await h.state.settled();
    expect(h.rows).toHaveLength(2);
    expect(h.events).toEqual([expect.objectContaining({ event: 'budget-exhausted', reason: 'usd', runId: RUN, calls: 2 }), expect.objectContaining({ event: 'budget-exhausted', reason: 'usd' })]);
  });
  it('counts streamed spend before the stream closes, so the very next request is refused', async () => {
    const h = harness();
    const key = { 'x-api-key': capability({ maxUsd: 0.05 }) };
    h.upstream = () => sseAnswer(inChunks(SSE_BODY, 50));
    await (await h.messages({ stream: true }, key)).text(); // 0.078 spent
    await exhausted(await h.messages({ stream: true }, key));
    expect(h.sent).toHaveLength(1);
  });
  it('stops a run once its call count reaches the cap, whatever the calls cost', async () => {
    const h = harness();
    const key = { 'x-api-key': capability({ maxCalls: 2 }) };
    h.upstream = () => jsonAnswer({ input_tokens: 0, output_tokens: 0 });
    expect((await h.messages({}, key)).status).toBe(200);
    expect((await h.messages({}, key)).status).toBe(200);
    await exhausted(await h.messages({}, key));
    expect(h.sent).toHaveLength(2);
    expect(h.events).toEqual([expect.objectContaining({ event: 'budget-exhausted', reason: 'calls', calls: 2, usd: 0 })]);
  });
  it('counts a call the provider failed, so a failing loop cannot run forever', async () => {
    const h = harness();
    const key = { 'x-api-key': capability({ maxCalls: 2 }) };
    h.upstream = () => new Response('{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', { status: 529, headers: { 'content-type': 'application/json' } });
    expect((await h.messages({}, key)).status).toBe(529);
    expect((await h.messages({}, key)).status).toBe(529);
    await exhausted(await h.messages({}, key));
    expect(h.sent).toHaveLength(2);
  });
  it('admits at most the cap when requests arrive together', async () => {
    const h = harness();
    const key = { 'x-api-key': capability({ maxCalls: 3 }) };
    const responses = await Promise.all(Array.from({ length: 8 }, () => h.messages({}, key)));
    expect(responses.map(response => response.status).sort()).toEqual([200, 200, 200, 400, 400, 400, 400, 400]);
    expect(h.sent).toHaveLength(3);
  });
  it('keeps each run to its own budget, and a re-minted capability for the same run to the same one', async () => {
    const h = harness();
    const first = { 'x-api-key': capability({ maxCalls: 1 }) };
    expect((await h.messages({}, first)).status).toBe(200);
    await exhausted(await h.messages({}, first));
    await exhausted(await h.messages({}, { 'x-api-key': capability({ maxCalls: 1, entryId: 'another-entry' }) }));
    expect((await h.messages({}, { 'x-api-key': capability({ maxCalls: 1, runId: OTHER_RUN }) })).status).toBe(200);
    expect(h.state.usage(OTHER_RUN)).toMatchObject({ calls: 1 });
  });
  it('does not charge the budget for a request it refused itself', async () => {
    const h = harness();
    const key = { 'x-api-key': capability({ maxCalls: 1 }) };
    await h.messages({ max_tokens: 'many' }, key);
    await h.messages({ mcp_servers: [] }, key);
    await h.post('/v1/messages', '{broken', key);
    expect(h.state.usage(RUN)).toBeNull();
    expect((await h.messages({}, key)).status).toBe(200);
  });
  it('lets token counts through without spending model calls, until the run is exhausted or floods them', async () => {
    const h = harness();
    const key = { 'x-api-key': capability({ maxCalls: 2 }) };
    const countTokens = () => h.post('/v1/messages/count_tokens', { messages: [] }, key);
    h.upstream = call => call.url.endsWith('count_tokens') ? new Response('{"input_tokens":1}', { status: 200, headers: { 'content-type': 'application/json' } }) : jsonAnswer({ input_tokens: 0, output_tokens: 0 });
    for (let i = 0; i < 2 * MODEL_PROXY_LIMITS.countTokensPerCall; i++) expect((await countTokens()).status).toBe(200);
    await exhausted(await countTokens());
    expect(h.state.usage(RUN)).toEqual({ usd: 0, calls: 0 });
    expect((await h.messages({}, key)).status).toBe(200);
    expect((await h.messages({}, key)).status).toBe(200);
    await exhausted(await h.messages({}, key));
    const fresh = harness();
    fresh.upstream = h.upstream;
    await fresh.messages({}, key);
    await fresh.messages({}, key);
    await exhausted(await fresh.post('/v1/messages/count_tokens', { messages: [] }, key));
  });
  it('forgets a run when the process restarts: the counters live in memory only', async () => {
    const h = harness();
    const key = { 'x-api-key': capability({ maxCalls: 1 }) };
    expect((await h.messages({}, key)).status).toBe(200);
    await exhausted(await h.messages({}, key));
    const restarted = harness();
    expect(restarted.state.usage(RUN)).toBeNull();
    expect((await restarted.messages({}, key)).status).toBe(200);
  });
  it('drops the counters of runs whose capability has expired', async () => {
    const h = harness();
    await h.messages({}, { 'x-api-key': capability() });
    expect(h.state.usage(RUN)).not.toBeNull();
    h.clock = NOW + 30 * 60_000;
    await h.messages({}, { 'x-api-key': capability({ runId: OTHER_RUN }, h.clock) });
    expect(h.state.usage(RUN)).toBeNull();
    expect(h.state.usage(OTHER_RUN)).toMatchObject({ calls: 1 });
  });
});

describe('upstream failures', () => {
  it('passes a provider error through with its status, body and retry hints, and records the failed call', async () => {
    const h = harness();
    const body = '{"type":"error","error":{"type":"rate_limit_error","message":"Slow down"},"request_id":"req_err"}';
    h.upstream = () => new Response(body, { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '17', 'request-id': 'req_err', 'x-should-retry': 'true', 'set-cookie': 'a=b', 'anthropic-organization-id': 'org-internal' } });
    const response = await h.messages();
    expect(response.status).toBe(429);
    expect(await response.text()).toBe(body);
    expect(Object.fromEntries(response.headers)).toEqual({ 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': '17', 'request-id': 'req_err', 'x-should-retry': 'true' });
    await h.state.settled();
    expect(h.rows).toEqual([expect.objectContaining({ ok: false, error: 'HTTP 429', costUsd: null, purpose: 'github.integration.agent', businessId: BUSINESS })]);
    expect(h.events).toEqual([{ event: 'call-failed', runId: RUN, entryId: 'e_tl6rSYPs', businessId: BUSINESS, route: 'messages', reason: 'status', status: 429 }]);
  });
  it.each([400, 401, 403, 404, 413, 500, 502, 503, 529])('keeps status %i', async status => {
    const h = harness();
    h.upstream = () => new Response(`{"type":"error","error":{"type":"api_error","message":"upstream ${status}"}}`, { status, headers: { 'content-type': 'application/json' } });
    const response = await h.messages({ stream: true });
    expect(response.status).toBe(status);
    expect((await errorOf(response)).message).toBe(`upstream ${status}`);
  });
  it('never returns the provider key, even when the provider or the transport echoes it', async () => {
    const h = harness();
    h.upstream = () => new Response(`{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key ${PROVIDER_KEY}"}}`, { status: 401, headers: { 'content-type': 'application/json', 'request-id': PROVIDER_KEY } });
    const echoed = await h.messages();
    expect(echoed.status).toBe(401);
    expect(await echoed.text()).toBe('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key [redacted]"}}');
    expect(Object.fromEntries(echoed.headers)).toEqual({ 'content-type': 'application/json', 'cache-control': 'no-store' });
    h.upstream = () => { throw new Error(`connect ECONNREFUSED with header x-api-key: ${PROVIDER_KEY}`); };
    const unreachable = await h.messages();
    expect(unreachable.status).toBe(502);
    expect(await errorOf(unreachable)).toEqual({ type: 'api_error', message: 'Model provider unavailable.' });
    await h.state.settled();
    expect(h.rows.map(row => row.error)).toEqual(['HTTP 401', 'upstream unreachable']);
    expect(inspect([h.rows, h.events], { depth: 8 })).not.toContain(PROVIDER_KEY);
  });
  it('replaces an empty or oversized provider error body with a generic one, keeping the status', async () => {
    const h = harness();
    h.upstream = () => new Response(null, { status: 503 });
    const empty = await h.messages();
    expect(empty.status).toBe(503);
    expect((await errorOf(empty)).type).toBe('api_error');
    h.upstream = () => new Response('x'.repeat(MODEL_PROXY_LIMITS.errorBodyBytes + 1), { status: 500 });
    const huge = await h.messages();
    expect(huge.status).toBe(500);
    expect((await huge.text()).length).toBeLessThan(200);
  });
  it('refuses a redirect: it is not followed and its target is not passed on', async () => {
    for (const status of [301, 302, 307, 308]) {
      const h = harness();
      h.upstream = () => new Response(null, { status, headers: { location: 'https://evil.example/collect' } });
      const response = await h.messages();
      expect(response.status).toBe(502);
      expect(response.headers.get('location')).toBeNull();
      expect(await response.text()).not.toContain('evil.example');
      expect(h.sent).toHaveLength(1);
      expect(h.sent[0].init.redirect).toBe('manual');
      await h.state.settled();
      expect(h.rows).toEqual([expect.objectContaining({ ok: false, error: 'upstream redirect refused' })]);
      expect(h.events).toEqual([expect.objectContaining({ event: 'call-failed', reason: 'redirect', status })]);
    }
  });
  it('gives up on a provider that never answers, and closes the connection', async () => {
    const h = harness({ timeouts: { headersMs: 25 } });
    let signal!: AbortSignal;
    h.upstream = call => new Promise<Response>((_, reject) => { signal = call.init.signal!; signal.addEventListener('abort', () => reject(new Error('aborted'))); });
    const response = await h.messages();
    expect(response.status).toBe(504);
    expect(signal.aborted).toBe(true);
    await h.state.settled();
    expect(h.rows).toEqual([expect.objectContaining({ ok: false, error: 'upstream headers timeout' })]);
    expect(h.events).toEqual([expect.objectContaining({ event: 'call-failed', reason: 'timeout' })]);
  });
  it('ends a stream that stops making progress, closes the connection and records what it had counted', async () => {
    const h = harness({ timeouts: { idleMs: 30 } });
    const body = manualBody();
    let signal!: AbortSignal;
    h.upstream = call => { signal = call.init.signal!; return sseAnswer(body.stream); };
    const response = await h.messages({ stream: true });
    body.push(sse([['message_start', SSE_START]]));
    await expect(response.text()).rejects.toThrow();
    expect(signal.aborted).toBe(true);
    expect(body.state.cancelled).toBe(true);
    await h.state.settled();
    expect(h.rows).toEqual([expect.objectContaining({ ok: false, error: 'upstream idle timeout', inputTokens: 12, cacheReadTokens: 90_000 })]);
    expect(h.state.usage(RUN)!.usd).toBeGreaterThan(0);
  });
  it('ends a call that outlives the total limit even while it is still producing', async () => {
    const h = harness({ timeouts: { totalMs: 60, idleMs: 1000 } });
    const body = manualBody();
    h.upstream = () => sseAnswer(body.stream);
    const response = await h.messages({ stream: true });
    const feeder = setInterval(() => { try { body.push(sse([['ping', { type: 'ping' }]])); } catch { /* closed */ } }, 10);
    try { await expect(response.text()).rejects.toThrow(); } finally { clearInterval(feeder); }
    await h.state.settled();
    expect(h.rows).toEqual([expect.objectContaining({ ok: false, error: 'upstream total timeout' })]);
  });
  it('ends and records a call that passes the total limit while the caller is not reading', async () => {
    const h = harness({ timeouts: { totalMs: 40 } });
    const body = manualBody();
    let signal!: AbortSignal;
    h.upstream = call => { signal = call.init.signal!; return sseAnswer(body.stream); };
    const response = await h.messages({ stream: true });
    body.push(sse([['message_start', SSE_START]]));
    body.push(sse([['ping', { type: 'ping' }]]));
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
    await h.state.settled();
    expect(h.rows).toEqual([expect.objectContaining({ ok: false, error: 'upstream total timeout' })]);
    expect(body.state.cancelled).toBe(true);
    await expect(response.text()).rejects.toThrow();
  });
  it('a slow but progressing stream is not cut by the idle limit', async () => {
    const h = harness({ timeouts: { idleMs: 400 } });
    const body = manualBody();
    h.upstream = () => sseAnswer(body.stream);
    const response = await h.messages({ stream: true });
    const parts = [sse([['message_start', SSE_START]]), sse([['content_block_delta', SSE_TEXT]]), sse([['message_delta', SSE_END]])];
    const text = response.text();
    // Three gaps of 150 ms: 450 ms in all, longer than the idle limit, yet never 400 ms without a chunk.
    for (const part of parts) { await new Promise(resolve => setTimeout(resolve, 150)); body.push(part); }
    body.close();
    expect(await text).toBe(parts.join(''));
    await h.state.settled();
    expect(h.rows[0]).toMatchObject({ ok: true });
  });
  it('reports a stream the connection dropped mid-way as failed', async () => {
    const h = harness();
    const body = manualBody();
    h.upstream = () => sseAnswer(body.stream);
    const response = await h.messages({ stream: true });
    body.push(sse([['message_start', SSE_START]]));
    const text = response.text();
    body.fail();
    await expect(text).rejects.toThrow();
    await h.state.settled();
    expect(h.rows).toEqual([expect.objectContaining({ ok: false, error: 'upstream stream failed', inputTokens: 12 })]);
  });
  it('stops the provider call when the caller walks away from a stream', async () => {
    const h = harness();
    const body = manualBody();
    let signal!: AbortSignal;
    h.upstream = call => { signal = call.init.signal!; return sseAnswer(body.stream); };
    const response = await h.messages({ stream: true });
    body.push(sse([['message_start', SSE_START]]));
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(signal.aborted).toBe(true);
    expect(body.state.cancelled).toBe(true);
    await h.state.settled();
    expect(h.rows).toEqual([expect.objectContaining({ ok: false, error: 'client disconnected', inputTokens: 12 })]);
    expect(h.events).toEqual([expect.objectContaining({ event: 'call-failed', reason: 'client' })]);
  });
  it('stops the provider call when the caller disconnects before any answer', async () => {
    const h = harness();
    const client = new AbortController();
    let signal!: AbortSignal;
    h.upstream = call => new Promise<Response>((_, reject) => { signal = call.init.signal!; signal.addEventListener('abort', () => reject(new Error('aborted'))); client.abort(); });
    await h.messages({}, undefined, { signal: client.signal }).catch(() => undefined);
    expect(signal.aborted).toBe(true);
    await h.state.settled();
    expect(h.rows).toEqual([expect.objectContaining({ ok: false, error: 'client disconnected' })]);
  });
  it('answers 502 for a non-streamed answer that breaks off or is absurdly large', async () => {
    const h = harness();
    const body = manualBody();
    h.upstream = () => new Response(body.stream, { status: 200, headers: { 'content-type': 'application/json' } });
    const pending = h.messages();
    body.push('{"id":"msg');
    body.fail();
    expect((await pending).status).toBe(502);
    h.upstream = () => new Response(inChunks('x'.repeat(MODEL_PROXY_LIMITS.responseBytes + 5), 4_000_000), { status: 200, headers: { 'content-type': 'application/json' } });
    expect((await h.messages()).status).toBe(502);
    await h.state.settled();
    expect(h.rows.map(row => [row.ok, row.error])).toEqual([[false, 'upstream response was incomplete'], [false, 'upstream response too large']]);
  });
});

describe('nothing sensitive is logged, recorded or returned', () => {
  const spies: ReturnType<typeof vi.spyOn>[] = [];
  beforeEach(() => { for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) spies.push(vi.spyOn(console, method).mockImplementation(() => undefined)); });
  afterEach(() => { for (const spy of spies.splice(0)) spy.mockRestore(); });

  it('across success, refusal, budget, error, redirect, timeout and recorder failure', async () => {
    const tokens: string[] = [];
    const key = (over: Parameters<typeof capability>[0] = {}) => { const token = capability(over); tokens.push(token); return { 'x-api-key': token }; };
    const seen: unknown[] = [];
    const returned: string[] = [];
    const keep = async (response: Response) => { returned.push(inspect(Object.fromEntries(response.headers)), await response.text().catch(() => '')); };
    const run = async (h: ReturnType<typeof harness>, act: () => Promise<Response>) => { await keep(await act()); await h.state.settled(); seen.push(h.rows, h.events); };

    const ok = harness();
    await run(ok, () => ok.messages({}, key()));
    ok.upstream = () => sseAnswer(inChunks(SSE_BODY, 33));
    await run(ok, () => ok.messages({ stream: true }, key()));
    await run(ok, () => ok.messages({ max_tokens: 'x' }, key()));
    await run(ok, () => ok.messages({ mcp_servers: [{ url: 'https://evil.example' }] }, key()));
    await run(ok, () => ok.messages({}, { 'x-api-key': 'rdrcap1.bogus.bogus' }));
    await run(ok, () => ok.messages({}, key({ model: 'claude-unlisted-9' })));
    const capped = key({ maxCalls: 1, runId: OTHER_RUN });
    ok.upstream = () => jsonAnswer();
    await run(ok, () => ok.messages({}, capped));
    await run(ok, () => ok.messages({}, capped));
    ok.upstream = () => new Response(`{"type":"error","error":{"type":"authentication_error","message":"bad key ${PROVIDER_KEY} for ${PROMPT}"}}`, { status: 401 });
    await run(ok, () => ok.messages({}, key()));
    ok.upstream = () => new Response(null, { status: 302, headers: { location: `https://evil.example/?k=${PROVIDER_KEY}` } });
    await run(ok, () => ok.messages({}, key()));
    ok.upstream = () => { throw new Error(`fetch failed ${PROVIDER_KEY} ${tokens[0]}`); };
    await run(ok, () => ok.messages({}, key()));
    const slow = harness({ timeouts: { headersMs: 15 } });
    slow.upstream = call => new Promise<Response>((_, reject) => call.init.signal!.addEventListener('abort', () => reject(new Error(`aborted ${PROVIDER_KEY}`))));
    await run(slow, () => slow.messages({}, key()));
    const unrecorded = harness({ record: async () => { throw new Error('insert failed'); } });
    await run(unrecorded, () => unrecorded.messages({}, key()));

    const logged = inspect([seen, spies.map(spy => spy.mock.calls)], { depth: 12, maxArrayLength: null, maxStringLength: null, breakLength: Infinity });
    for (const secret of [SECRET, PROVIDER_KEY, ...tokens, ...tokens.map(token => token.split('.')[2]), PROMPT, ANSWER, 'evil.example']) expect(logged).not.toContain(secret);
    // The handler has no logger of its own: everything it reports goes through the injected observer.
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    const sentBack = returned.join('\n');
    for (const secret of [SECRET, PROVIDER_KEY, ...tokens]) expect(sentBack).not.toContain(secret);
    // Sanity: the events and rows were really collected, so the absence above means something.
    expect(logged).toContain('budget-exhausted');
    expect(logged).toContain('usage-unrecorded');
    expect(logged).toContain('github.integration.agent');
  });
});

describe('service variables', () => {
  const complete = { RADAR_PUBLISH_CAPABILITY_SECRET: SECRET, ANTHROPIC_API_KEY: PROVIDER_KEY, DATABASE_URL: 'postgres://user:DB-PASSWORD@db.internal:5432/radar', PORT: '8080' };
  it('accepts a complete set, taking the secret exactly as set', () => {
    expect(readModelProxyEnvironment(complete)).toEqual({ ok: true, capabilitySecret: SECRET, providerKey: PROVIDER_KEY, port: 8080, unexpected: [] });
    const padded = readModelProxyEnvironment({ ...complete, RADAR_PUBLISH_CAPABILITY_SECRET: ` ${SECRET} `, ANTHROPIC_API_KEY: ` ${PROVIDER_KEY}\n` });
    expect(padded).toMatchObject({ ok: true, capabilitySecret: ` ${SECRET} `, providerKey: PROVIDER_KEY });
  });
  it('names every missing or unusable variable, and only names', () => {
    expect(readModelProxyEnvironment({})).toEqual({ ok: false, missing: ['RADAR_PUBLISH_CAPABILITY_SECRET', 'ANTHROPIC_API_KEY', 'DATABASE_URL', 'PORT'] });
    const bad = { RADAR_PUBLISH_CAPABILITY_SECRET: 'short-secret-VALUE', ANTHROPIC_API_KEY: '  ', DATABASE_URL: '', PORT: '80a80' };
    const result = readModelProxyEnvironment(bad);
    expect(result).toEqual({ ok: false, missing: ['RADAR_PUBLISH_CAPABILITY_SECRET', 'ANTHROPIC_API_KEY', 'DATABASE_URL', 'PORT'] });
    expect(JSON.stringify(result)).not.toContain('short-secret-VALUE');
    expect(readModelProxyEnvironment({ ...complete, ANTHROPIC_API_KEY: undefined })).toEqual({ ok: false, missing: ['ANTHROPIC_API_KEY'] });
    for (const PORT of ['0', '65536', '-1', '3000.5', ' ', '999999']) expect(readModelProxyEnvironment({ ...complete, PORT })).toEqual({ ok: false, missing: ['PORT'] });
    expect(readModelProxyEnvironment({ ...complete, RADAR_PUBLISH_CAPABILITY_SECRET: 'x'.repeat(31) })).toEqual({ ok: false, missing: ['RADAR_PUBLISH_CAPABILITY_SECRET'] });
    expect(readModelProxyEnvironment({ ...complete, RADAR_PUBLISH_CAPABILITY_SECRET: 'x'.repeat(32) })).toMatchObject({ ok: true });
  });
  it('points out, by name, secrets of other services that the proxy should not hold', () => {
    expect(readModelProxyEnvironment({ ...complete, RADAR_SECRET_KEY: 'k', DAYTONA_API_KEY: 'd', GITHUB_CLIENT_SECRET: '' })).toMatchObject({ ok: true, unexpected: ['RADAR_SECRET_KEY', 'DAYTONA_API_KEY'] });
  });
});

// The node:http adapter, over a loopback socket: what a real client sees.
describe('over node:http', () => {
  let server: Server | undefined;
  afterEach(async () => { const closing = server; server = undefined; if (closing) { closing.closeAllConnections(); await new Promise<void>(resolve => closing.close(() => resolve())); } });
  async function listen(h: ReturnType<typeof harness>): Promise<string> {
    const started = createServer((req, res) => { void serveModelProxyRequest(req, res, h.deps); });
    server = started;
    await new Promise<void>(resolve => started.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(started.address() as AddressInfo).port}`;
  }
  const send = (origin: string, path: string, body: unknown, init: RequestInit = {}) => fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': capability() }, body: typeof body === 'string' ? body : JSON.stringify(body), ...init });
  const request = { model: 'x', max_tokens: 100, messages: [{ role: 'user', content: PROMPT }] };

  it('serves health, refuses stray paths and methods, and authenticates', async () => {
    const h = harness();
    const origin = await listen(h);
    const health = await fetch(`${origin}/model/health`);
    expect([health.status, await health.text()]).toEqual([200, 'ok']);
    for (const [method, path] of [['GET', '/'], ['GET', '/model/v1/messages'], ['POST', '/model/health'], ['POST', '/api/health'], ['OPTIONS', '/model/v1/messages'], ['DELETE', '/model/v1/messages']]) {
      expect((await fetch(origin + path, { method })).status, `${method} ${path}`).toBe(404);
    }
    expect((await send(origin, '/model/v1/messages', request, { headers: { 'x-api-key': 'nope' } })).status).toBe(401);
    expect(h.sent).toHaveLength(0);
    const answered = await send(origin, '/model/v1/messages?beta=true', request);
    expect([answered.status, await answered.text()]).toEqual([200, messageJson()]);
    expect(h.sent[0].body).toEqual({ ...request, model: 'claude-opus-5-5' });
    expect(h.sent[0].headers['x-api-key']).toBe(PROVIDER_KEY);
  });
  it('delivers a stream as it arrives and the complete bytes at the end', async () => {
    const h = harness();
    const body = manualBody();
    h.upstream = () => sseAnswer(body.stream);
    const origin = await listen(h);
    const response = await send(origin, '/model/v1/messages', { ...request, stream: true });
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    const reader = response.body!.getReader();
    const first = sse([['message_start', SSE_START]]);
    body.push(first);
    let got = '';
    const decoder = new TextDecoder();
    while (got.length < first.length) got += decoder.decode((await reader.read()).value, { stream: true });
    expect(got).toBe(first);
    const rest = sse([['content_block_delta', SSE_TEXT], ['message_delta', SSE_END]]);
    body.push(rest);
    body.close();
    for (let step = await reader.read(); !step.done; step = await reader.read()) got += decoder.decode(step.value, { stream: true });
    expect(got).toBe(first + rest);
    await h.state.settled();
    expect(h.rows).toEqual([expect.objectContaining({ ok: true, outputTokens: 2_000, costUsd: expect.closeTo(SSE_COST, 10) })]);
  });
  it('answers an oversized upload with 413 instead of resetting the connection', async () => {
    const h = harness();
    const origin = await listen(h);
    const response = await send(origin, '/model/v1/messages', JSON.stringify({ ...request, messages: [{ role: 'user', content: 'x'.repeat(MODEL_PROXY_LIMITS.requestBytes + 1000) }] }));
    expect(response.status).toBe(413);
    expect((await errorOf(response)).type).toBe('request_too_large');
    // The connection is still usable afterwards.
    expect((await fetch(`${origin}/model/health`)).status).toBe(200);
    expect(h.sent).toHaveLength(0);
  });
  it('stops the provider call when the client disconnects mid-stream', async () => {
    const h = harness();
    const body = manualBody();
    let signal!: AbortSignal;
    h.upstream = call => { signal = call.init.signal!; return sseAnswer(body.stream); };
    const origin = await listen(h);
    const client = new AbortController();
    const response = await send(origin, '/model/v1/messages', { ...request, stream: true }, { signal: client.signal });
    body.push(sse([['message_start', SSE_START]]));
    await response.body!.getReader().read();
    client.abort();
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
    await vi.waitFor(async () => { await h.state.settled(); expect(h.rows).toEqual([expect.objectContaining({ ok: false, error: 'client disconnected', inputTokens: 12 })]); });
  });
  it('sends the status of a stream before its first event, and cuts the connection when the provider stream breaks', async () => {
    const h = harness();
    const body = manualBody();
    h.upstream = () => sseAnswer(body.stream);
    const origin = await listen(h);
    // Resolves on the headers alone: nothing has been pushed yet.
    const response = await send(origin, '/model/v1/messages', { ...request, stream: true });
    expect(response.status).toBe(200);
    body.push(sse([['message_start', SSE_START]]));
    const reader = response.body!.getReader();
    await reader.read();
    body.fail();
    await expect((async () => { while (!(await reader.read()).done) { /* drain */ } })()).rejects.toThrow();
    await h.state.settled();
    expect(h.rows).toEqual([expect.objectContaining({ ok: false, error: 'upstream stream failed', inputTokens: 12 })]);
  });
});
