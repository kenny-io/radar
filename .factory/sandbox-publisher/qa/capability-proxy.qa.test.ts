// QA-1: the per-run capability and the model proxy handler (SBX-2, SBX-9). No network: the upstream is a stub.
// Every key, secret and token below is a placeholder made for this file.
import { createHmac, randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mintPublishCapability, verifyPublishCapability } from '@/server/services/publishing/sandbox/capability';
import { BUDGET_EXHAUSTED_MESSAGE, handleModelProxyRequest, MODEL_PROXY_UPSTREAM, ModelProxyState, serveModelProxyRequest, type ModelProxyDeps, type ModelProxyEvent } from '@/server/services/publishing/sandbox/modelProxy';

const SECRET = 'qa-capability-secret-' + 'x7'.repeat(12);
const OTHER_SECRET = 'qa-other-secret-' + 'y3'.repeat(14);
const PROVIDER_KEY = 'sk-ant-qa-placeholder-' + 'p9'.repeat(14);
const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);
const MODEL = 'claude-opus-5-5';
const claims = (over: Record<string, unknown> = {}) => ({ runId: randomUUID(), bid: 'b_qa', entryId: 'e_qa', model: MODEL, maxUsd: 6, maxCalls: 200, exp: Math.floor(NOW / 1000) + 600, ...over });
const mint = (over: Record<string, unknown> = {}, secret = SECRET, now = NOW) => mintPublishCapability(claims(over) as any, secret, now);
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const signed = (payload: string, secret = SECRET) => `rdrcap1.${payload}.${createHmac('sha256', secret).update(`rdrcap1.${payload}`).digest('base64url')}`;
const decode = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

describe('capability (SBX-2)', () => {
  it('verifies what it minted and returns exactly the claim set', () => {
    const token = mint({ maxUsd: 2.5, maxCalls: 7 });
    const verified = verifyPublishCapability(token, SECRET, NOW + 1000)!;
    expect(Object.keys(verified).sort()).toEqual(['aud', 'bid', 'entryId', 'exp', 'iat', 'maxCalls', 'maxUsd', 'model', 'runId', 'v']);
    expect(verified).toMatchObject({ v: 1, aud: 'radar-publish-model', model: MODEL, maxUsd: 2.5, maxCalls: 7 });
  });

  it('refuses a token whose claims were edited (a larger budget, another model, a later expiry) under the original signature', () => {
    const token = mint();
    const [prefix, payload, signature] = token.split('.');
    for (const edit of [{ maxUsd: 6000 }, { maxCalls: 1e6 }, { model: 'claude-fable-5-2' }, { exp: Math.floor(NOW / 1000) + 1100 }, { bid: 'someone-else' }]) {
      const forged = `${prefix}.${b64({ ...decode(token), ...edit })}.${signature}`;
      expect(verifyPublishCapability(forged, SECRET, NOW)).toBeNull();
    }
    // One flipped character anywhere in the payload or the signature.
    for (const at of [10, 30, payload.length - 2]) expect(verifyPublishCapability(`${prefix}.${payload.slice(0, at)}${payload[at] === 'A' ? 'B' : 'A'}${payload.slice(at + 1)}.${signature}`, SECRET, NOW)).toBeNull();
    expect(verifyPublishCapability(`${prefix}.${payload}.${signature.slice(0, -2)}${signature.at(-2) === 'A' ? 'B' : 'A'}${signature.at(-1)}`, SECRET, NOW)).toBeNull();
  });

  it('refuses a correctly formed token signed with another secret, and any use of a short secret', () => {
    expect(verifyPublishCapability(mint({}, OTHER_SECRET), SECRET, NOW)).toBeNull();
    expect(verifyPublishCapability(mint(), 'short', NOW)).toBeNull();
    expect(() => mint({}, 'short')).toThrow(/secret/);
  });

  it('refuses an expired token, one at its exact expiry, and one that outlives the 20-minute ceiling', () => {
    const token = mint({ exp: Math.floor(NOW / 1000) + 60 });
    expect(verifyPublishCapability(token, SECRET, NOW + 59_000)).not.toBeNull();
    expect(verifyPublishCapability(token, SECRET, NOW + 60_000)).toBeNull();
    expect(verifyPublishCapability(token, SECRET, NOW + 3_600_000)).toBeNull();
    expect(() => mint({ exp: Math.floor(NOW / 1000) + 1201 })).toThrow(/lifetime/);
    // Signed with the right secret, but a lifetime the worker would never mint.
    const long = signed(b64({ v: 1, aud: 'radar-publish-model', ...claims({ exp: Math.floor(NOW / 1000) + 86_400 }), iat: Math.floor(NOW / 1000) }));
    expect(verifyPublishCapability(long, SECRET, NOW)).toBeNull();
  });

  it('refuses a correctly signed token for another audience, another version, a missing claim or an extra claim', () => {
    const base = { v: 1, aud: 'radar-publish-model', ...claims(), iat: Math.floor(NOW / 1000) };
    expect(verifyPublishCapability(signed(b64(base)), SECRET, NOW)).not.toBeNull();
    const { bid: _bid, ...missing } = base;
    for (const body of [{ ...base, aud: 'radar-other-service' }, { ...base, aud: undefined }, { ...base, v: 2 }, missing, { ...base, admin: true }, { ...base, maxUsd: -1 }, { ...base, maxUsd: 'Infinity' }, { ...base, maxCalls: 0 }, { ...base, model: 'a b' }, { ...base, model: '../v1/models' }, { ...base, runId: 'not-a-uuid' }]) {
      expect(verifyPublishCapability(signed(b64(body)), SECRET, NOW)).toBeNull();
    }
  });

  it('refuses other spellings: another prefix, extra segments, padding, an over-long token, a non-string', () => {
    const token = mint();
    const [, payload, signature] = token.split('.');
    for (const forged of [`rdrcap2.${payload}.${signature}`, `${token}.extra`, `rdrcap1.${payload}`, `rdrcap1.${payload}.${signature}=`, `rdrcap1..${signature}`, ` ${token}`, `rdrcap1.${payload}.${'A'.repeat(43)}`, token + 'A'.repeat(5000)]) expect(verifyPublishCapability(forged, SECRET, NOW)).toBeNull();
    for (const value of [null, undefined, 42, {}, [token]]) expect(verifyPublishCapability(value as any, SECRET, NOW)).toBeNull();
  });

  it('never puts the secret or a token in an error message', () => {
    for (const bad of [() => mint({ model: 'bad model' }), () => mint({ runId: 'x' }), () => mint({ exp: 1 }), () => mint({}, 'short-secret-value')]) {
      try { bad(); throw new Error('expected a throw'); } catch (error: any) { expect(error.message).not.toContain(SECRET); expect(error.message).not.toContain('short-secret-value'); expect(error.message).not.toContain('rdrcap1.'); }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The proxy handler

interface Upstream { url: string; init: RequestInit; body: any }
function harness(over: Partial<ModelProxyDeps> = {}, answer: (call: Upstream) => Response | Promise<Response> = () => sse({ input: 10, output: 5 })) {
  const upstream: Upstream[] = []; const events: ModelProxyEvent[] = []; const rows: any[] = [];
  let now = NOW;
  const deps: ModelProxyDeps = {
    capabilitySecret: SECRET, providerKey: PROVIDER_KEY, now: () => now, state: new ModelProxyState(),
    fetch: async (url, init) => { const call = { url, init, body: JSON.parse(String(init.body)) }; upstream.push(call); return answer(call); },
    record: async row => { rows.push(row); }, log: event => { events.push(event); }, ...over,
  };
  return { deps, upstream, events, rows, advance: (ms: number) => { now += ms; }, at: () => now };
}
function sse(usage: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }, text = 'UPSTREAM-ANSWER-TEXT'): Response {
  const events = [
    { type: 'message_start', message: { id: 'msg_qa', usage: { input_tokens: usage.input ?? 0, cache_read_input_tokens: usage.cacheRead ?? 0, cache_creation_input_tokens: usage.cacheWrite ?? 0, output_tokens: 1 } } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: usage.output ?? 0 } },
    { type: 'message_stop' },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_qa', 'set-cookie': 'upstream=1', 'x-upstream-internal': 'do-not-pass' } });
}
const BODY = { model: 'claude-haiku-5-5', max_tokens: 128_000, stream: true, messages: [{ role: 'user', content: 'CALLER-PROMPT-TEXT' }], tools: [{ name: 'Read', description: 'read', input_schema: { type: 'object' } }] };
const post = (path: string, token: string | null, body: unknown = BODY, headers: Record<string, string> = {}) => new Request(`http://proxy.invalid${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-api-key': token } : {}), ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const MESSAGES = '/model/v1/messages';

describe('model proxy: who may call it', () => {
  it('answers the health route with two bytes and nothing about itself', async () => {
    const h = harness();
    const response = await handleModelProxyRequest(new Request('http://proxy.invalid/model/health'), h.deps);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect([...response.headers.keys()].sort()).toEqual(['cache-control', 'content-type']);
    expect(h.upstream).toHaveLength(0);
  });

  it('refuses every unauthenticated or badly authenticated request with the same 401, before any upstream call', async () => {
    const h = harness();
    const good = mint();
    const [prefix, payload, signature] = good.split('.');
    const tokens: (string | null)[] = [
      null, '', 'sk-ant-api03-not-a-capability', PROVIDER_KEY, SECRET,
      `${prefix}.${b64({ ...decode(good), maxUsd: 9999 })}.${signature}`, // tampered
      mint({}, OTHER_SECRET), // wrong secret
      mint({ exp: Math.floor(NOW / 1000) - 30 }, SECRET, NOW - 600_000), // expired
      `${prefix}.${payload}.`, `${prefix}.${payload}`,
    ];
    const bodies = new Set<string>();
    for (const token of tokens) {
      const response = await handleModelProxyRequest(post(MESSAGES, token), h.deps);
      expect(response.status).toBe(401);
      bodies.add(await response.text());
    }
    expect(bodies.size).toBe(1); // nothing tells the caller which check failed
    expect(h.upstream).toHaveLength(0);
    expect(h.rows).toHaveLength(0);
    // A capability that has expired by the proxy's clock, having been valid a moment ago.
    h.advance(601_000);
    expect((await handleModelProxyRequest(post(MESSAGES, good), h.deps)).status).toBe(401);
    expect(h.upstream).toHaveLength(0);
  });

  it('accepts the capability as x-api-key or as a bearer token', async () => {
    const h = harness();
    expect((await handleModelProxyRequest(post(MESSAGES, mint()), h.deps)).status).toBe(200);
    expect((await handleModelProxyRequest(post(MESSAGES, null, BODY, { authorization: `Bearer ${mint()}` }), h.deps)).status).toBe(200);
    expect(h.upstream).toHaveLength(2);
  });

  it('is not a relay: only two upstream addresses exist, whatever path, method or host the caller names', async () => {
    const h = harness();
    const token = mint();
    const paths = ['/', '/model', '/model/', '/v1/messages', '/model/v1/complete', '/model/v1/models', '/model/v1/messages/batches', '/model/v1/files', '/model/v1/messages/extra', '/model/v1/messages/', '/model//v1/messages', '/MODEL/v1/messages', '/model/v1/messages%2f..%2fmodels', '/model/v1/organizations/api_keys', '/model/health/', '/api/files/x'];
    for (const path of paths) {
      const response = await handleModelProxyRequest(post(path, token), h.deps);
      expect([path, response.status]).toEqual([path, 404]);
    }
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']) expect((await handleModelProxyRequest(new Request(`http://proxy.invalid${MESSAGES}`, { method, headers: { 'x-api-key': token } }), h.deps)).status).toBe(404);
    expect((await handleModelProxyRequest(new Request('http://proxy.invalid/model/health', { method: 'POST', headers: { 'x-api-key': token }, body: '{}' }), h.deps)).status).toBe(404);
    expect(h.upstream).toHaveLength(0);

    // Dot segments are resolved by the URL parser before routing; wherever they land, the upstream address is a constant.
    await handleModelProxyRequest(post('/model/v1/x/../messages?beta=true&url=https://evil.example.test', token, { ...BODY, base_url: 'https://evil.example.test', url: 'https://evil.example.test' }, { host: 'evil.example.test', 'x-forwarded-host': 'evil.example.test' }), h.deps);
    await handleModelProxyRequest(post('/model/v1/messages/count_tokens', token), h.deps);
    expect(h.upstream.map(call => call.url)).toEqual([MODEL_PROXY_UPSTREAM.messages, MODEL_PROXY_UPSTREAM.count_tokens]);
    for (const call of h.upstream) expect((call.init as any).redirect).toBe('manual');
  });

  it('sends upstream only its own key and three protocol headers: the caller’s credential, cookies and odd headers stay behind', async () => {
    const h = harness();
    const token = mint();
    await handleModelProxyRequest(post(MESSAGES, token, BODY, { authorization: `Bearer ${token}`, cookie: 'session=abc', 'x-forwarded-for': '10.0.0.1', 'anthropic-version': '2023-06-01', 'anthropic-beta': 'context-management-2025-06-27', 'anthropic-dangerous-direct-browser-access': 'true', 'x-stainless-os': 'Linux' }), h.deps);
    const sent = h.upstream[0].init.headers as Record<string, string>;
    expect(Object.keys(sent).sort()).toEqual(['anthropic-beta', 'anthropic-version', 'content-type', 'x-api-key']);
    expect(sent['x-api-key']).toBe(PROVIDER_KEY);
    expect(JSON.stringify(h.upstream[0])).not.toContain(token);
    // A malformed version falls back to the default; a header-splitting beta value is dropped.
    await handleModelProxyRequest(post(MESSAGES, mint(), BODY, { 'anthropic-version': 'latest; drop', 'anthropic-beta': 'x'.repeat(3000) }), h.deps);
    expect(h.upstream[1].init.headers).toEqual({ 'content-type': 'application/json', 'x-api-key': PROVIDER_KEY, 'anthropic-version': '2023-06-01' });
  });
});

describe('model proxy: what a valid capability can make it do', () => {
  it('forces the capability’s model and caps max_tokens, whatever the sandbox asks for', async () => {
    const h = harness();
    await handleModelProxyRequest(post(MESSAGES, mint(), { ...BODY, model: 'claude-fable-5-2', max_tokens: 1_000_000, speed: 'fast', inference_geo: 'us', fallbacks: ['claude-fable-5-2'] }), h.deps);
    expect(h.upstream[0].body.model).toBe(MODEL);
    expect(h.upstream[0].body.max_tokens).toBe(32_000);
    for (const field of ['speed', 'inference_geo', 'fallbacks']) expect(h.upstream[0].body).not.toHaveProperty(field);
    expect(h.upstream[0].body.messages).toEqual(BODY.messages);
    await handleModelProxyRequest(post(MESSAGES, mint(), { ...BODY, max_tokens: 500 }), h.deps);
    expect(h.upstream[1].body.max_tokens).toBe(500);
    for (const bad of [undefined, '32000', -1, 1.5, null]) expect((await handleModelProxyRequest(post(MESSAGES, mint(), { ...BODY, max_tokens: bad }), h.deps)).status).toBe(400);
    expect(h.upstream).toHaveLength(2);
  });

  it('refuses provider-executed features, so the provider is not a second way out of the sandbox', async () => {
    const h = harness();
    const refusedBodies = [
      { ...BODY, mcp_servers: [{ type: 'url', url: 'https://evil.example.test/mcp', name: 'x' }] },
      { ...BODY, container: { id: 'c' } },
      { ...BODY, tools: [{ type: 'web_search_20250305', name: 'web_search' }] },
      { ...BODY, tools: [{ type: 'web_fetch_20250910', name: 'web_fetch' }] },
      { ...BODY, tools: [{ type: 'code_execution_20250825', name: 'code_execution' }] },
      { ...BODY, tools: [{ type: 'bash_20250124', name: 'bash' }] },
      { ...BODY, tools: [...BODY.tools, { type: 'computer_20250124', name: 'computer' }] },
      { ...BODY, tools: [{ name: 'Read', input_schema: { type: 'object' }, allowed_callers: ['code_execution_20250825'] }] },
      { ...BODY, tools: 'web_search' },
      { ...BODY, tools: [{ name: 'NoSchema' }] },
    ];
    for (const body of refusedBodies) {
      const response = await handleModelProxyRequest(post(MESSAGES, mint(), body), h.deps);
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain('evil.example.test');
    }
    expect(h.upstream).toHaveLength(0);
    expect(h.rows).toHaveLength(0);
  });

  it('refuses a body that is not a JSON object or is too large, before any upstream call', async () => {
    const h = harness();
    for (const body of ['not json', '[1,2]', '"text"', 'null', '']) expect((await handleModelProxyRequest(post(MESSAGES, mint(), body), h.deps)).status).toBe(400);
    expect((await handleModelProxyRequest(post(MESSAGES, mint(), JSON.stringify({ ...BODY, pad: 'x'.repeat(8_100_000) })), h.deps)).status).toBe(413);
    expect(h.upstream).toHaveLength(0);
  });

  it('stops a run at its call cap with a 400 the SDK does not retry, and keeps runs separate', async () => {
    const h = harness();
    const run = randomUUID();
    const token = mint({ runId: run, maxCalls: 2 });
    expect((await (await handleModelProxyRequest(post(MESSAGES, token), h.deps)).text())).toContain('UPSTREAM-ANSWER-TEXT');
    await (await handleModelProxyRequest(post(MESSAGES, token), h.deps)).text();
    const third = await handleModelProxyRequest(post(MESSAGES, token), h.deps);
    expect(third.status).toBe(400);
    expect(await third.json()).toEqual({ type: 'error', error: { type: 'invalid_request_error', message: BUDGET_EXHAUSTED_MESSAGE } });
    expect(h.upstream).toHaveLength(2);
    // Another capability for the same run does not get a fresh budget; another run does.
    expect((await handleModelProxyRequest(post(MESSAGES, mint({ runId: run, maxCalls: 2 })), h.deps)).status).toBe(400);
    expect((await handleModelProxyRequest(post(MESSAGES, mint({ maxCalls: 2 })), h.deps)).status).toBe(200);
    expect(h.events.filter(event => event.event === 'budget-exhausted').map(event => event.reason)).toEqual(['calls', 'calls']);
  });

  it('stops a run at its spend cap, pricing cached tokens, and records one ai_calls row per model call', async () => {
    // claude-opus-5.5: in 4, out 20, cache read 0.20, cache write 5 per million tokens (src/server/ai/prices.ts).
    const h = harness({}, () => sse({ input: 1000, output: 2000, cacheRead: 100_000, cacheWrite: 10_000 }));
    const run = randomUUID();
    const token = mint({ runId: run, maxUsd: 0.2 });
    await (await handleModelProxyRequest(post(MESSAGES, token), h.deps)).text();
    await h.deps.state.settled();
    const expected = (1000 * 4 + 2000 * 20 + 100_000 * 0.2 + 10_000 * 5) / 1e6; // 0.114
    expect(h.deps.state.usage(run)!.usd).toBeCloseTo(expected, 6);
    await (await handleModelProxyRequest(post(MESSAGES, token), h.deps)).text(); // 0.114 < 0.2: admitted, now 0.228
    const refused = await handleModelProxyRequest(post(MESSAGES, token), h.deps);
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain(BUDGET_EXHAUSTED_MESSAGE);
    await h.deps.state.settled();
    expect(h.upstream).toHaveLength(2);
    expect(h.rows).toHaveLength(2);
    expect(h.rows[0]).toMatchObject({ businessId: 'b_qa', task: 'writing', purpose: 'github.integration.agent', model: 'claude-opus-5.5', provider: 'Anthropic', ok: true });
    expect(h.rows[0].costUsd).toBeCloseTo(expected, 6);
    expect(h.events.find(event => event.event === 'budget-exhausted')).toMatchObject({ reason: 'usd', runId: run });
  });

  it('refuses a capability whose model has no price, rather than running it unmetered', async () => {
    const h = harness();
    const response = await handleModelProxyRequest(post(MESSAGES, mint({ model: 'claude-unknown-9' })), h.deps);
    expect(response.status).toBe(400);
    expect(h.upstream).toHaveLength(0);
  });

  it('OBSERVATION: the spend cap is checked at admission, so calls already in flight can pass it (the call cap still holds)', async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const h = harness({}, async () => { await gate; return sse({ input: 0, output: 50_000 }); }); // 1.00 USD each
    const run = randomUUID();
    const token = mint({ runId: run, maxUsd: 1, maxCalls: 200 });
    const inFlight = Array.from({ length: 5 }, () => handleModelProxyRequest(post(MESSAGES, token), h.deps));
    await new Promise(resolve => setTimeout(resolve, 20));
    release();
    for (const response of await Promise.all(inFlight)) { expect(response.status).toBe(200); await response.text(); }
    await h.deps.state.settled();
    expect(h.deps.state.usage(run)!.usd).toBeCloseTo(5, 6); // five times the cap, from five concurrent calls
    expect((await handleModelProxyRequest(post(MESSAGES, token), h.deps)).status).toBe(400);
  });

  it('passes the provider’s error status through, without its key, and never follows a redirect', async () => {
    const h = harness({}, call => call.body.messages[0].content === 'redirect'
      ? new Response(null, { status: 302, headers: { location: 'https://evil.example.test/steal' } })
      : new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: `bad request for key ${PROVIDER_KEY}` } }), { status: 400, headers: { 'content-type': 'application/json', 'set-cookie': 'a=b' } }));
    const failed = await handleModelProxyRequest(post(MESSAGES, mint()), h.deps);
    expect(failed.status).toBe(400);
    const text = await failed.text();
    expect(text).not.toContain(PROVIDER_KEY);
    expect(text).toContain('[redacted]');
    expect(failed.headers.get('set-cookie')).toBeNull();
    const redirected = await handleModelProxyRequest(post(MESSAGES, mint(), { ...BODY, messages: [{ role: 'user', content: 'redirect' }] }), h.deps);
    expect(redirected.status).toBe(502);
    expect(redirected.headers.get('location')).toBeNull();
    expect(h.upstream).toHaveLength(2);
  });

  it('writes no secret, capability, prompt or answer to its log events or its ai_calls rows', async () => {
    const h = harness({ record: async row => { h.rows.push(row); if (h.rows.length === 2) throw new Error(`insert failed for ${PROVIDER_KEY}`); } });
    const tokens = [mint(), mint(), mint({ maxCalls: 1 })];
    await (await handleModelProxyRequest(post(MESSAGES, tokens[0]), h.deps)).text();
    await (await handleModelProxyRequest(post(MESSAGES, tokens[1]), h.deps)).text();
    await (await handleModelProxyRequest(post(MESSAGES, tokens[2]), h.deps)).text();
    await handleModelProxyRequest(post(MESSAGES, tokens[2]), h.deps); // budget-exhausted event
    await handleModelProxyRequest(post(MESSAGES, 'rdrcap1.bad.bad'), h.deps);
    await h.deps.state.settled();
    expect(h.events.map(event => event.event).sort()).toEqual(['budget-exhausted', 'usage-unrecorded']);
    // What main.ts prints: everything except `error`, which goes to reportFailure (sanitized there).
    const printed = JSON.stringify(h.events.map(({ error: _error, ...safe }) => safe)) + JSON.stringify(h.rows);
    for (const secret of [SECRET, PROVIDER_KEY, ...tokens, 'rdrcap1.', 'CALLER-PROMPT-TEXT', 'UPSTREAM-ANSWER-TEXT']) expect(printed).not.toContain(secret);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Over a real socket, as the Railway service serves it

describe('model proxy over node:http (raw request targets)', () => {
  const h = harness();
  let port = 0;
  const server = createServer((req, res) => { void serveModelProxyRequest(req, res, h.deps); });
  beforeAll(async () => { await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); port = (server.address() as AddressInfo).port; });
  afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
  const raw = (method: string, target: string, headers: Record<string, string> = {}, body?: string) => new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, method, path: target, headers: { ...(body ? { 'content-length': String(Buffer.byteLength(body)) } : {}), ...headers } }, response => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString(), headers: response.headers }));
    });
    request.on('error', reject); if (body) request.write(body); request.end();
  });

  it('serves health and refuses everything else that is unauthenticated or off the allow-list', async () => {
    const health = await raw('GET', '/model/health');
    expect([health.status, health.body]).toEqual([200, 'ok']);
    expect(Object.keys(health.headers).filter(name => /server|x-powered-by|via|x-radar/i.test(name))).toEqual([]);
    expect((await raw('POST', MESSAGES, { 'content-type': 'application/json' }, JSON.stringify(BODY))).status).toBe(401);
    for (const target of ['/', '/model', '/model/../etc/passwd', '/model/v1/messages/../../../admin', '/model/%2e%2e/%2e%2e/secret', '//evil.example.test/model/health', '/model/health%00', '/model/v1/messages;x=1', '/.env', '/model/health/../v1/models']) {
      const response = await raw('POST', target, { 'content-type': 'application/json', 'x-api-key': mint() }, JSON.stringify(BODY));
      expect([target, response.status]).toEqual([target, 404]);
    }
    expect((await raw('GET', 'http://evil.example.test/model/health')).status).toBe(404); // absolute-form target
    expect(h.upstream).toHaveLength(0);
  });

  it('a traversal that resolves onto an allowed route still needs a capability and still reaches only the fixed upstream', async () => {
    expect((await raw('POST', '/model/x/../v1/messages', { 'content-type': 'application/json' }, JSON.stringify(BODY))).status).toBe(401);
    const allowed = await raw('POST', '/model/x/../v1/messages', { 'content-type': 'application/json', 'x-api-key': mint() }, JSON.stringify(BODY));
    expect(allowed.status).toBe(200);
    expect(h.upstream.map(call => call.url)).toEqual([MODEL_PROXY_UPSTREAM.messages]);
  });
});
