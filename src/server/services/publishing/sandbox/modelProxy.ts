// The model proxy's request handler (.factory/sandbox-publisher/architecture.md §4). A publishing sandbox holds no
// provider key: its Agent SDK is pointed at this proxy and authenticates with the run's capability. For each request the
// proxy checks the capability, forces the capability's model, caps max_tokens, swaps the capability for Radar's own
// Anthropic key, forwards to Anthropic, passes the answer back unchanged and records what it cost.
//
// Pure with respect to its dependencies: the upstream fetch, the clock, the recorder and the budget state are injected,
// so the handler runs in tests with no network and no database. src/proxy/main.ts wires the real ones. The last section
// holds the two pieces that service needs around the handler, kept here so they are tested with it: reading the
// service's variables, and carrying one node:http exchange through the handler.
//
// Adapted from Thally's track-docs-agent model proxy: capability from x-api-key or Authorization, route allow-list,
// forced model, max_tokens cap, SSE usage capture, provider deadlines, redirect: 'manual'. Left out: credit holds, the
// count_tokens reservation preflight and leases. A per-run budget kept in this process replaces them.
//
// Never logged, recorded or returned by anything here: a capability, the capability secret, the provider key, a request
// body or a response body. ModelProxyEvent carries ids, counts and fixed words only.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { costOf, PRICE, priceKey, type Usage } from '@/server/ai/prices';
import type { AiCallRecord } from '@/server/ai/record';
import { verifyPublishCapability } from './capability';
import { CAPABILITY_SECRET_MIN_LENGTH, MODEL_PROXY_BASE_PATH, MODEL_PROXY_ROUTES, SANDBOX_AI_PURPOSE, type PublishCapabilityClaims } from './types';

export const MODEL_PROXY_UPSTREAM = {
  messages: 'https://api.anthropic.com/v1/messages',
  count_tokens: 'https://api.anthropic.com/v1/messages/count_tokens',
} as const;
export const MODEL_PROXY_LIMITS = {
  /** Largest request body accepted. */
  requestBytes: 8_000_000,
  /** max_tokens is lowered to this when a request asks for more. */
  maxTokens: 32_000,
  /** An upstream error body larger than this is replaced by a generic one. */
  errorBodyBytes: 64_000,
  /** Largest non-streamed upstream answer held in memory. */
  responseBytes: 16_000_000,
  /** Token-count requests a run may make for each model call in its cap. They cost nothing; this only stops a flood. */
  countTokensPerCall: 5,
} as const;
/** Progress, not expected duration, bounds a provider call: no answer at all, a stream that has stopped, and a last-resort
 *  total (Thally's values). */
export interface ModelProxyTimeouts { headersMs: number; idleMs: number; totalMs: number; errorBodyIdleMs: number }
export const MODEL_PROXY_TIMEOUTS: Readonly<ModelProxyTimeouts> = { headersMs: 90_000, idleMs: 60_000, totalMs: 5 * 60_000, errorBodyIdleMs: 10_000 };
/** The message of the 400 a run gets once it is at or over its spend or call cap. The Agent SDK does not retry a 400. */
export const BUDGET_EXHAUSTED_MESSAGE = 'run budget exhausted';

const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';
/** Request fields that would change what a token costs (fast mode, US-only inference) or which model answers
 *  (server-side fallback). Removed before forwarding, so the forced model and the price table stay true. */
const STRIPPED_FIELDS = ['speed', 'inference_geo', 'fallbacks'] as const;
/** Request fields that make Anthropic fetch, connect or execute on the caller's behalf. A sandbox whose only permitted
 *  egress is this proxy must not get a second way out through the provider. */
const REFUSED_FIELDS = ['mcp_servers', 'container'] as const;

type Route = 'messages' | 'count_tokens';

/** One thing worth an operator's attention. Ids, counts and fixed words only. */
export interface ModelProxyEvent {
  event: 'budget-exhausted' | 'call-failed' | 'usage-unrecorded' | 'model-unpriced' | 'provider-key-missing';
  runId: string;
  entryId: string;
  businessId: string;
  route: Route;
  /** call-failed: the upstream status, when there was one. */
  status?: number;
  /** A fixed word. budget-exhausted: `usd`, `calls`, `token-counts`. call-failed: `status`, `unreachable`, `timeout`,
   *  `redirect`, `incomplete`, `client`. */
  reason?: string;
  calls?: number;
  usd?: number;
  /** usage-unrecorded only: what the recorder threw. Untrusted text: sanitize it before printing or sending it. */
  error?: unknown;
}

interface RunBudget { usd: number; calls: number; tokenCounts: number; exp: number }

/** Per-run spend and call counters. They live in this process only: a restart forgets them, so within one capability
 *  lifetime a run can at worst spend its cap twice. That is the accepted price of having no table for it, and the
 *  reason the service runs one replica. A run's counters are dropped once its capability has expired. */
export class ModelProxyState {
  private readonly runs = new Map<string, RunBudget>();
  private readonly writes = new Set<Promise<void>>();
  private sweptAt = 0;

  /** What a run has used so far, or null when this process has not served it (or it has expired). */
  usage(runId: string): { usd: number; calls: number } | null {
    const run = this.runs.get(runId);
    return run ? { usd: run.usd, calls: run.calls } : null;
  }
  /** Resolves once every ai_calls write started so far has finished, written or not. For shutdown and tests. */
  async settled(): Promise<void> {
    while (this.writes.size) await Promise.allSettled([...this.writes]);
  }
  /** The counters for a verified capability's run. */
  run(claims: PublishCapabilityClaims, nowSec: number): RunBudget {
    if (nowSec - this.sweptAt >= 60) {
      this.sweptAt = nowSec;
      for (const [id, other] of this.runs) if (other.exp <= nowSec) this.runs.delete(id);
    }
    let run = this.runs.get(claims.runId);
    if (!run) this.runs.set(claims.runId, run = { usd: 0, calls: 0, tokenCounts: 0, exp: claims.exp });
    run.exp = Math.max(run.exp, claims.exp);
    return run;
  }
  track(write: Promise<void>): void {
    this.writes.add(write);
    void write.finally(() => { this.writes.delete(write); }).catch(() => undefined);
  }
}

export interface ModelProxyDeps {
  /** RADAR_PUBLISH_CAPABILITY_SECRET, exactly as set. */
  capabilitySecret: string;
  /** Radar's own Anthropic key, from the proxy service's environment. */
  providerKey: string;
  /** The upstream transport. Production passes the global fetch. */
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  /** Epoch milliseconds. */
  now(): number;
  /** Writes one ai_calls row; may reject. A failure is reported through `log` and never reaches the response. */
  record(call: AiCallRecord): Promise<unknown>;
  state: ModelProxyState;
  log?(event: ModelProxyEvent): void;
  /** Tests shorten these. */
  timeouts?: Partial<ModelProxyTimeouts>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Usage

/** One response's tokens, split the way they are billed. `inputTokens` is the uncached remainder only. */
export interface ModelUsage { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cacheWrite1hTokens: number; outputTokens: number }

const count = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Read an Anthropic `usage` object. An absent field is zero: by the time usage is read the call is already paid for. */
export function readModelUsage(value: unknown): ModelUsage | null {
  const usage = record(value);
  if (!usage) return null;
  const split = record(usage.cache_creation);
  const written = Math.max(count(usage.cache_creation_input_tokens), count(split?.ephemeral_5m_input_tokens) + count(split?.ephemeral_1h_input_tokens));
  const cacheWrite1hTokens = Math.min(count(split?.ephemeral_1h_input_tokens), written);
  return {
    inputTokens: count(usage.input_tokens), cacheReadTokens: count(usage.cache_read_input_tokens),
    cacheWriteTokens: written - cacheWrite1hTokens, cacheWrite1hTokens, outputTokens: count(usage.output_tokens),
  };
}

/** Largest run of stream text kept while waiting for the blank line that ends an event. */
const SSE_EVENT_MAX_CHARS = 4_000_000;

/** Reads usage out of an Anthropic event stream as it passes, without changing a byte of it. Input counts arrive on
 *  `message_start` and cumulative output on `message_delta` (newer API versions repeat the input counts there). Each
 *  field keeps the highest value any event reported, so a delta that omits a field cannot erase it. */
export function createSseUsageCapture() {
  let buffer = '', seen = false, final = false, errorType: string | null = null;
  const totals: ModelUsage = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0, outputTokens: 0 };
  const take = (value: unknown) => {
    const next = readModelUsage(value);
    if (!next) return;
    seen = true;
    for (const key of Object.keys(totals) as (keyof ModelUsage)[]) totals[key] = Math.max(totals[key], next[key]);
  };
  const event = (block: string) => {
    for (const line of block.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let parsed: Record<string, unknown> | null = null;
      try { parsed = record(JSON.parse(data)); } catch { /* the bytes still reach the caller; this event just carries no usage */ }
      if (!parsed) continue;
      if (parsed.type === 'message_start') take(record(parsed.message)?.usage);
      if (parsed.type === 'message_delta') {
        take(parsed.usage);
        if (Number.isSafeInteger(record(parsed.usage)?.output_tokens)) final = true;
      }
      if (parsed.type === 'error') {
        const type = record(parsed.error)?.type;
        errorType = typeof type === 'string' && /^[a-z_]{1,40}$/.test(type) ? type : 'error';
      }
    }
  };
  return {
    accept(text: string): void {
      buffer += text;
      for (;;) {
        const end = /\r?\n\r?\n/.exec(buffer);
        if (!end) break;
        event(buffer.slice(0, end.index));
        buffer = buffer.slice(end.index + end[0].length);
      }
      if (buffer.length > SSE_EVENT_MAX_CHARS) buffer = '';
    },
    /** Call once the stream has ended, to read a last event that had no blank line after it. */
    finish(): void { if (buffer.trim()) event(buffer); buffer = ''; },
    /** What has been reported so far; null before any usage was seen. */
    usage(): ModelUsage | null { return seen ? { ...totals } : null; },
    /** True once the final cumulative output count has arrived: the call ran to its end. */
    complete(): boolean { return final; },
    /** The type of an `error` event the provider sent inside the stream, if any. */
    errorType(): string | null { return errorType; },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Small pieces

function reply(status: number, type: string, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ type: 'error', error: { type, message } }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
}
const notFound = () => reply(404, 'not_found_error', 'Not found.');

/** The route a request names, or null. Exact paths and methods only; the query string is ignored. */
function routeOf(request: Request): Route | 'health' | null {
  let path: string;
  try { path = new URL(request.url).pathname; } catch { return null; }
  if (request.method === 'GET' && path === MODEL_PROXY_BASE_PATH + MODEL_PROXY_ROUTES.health) return 'health';
  if (request.method !== 'POST') return null;
  if (path === MODEL_PROXY_BASE_PATH + MODEL_PROXY_ROUTES.messages) return 'messages';
  if (path === MODEL_PROXY_BASE_PATH + MODEL_PROXY_ROUTES.countTokens) return 'count_tokens';
  return null;
}

/** The sandbox gets the capability as ANTHROPIC_API_KEY, which the SDK sends as x-api-key; Authorization: Bearer covers
 *  a client configured with an auth token instead. */
function presentedCapabilities(request: Request): string[] {
  const bearer = /^Bearer\s+(\S+)$/i.exec((request.headers.get('authorization') || '').trim())?.[1];
  const key = (request.headers.get('x-api-key') || '').trim();
  return [bearer, key].filter((value): value is string => !!value);
}

const headerValue = (value: string | null, max: number): string | null => value && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;

type StopReason = 'headers' | 'idle' | 'total' | 'client';
/** One abort authority for the upstream fetch and the reading of its body, so a stalled or abandoned call closes the
 *  provider connection instead of leaving it generating tokens nobody will read. */
function createDeadlines(timeouts: ModelProxyTimeouts, client: AbortSignal) {
  const controller = new AbortController();
  let reason: StopReason | null = null;
  const stop = (why: StopReason) => { reason ??= why; controller.abort(); };
  let headersTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => stop('headers'), timeouts.headersMs);
  let totalTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => stop('total'), timeouts.totalMs);
  const onClient = () => stop('client');
  if (client.aborted) onClient(); else client.addEventListener('abort', onClient, { once: true });
  return {
    signal: controller.signal,
    idleMs: timeouts.idleMs,
    reason: () => reason,
    stop,
    headersReceived() { if (headersTimer) clearTimeout(headersTimer); headersTimer = null; },
    settle() {
      if (headersTimer) clearTimeout(headersTimer);
      if (totalTimer) clearTimeout(totalTimer);
      headersTimer = totalTimer = null;
      client.removeEventListener('abort', onClient);
    },
  };
}
type Deadlines = ReturnType<typeof createDeadlines>;

/** One chunk, or a throw when the stream has stopped progressing or the call was stopped. Both losing racers are
 *  released on every read: a long turn reads thousands of chunks. */
async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>, deadlines: Deadlines): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (deadlines.signal.aborted) throw new Error('stopped');
  let idle: ReturnType<typeof setTimeout> | undefined, onAbort: (() => void) | undefined;
  const pending = reader.read();
  pending.catch(() => undefined);
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => { onAbort = () => reject(new Error('stopped')); deadlines.signal.addEventListener('abort', onAbort); }),
      new Promise<never>((_, reject) => { idle = setTimeout(() => { deadlines.stop('idle'); reject(new Error('stopped')); }, deadlines.idleMs); }),
    ]);
  } finally {
    clearTimeout(idle);
    if (onAbort) deadlines.signal.removeEventListener('abort', onAbort);
  }
}

/** A whole body up to a size, or why not. `next` reads one chunk and may throw. */
async function readAll(body: ReadableStream<Uint8Array> | null, maxBytes: number, next: (reader: ReadableStreamDefaultReader<Uint8Array>) => Promise<ReadableStreamReadResult<Uint8Array>>): Promise<{ bytes: Uint8Array } | { failed: 'too-large' | 'unreadable' }> {
  if (!body) return { bytes: new Uint8Array(0) };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    let step: ReadableStreamReadResult<Uint8Array>;
    try { step = await next(reader); } catch { await reader.cancel().catch(() => undefined); return { failed: 'unreadable' }; }
    if (step.done) break;
    length += step.value.byteLength;
    if (length > maxBytes) { await reader.cancel().catch(() => undefined); return { failed: 'too-large' }; }
    chunks.push(step.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { bytes };
}

async function readIdle(reader: ReadableStreamDefaultReader<Uint8Array>, idleMs: number): Promise<ReadableStreamReadResult<Uint8Array>> {
  let idle: ReturnType<typeof setTimeout> | undefined;
  const pending = reader.read();
  pending.catch(() => undefined);
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => { idle = setTimeout(() => reject(new Error('idle')), idleMs); })]);
  } finally { clearTimeout(idle); }
}

/** The names of request features this proxy does not forward: provider-run MCP connectors, provider containers, and any
 *  tool that is not a plain client tool (the runner's tools are all client tools with an input schema). */
function refusedFeatures(body: Record<string, unknown>): string[] {
  const refused: string[] = REFUSED_FIELDS.filter(key => body[key] !== undefined && body[key] !== null);
  const tools = body.tools;
  if (tools !== undefined && tools !== null) {
    const local = Array.isArray(tools) && tools.every(tool => {
      const row = record(tool);
      return !!row && (row.type === undefined || row.type === null || row.type === 'custom') && row.allowed_callers === undefined && typeof row.name === 'string' && !!record(row.input_schema);
    });
    if (!local) refused.push('tools');
  }
  return refused;
}

/** Headers of an upstream answer that are passed back: the content type and the named ones, each only when it is a short
 *  printable value that does not contain the provider key. Nothing else from upstream crosses. */
function passedHeaders(upstream: Response, providerKey: string, contentType: string, names: readonly string[]): Record<string, string> {
  const safe = (name: string) => { const value = headerValue(upstream.headers.get(name), 200); return value && !(providerKey && value.includes(providerKey)) ? value : null; };
  const headers: Record<string, string> = { 'content-type': safe('content-type') || contentType, 'cache-control': 'no-store' };
  for (const name of names) { const value = safe(name); if (value) headers[name] = value; }
  return headers;
}

function emit(deps: ModelProxyDeps, event: ModelProxyEvent): void {
  try { deps.log?.(event); } catch { /* an observer never changes an answer */ }
}

// ---------------------------------------------------------------------------------------------------------------------
// The handler

/** Answer one request to the model proxy. Never throws: every failure is a response. */
export async function handleModelProxyRequest(request: Request, deps: ModelProxyDeps): Promise<Response> {
  const route = routeOf(request);
  if (route === 'health') return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  if (!route) return notFound();
  try {
    return await forward(request, route, deps);
  } catch {
    return reply(500, 'api_error', 'Model proxy error.');
  }
}

async function forward(request: Request, route: Route, deps: ModelProxyDeps): Promise<Response> {
  const startedAt = deps.now();
  let claims: PublishCapabilityClaims | null = null;
  for (const token of presentedCapabilities(request)) {
    try { claims = verifyPublishCapability(token, deps.capabilitySecret, startedAt); } catch { claims = null; }
    if (claims) break;
  }
  if (!claims) return reply(401, 'authentication_error', 'Unauthorized.');
  const who = { runId: claims.runId, entryId: claims.entryId, businessId: claims.bid, route };

  if (!deps.providerKey) {
    emit(deps, { event: 'provider-key-missing', ...who });
    return reply(503, 'api_error', 'Model provider unavailable.');
  }
  // The spend cap is only as good as the price behind it: a model this table cannot price, cached tokens included, is
  // refused rather than run uncounted.
  const catalogueId = priceKey(claims.model);
  const price = PRICE[catalogueId];
  if (!price || price.cacheRead == null || price.cacheWrite == null || price.cacheWrite1h == null) {
    emit(deps, { event: 'model-unpriced', ...who });
    return reply(400, 'invalid_request_error', 'The run model has no price; its budget cannot be enforced.');
  }

  if (Number(request.headers.get('content-length')) > MODEL_PROXY_LIMITS.requestBytes) return reply(413, 'request_too_large', 'Request body is too large.');
  const read = await readAll(request.body, MODEL_PROXY_LIMITS.requestBytes, reader => reader.read());
  if ('failed' in read) return read.failed === 'too-large' ? reply(413, 'request_too_large', 'Request body is too large.') : reply(400, 'invalid_request_error', 'Request body could not be read.');
  let body: Record<string, unknown> | null = null;
  try { body = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.bytes))); } catch { body = null; }
  if (!body) return reply(400, 'invalid_request_error', 'Request body must be a JSON object.');

  const refused = refusedFeatures(body);
  if (refused.length) return reply(400, 'invalid_request_error', `Provider-executed request features are not allowed: ${refused.join(', ')}.`);
  for (const field of STRIPPED_FIELDS) delete body[field];
  body.model = claims.model;
  if (route === 'messages') {
    const asked = body.max_tokens;
    if (typeof asked !== 'number' || !Number.isSafeInteger(asked) || asked < 0) return reply(400, 'invalid_request_error', 'max_tokens must be a non-negative integer.');
    body.max_tokens = Math.min(asked, MODEL_PROXY_LIMITS.maxTokens);
  }

  // Admission. Nothing above awaited between reading the counters and changing them, so two requests cannot both take
  // the last call.
  const run = deps.state.run(claims, Math.floor(startedAt / 1000));
  const over = run.usd >= claims.maxUsd ? 'usd' : run.calls >= claims.maxCalls ? 'calls'
    : route === 'count_tokens' && run.tokenCounts >= claims.maxCalls * MODEL_PROXY_LIMITS.countTokensPerCall ? 'token-counts' : null;
  if (over) {
    emit(deps, { event: 'budget-exhausted', ...who, reason: over, calls: run.calls, usd: run.usd });
    return reply(400, 'invalid_request_error', BUDGET_EXHAUSTED_MESSAGE);
  }
  if (route === 'messages') run.calls += 1; else run.tokenCounts += 1;

  const deadlines = createDeadlines({ ...MODEL_PROXY_TIMEOUTS, ...deps.timeouts }, request.signal);
  let settled = false;
  /** Close the call exactly once: release the timers, count the spend, write the row and, for a failure, say so. Token
   *  counts cost nothing and are not recorded. */
  const settle = (outcome: { usage: ModelUsage | null; note?: string; failure?: { reason: string; status?: number } }) => {
    if (settled) return;
    settled = true;
    deadlines.settle();
    if (outcome.failure) emit(deps, { event: 'call-failed', ...who, ...outcome.failure });
    if (route !== 'messages') return;
    const usage: Usage = outcome.usage ?? {};
    const costUsd = outcome.usage ? costOf(claims.model, usage, 'Anthropic') : null;
    if (costUsd) run.usd += costUsd;
    const call: AiCallRecord = {
      businessId: claims.bid, task: 'writing', purpose: SANDBOX_AI_PURPOSE, model: catalogueId, provider: 'Anthropic',
      latencyMs: Math.max(0, Math.round(deps.now() - startedAt)), ...usage, costUsd, ok: !outcome.failure, error: outcome.note,
    };
    deps.state.track((async () => {
      try { await deps.record(call); } catch (error) { emit(deps, { event: 'usage-unrecorded', ...who, error }); }
    })());
  };
  /** Why a call that was stopped or could not be read ended: the caller left, a deadline passed, or the connection broke. */
  const interruption = (broken: string, kind: 'unreachable' | 'incomplete'): { note: string; reason: string } => {
    const why = deadlines.reason();
    return why === 'client' ? { note: 'client disconnected', reason: 'client' } : why ? { note: `upstream ${why} timeout`, reason: 'timeout' } : { note: broken, reason: kind };
  };
  const interrupted = (broken: string, kind: 'unreachable' | 'incomplete'): Response => {
    const { note, reason } = interruption(broken, kind);
    settle({ usage: null, note, failure: { reason } });
    return reason === 'client' ? reply(499, 'api_error', 'Client closed the request.') : reason === 'timeout' ? reply(504, 'api_error', 'Model provider timed out.')
      : reply(502, 'api_error', kind === 'incomplete' ? 'Model provider response was incomplete.' : 'Model provider unavailable.');
  };

  const beta = headerValue(request.headers.get('anthropic-beta'), 2048);
  const version = request.headers.get('anthropic-version') || '';
  let upstream: Response;
  try {
    upstream = await deps.fetch(MODEL_PROXY_UPSTREAM[route], {
      method: 'POST',
      // Built from nothing: no header of the caller's is copied, so its credential cannot travel upstream.
      headers: { 'content-type': 'application/json', 'x-api-key': deps.providerKey, 'anthropic-version': /^\d{4}-\d{2}-\d{2}$/.test(version) ? version : DEFAULT_ANTHROPIC_VERSION, ...(beta ? { 'anthropic-beta': beta } : {}) },
      body: JSON.stringify(body),
      redirect: 'manual',
      signal: deadlines.signal,
    });
  } catch {
    return interrupted('upstream unreachable', 'unreachable');
  }
  deadlines.headersReceived();

  // A redirect is never followed and never passed on: the provider key must not be sent anywhere a response names.
  if (upstream.type === 'opaqueredirect' || upstream.status >= 300 && upstream.status < 400) {
    await upstream.body?.cancel().catch(() => undefined);
    settle({ usage: null, note: 'upstream redirect refused', failure: { reason: 'redirect', ...(upstream.status ? { status: upstream.status } : {}) } });
    return reply(502, 'api_error', 'Model provider answered with a redirect.');
  }

  if (!upstream.ok) {
    // The provider's own error, with its status, so the SDK retries or stops as it would against the provider.
    const errorBody = await readAll(upstream.body, MODEL_PROXY_LIMITS.errorBodyBytes, reader => readIdle(reader, deps.timeouts?.errorBodyIdleMs ?? MODEL_PROXY_TIMEOUTS.errorBodyIdleMs));
    let text = '';
    try { if ('bytes' in errorBody) text = new TextDecoder().decode(errorBody.bytes); } catch { text = ''; }
    if (deps.providerKey.length >= 6) text = text.split(deps.providerKey).join('[redacted]');
    if (!text.trim()) text = JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Model provider error.' } });
    settle({ usage: null, note: `HTTP ${upstream.status}`, failure: { reason: 'status', status: upstream.status } });
    return new Response(text, { status: upstream.status, headers: passedHeaders(upstream, deps.providerKey, 'application/json', ['request-id', 'retry-after', 'x-should-retry']) });
  }
  if (!upstream.body) {
    settle({ usage: null, note: 'upstream sent no body', failure: { reason: 'incomplete', status: upstream.status } });
    return reply(502, 'api_error', 'Model provider response was incomplete.');
  }

  const streamed = /^text\/event-stream\b/i.test(upstream.headers.get('content-type') || '');
  if (!streamed) {
    const answer = await readAll(upstream.body, MODEL_PROXY_LIMITS.responseBytes, reader => readChunk(reader, deadlines));
    if ('failed' in answer) {
      if (answer.failed === 'unreadable') return interrupted('upstream response was incomplete', 'incomplete');
      settle({ usage: null, note: 'upstream response too large', failure: { reason: 'incomplete', status: upstream.status } });
      return reply(502, 'api_error', 'Model provider response was incomplete.');
    }
    let usage: ModelUsage | null = null;
    if (route === 'messages') { try { usage = readModelUsage(record(JSON.parse(new TextDecoder().decode(answer.bytes)))?.usage); } catch { usage = null; } }
    settle({ usage, ...(usage || route !== 'messages' ? {} : { note: 'usage not reported' }) });
    return new Response(answer.bytes.buffer as ArrayBuffer, { status: upstream.status, headers: passedHeaders(upstream, deps.providerKey, 'application/json', ['request-id']) });
  }

  // Streamed: every chunk goes to the caller as it arrives, and is read for usage on the way past.
  const capture = createSseUsageCapture();
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let ended = false;
  /** The stream ends, one way or another, exactly once. `cut` says why it ended early; null is a normal end. What was
   *  counted up to that point is recorded, and a cut stream is never closed cleanly: the caller sees it break. */
  const end = (cut: { note: string; reason: string } | null) => {
    if (ended) return;
    ended = true;
    capture.finish();
    if (!cut && capture.complete()) settle({ usage: capture.usage() });
    else {
      const inStream = capture.errorType();
      const how = cut ?? { note: inStream ? `stream error: ${inStream}` : 'stream ended without final usage', reason: 'incomplete' };
      settle({ usage: capture.usage(), note: how.note, failure: { reason: how.reason, status: upstream.status } });
    }
    if (!cut) return controller.close();
    void reader.cancel().catch(() => undefined);
    try { controller.error(new Error('model proxy: upstream stream ended early')); } catch { /* the caller cancelled it first */ }
  };
  // Stalled, past the total, or abandoned by the caller. A deadline can pass while the caller is not reading, when no
  // read is waiting to notice it, so the signal ends the stream itself.
  deadlines.signal.addEventListener('abort', () => end(interruption('upstream stream failed', 'incomplete')), { once: true });
  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
    async pull() {
      let step: ReadableStreamReadResult<Uint8Array>;
      try { step = await readChunk(reader, deadlines); } catch { return end(interruption('upstream stream failed', 'incomplete')); }
      if (ended) return;
      if (step.done) {
        try { capture.accept(decoder.decode()); } catch { /* usage capture never disturbs the stream */ }
        // Counted before the stream closes, so the caller's next request already meets the updated budget.
        return end(null);
      }
      try { capture.accept(decoder.decode(step.value, { stream: true })); } catch { /* usage capture never disturbs the stream */ }
      controller.enqueue(step.value);
    },
    cancel() {
      // The caller stopped reading: close the provider connection so it stops generating.
      deadlines.stop('client');
      end({ note: 'client disconnected', reason: 'client' });
    },
  });
  return new Response(stream, { status: upstream.status, headers: passedHeaders(upstream, deps.providerKey, 'text/event-stream', ['request-id']) });
}

// ---------------------------------------------------------------------------------------------------------------------
// The service around the handler (src/proxy/main.ts)

/** What the model-proxy service must be given. */
export const MODEL_PROXY_VARIABLES = ['RADAR_PUBLISH_CAPABILITY_SECRET', 'ANTHROPIC_API_KEY', 'DATABASE_URL', 'PORT'] as const;
/** Secrets of the other services. The proxy works without them and is the one service a sandbox can reach, so their
 *  presence is worth a warning: it widens what a fault here could expose. */
const FOREIGN_VARIABLES = ['RADAR_SECRET_KEY', 'DAYTONA_API_KEY', 'GITHUB_CLIENT_SECRET'] as const;

export type ModelProxyEnvironment =
  | { ok: true; capabilitySecret: string; providerKey: string; port: number; unexpected: string[] }
  /** `missing` names variables that are absent or unusable. Names only, never a value. */
  | { ok: false; missing: string[] };

/** Read the service's variables. The capability secret is taken exactly as set (the worker signs with the same bytes)
 *  and must meet the same length floor; the port must be a real port. */
export function readModelProxyEnvironment(env: Record<string, string | undefined>): ModelProxyEnvironment {
  const missing: string[] = [];
  const capabilitySecret = env.RADAR_PUBLISH_CAPABILITY_SECRET || '';
  if (capabilitySecret.length < CAPABILITY_SECRET_MIN_LENGTH) missing.push('RADAR_PUBLISH_CAPABILITY_SECRET');
  const providerKey = (env.ANTHROPIC_API_KEY || '').trim();
  if (!providerKey || /[\u0000-\u001f\u007f]/.test(providerKey)) missing.push('ANTHROPIC_API_KEY');
  if (!(env.DATABASE_URL || '').trim()) missing.push('DATABASE_URL');
  const rawPort = (env.PORT || '').trim();
  const port = /^\d{1,5}$/.test(rawPort) ? Number(rawPort) : 0;
  if (port < 1 || port > 65_535) missing.push('PORT');
  if (missing.length) return { ok: false, missing };
  return { ok: true, capabilitySecret, providerKey, port, unexpected: FOREIGN_VARIABLES.filter(name => !!env[name]) };
}

/** The request body of a node:http exchange as a web stream. Unlike Readable.toWeb, cancelling it does not reset the
 *  connection: what is left of the upload is read and thrown away, so a refusal (too large, unauthorized) still
 *  reaches the caller as a response. */
function nodeRequestBody(req: IncomingMessage) {
  let wanted = true;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      req.pause();
      req.on('data', (chunk: Buffer) => {
        if (!wanted) return;
        controller.enqueue(new Uint8Array(chunk));
        if ((controller.desiredSize ?? 0) <= 0) req.pause();
      });
      req.once('end', () => { if (wanted) { wanted = false; controller.close(); } });
      const broken = () => { if (wanted) { wanted = false; controller.error(new Error('request body ended early')); } };
      req.once('error', broken);
      req.once('close', broken);
    },
    pull() { req.resume(); },
    cancel() { wanted = false; req.resume(); },
  });
  return { stream, discard() { wanted = false; if (!req.readableEnded && !req.destroyed) req.resume(); } };
}

const drained = (res: ServerResponse) => new Promise<void>(resolve => {
  const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
  res.once('drain', done);
  res.once('close', done);
});

/** Carry one node:http exchange through the handler: the request becomes a web Request whose signal fires when the
 *  caller goes away, and the answer is written back chunk by chunk as it arrives, honouring backpressure. An answer cut
 *  off after its first byte ends the connection without a clean finish, so the caller cannot mistake it for complete. */
export async function serveModelProxyRequest(req: IncomingMessage, res: ServerResponse, deps: ModelProxyDeps): Promise<void> {
  const gone = new AbortController();
  res.on('error', () => undefined);
  res.on('close', () => { if (!res.writableEnded) gone.abort(); });
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : nodeRequestBody(req);
  try {
    let response: Response;
    try {
      const target = req.url || '';
      if (!target.startsWith('/') || target.startsWith('//')) throw new Error('not an origin-form target');
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      // The host is a placeholder: routing reads the path only.
      const request = new Request(new URL(target, 'http://model-proxy.invalid'), { method: req.method, headers, signal: gone.signal, ...(body ? { body: body.stream, duplex: 'half' } : {}) } as RequestInit);
      response = await handleModelProxyRequest(request, deps);
    } catch {
      // A method or header the web Request refuses is outside the allow-list like any other stray request.
      response = notFound();
    }
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    if (response.body) {
      // A stream's status and headers go out as soon as the provider has answered, not with its first event.
      if (/^text\/event-stream\b/i.test(response.headers.get('content-type') || '')) res.flushHeaders();
      const reader = response.body.getReader();
      try {
        for (;;) {
          const step = await reader.read();
          if (step.done) break;
          if (res.destroyed) { await reader.cancel().catch(() => undefined); break; }
          if (!res.write(step.value)) await drained(res);
        }
      } catch {
        // The provider stream ended early. The status is already sent, so the truthful signal is a broken connection.
        res.destroy();
        return;
      }
    }
    if (!res.destroyed) res.end();
  } catch {
    res.destroy();
  } finally {
    body?.discard();
  }
}
