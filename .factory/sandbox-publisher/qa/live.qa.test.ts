// QA-1 live checks. Nothing here calls the model. Each block is skipped unless its switch is set, and all need the
// worker variables loaded into the process (never printed):
//   RADAR_QA_LIVE_PROXY=1    node --env-file=.env.local node_modules/vitest/vitest.mjs run --config .factory/sandbox-publisher/qa/vitest.config.ts .factory/sandbox-publisher/qa/live.qa.test.ts
//   RADAR_QA_LIVE_SANDBOX=1  (same command)  one real sandbox, labelled workload=radar-publisher, deleted at the end
//   RADAR_QA_LIVE_SWEEP=1    (same command)  read-only: lists sandboxes labelled workload=radar-publisher
// Output is status codes, header names, host names and counts. No secret, capability or response body is printed.
import { createHmac, randomUUID } from 'node:crypto';
import https from 'node:https';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mintPublishCapability } from '@/server/services/publishing/sandbox/capability';
import { sandboxPublisher } from '@/server/services/publishing/sandbox/config';
import { DAYTONA_API_URL, daytonaProvider } from '@/server/services/publishing/sandbox/daytona';
import { SANDBOX_ENV } from '@/server/services/publishing/sandbox/run';
import { SANDBOX_BUDGET, SANDBOX_WORKLOAD, type SandboxHandle, type SandboxPublisherConfig } from '@/server/services/publishing/sandbox/types';

const READY = !!(process.env.DAYTONA_API_KEY && process.env.RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID && process.env.RADAR_PUBLISH_MODEL_PROXY_URL && process.env.RADAR_PUBLISH_CAPABILITY_SECRET);
const PROXY = READY && process.env.RADAR_QA_LIVE_PROXY === '1';
const SANDBOX = READY && process.env.RADAR_QA_LIVE_SANDBOX === '1';
const SWEEP = READY && process.env.RADAR_QA_LIVE_SWEEP === '1';
const BUSINESS = '00000000-0000-4000-8000-000000000000';

function configured(): SandboxPublisherConfig {
  vi.stubEnv('RADAR_PUBLISH_SANDBOX', 'all');
  const config = sandboxPublisher(BUSINESS);
  vi.unstubAllEnvs();
  if (!config.enabled) throw new Error(`not configured: ${(config.missing || []).join(', ')}`);
  return config;
}

// ---------------------------------------------------------------------------------------------------------------------

describe.skipIf(!PROXY)('deployed model proxy refuses everything it should (live, no model spend)', { timeout: 120_000 }, () => {
  let config: SandboxPublisherConfig;
  const seen: Record<string, unknown>[] = [];
  beforeAll(() => { config = configured(); });
  afterAll(() => { console.info('[qa.live.proxy]', JSON.stringify(seen)); });

  /** A raw HTTPS request: the path is sent exactly as written, with no client-side normalisation. */
  const raw = (method: string, path: string, headers: Record<string, string> = {}, body?: string) => new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    const request = https.request({ host: config.proxyUrl.hostname, port: 443, method, path, headers: { ...(body !== undefined ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) } : {}), ...headers }, timeout: 20_000 }, response => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8').slice(0, 2000) }));
    });
    request.on('timeout', () => request.destroy(new Error('timeout'))); request.on('error', reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
  const note = (label: string, response: { status: number; body: string }) => { seen.push({ label, status: response.status, bodyBytes: response.body.length, errorType: (() => { try { return JSON.parse(response.body)?.error?.type ?? null; } catch { return null; } })() }); };
  const HARMLESS = JSON.stringify({ model: 'x', max_tokens: 1, messages: [] });
  const mint = (over: Record<string, unknown> = {}, secret = config.capabilitySecret, now = Date.now()) => mintPublishCapability({ runId: randomUUID(), bid: BUSINESS, entryId: 'e_qa_proxy_probe', model: config.model.apiId, maxUsd: 0.01, maxCalls: 1, exp: Math.floor(now / 1000) + 90, ...over } as any, secret, now);
  const base = () => config.proxyUrl.pathname.replace(/\/$/, '');

  it('health answers 200 "ok" and tells a stranger nothing about the service', async () => {
    const health = await raw('GET', `${base()}/health`);
    note('GET health', health);
    expect(health.status).toBe(200);
    expect(health.body).toBe('ok');
    const names = Object.keys(health.headers).sort();
    seen.push({ label: 'health header names', names });
    const everything = JSON.stringify(health.headers) + health.body;
    for (const secret of [config.capabilitySecret, config.daytonaKey, process.env.ANTHROPIC_API_KEY || '\u0000']) expect(everything.includes(secret)).toBe(false);
    expect(everything).not.toMatch(/sk-ant-|rdrcap1\.|postgres(ql)?:\/\/|x-powered-by/i);
    for (const path of ['/', '/health', '/model', `${base()}/`, `${base()}/health/`, '/.env', '/api/health', `${base()}/metrics`, `${base()}/v1/models`]) {
      const response = await raw('GET', path);
      note(`GET ${path}`, response);
      expect([path, response.status]).toEqual([path, 404]);
      expect(response.body).not.toMatch(/sk-ant-|rdrcap1\.|postgres|stack|at \w+ \(/i);
    }
  });

  it('no capability, a tampered one, an expired one and one signed with another secret are each refused with 401', async () => {
    const valid = mint();
    const [prefix, payload, signature] = valid.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const tamperedPayload = Buffer.from(JSON.stringify({ ...claims, maxUsd: 1000, maxCalls: 100000 })).toString('base64url');
    const otherSecret = 'qa-not-the-deployed-secret-' + 'z'.repeat(24);
    const resigned = `${prefix}.${payload}.${createHmac('sha256', otherSecret).update(`${prefix}.${payload}`).digest('base64url')}`;
    const cases: [string, Record<string, string>][] = [
      ['no capability', {}],
      ['empty x-api-key', { 'x-api-key': '' }],
      ['a provider-style key', { 'x-api-key': 'sk-ant-api03-qa-placeholder-not-a-key' }],
      ['tampered claims under the original signature', { 'x-api-key': `${prefix}.${tamperedPayload}.${signature}` }],
      ['tampered, as a bearer token', { authorization: `Bearer ${prefix}.${tamperedPayload}.${signature}` }],
      ['a truncated signature', { 'x-api-key': `${prefix}.${payload}.${signature.slice(0, -4)}` }],
      ['expired two minutes ago', { 'x-api-key': mint({ exp: Math.floor(Date.now() / 1000) - 120 }, config.capabilitySecret, Date.now() - 600_000) }],
      ['signed with another secret', { 'x-api-key': mint({}, otherSecret) }],
      ['the valid claims re-signed with another secret', { 'x-api-key': resigned }],
    ];
    const bodies = new Set<string>();
    for (const [label, headers] of cases) {
      for (const route of ['/v1/messages', '/v1/messages/count_tokens']) {
        const response = await raw('POST', base() + route, headers, HARMLESS);
        note(`${label} -> POST ${route}`, response);
        expect([label, route, response.status]).toEqual([label, route, 401]);
        bodies.add(response.body);
      }
    }
    expect(bodies.size).toBe(1);
    // The untampered capability minted above is never sent to a model route.
  });

  it('paths off the allow-list and traversal attempts are refused, with or without a valid capability', async () => {
    const targets = [
      '/v1/messages', `${base()}/v1/complete`, `${base()}/v1/models`, `${base()}/v1/messages/batches`, `${base()}/v1/files`, `${base()}/v1/messages/`, `${base()}/v1/messages/x`,
      `${base()}/v1/messages/../../../etc/passwd`, `${base()}/../v1/messages`, `${base()}/%2e%2e/%2e%2e/v1/messages`, `${base()}/v1/messages%2f..%2f..%2fmodels`, `${base()}/v1/messages/..%2f..%2f..%2fadmin`,
      `/${base()}/v1/messages`, `${base()}/v1/messages;a=b`, `${base()}/v1/organizations/api_keys`,
    ];
    for (const target of targets) {
      for (const headers of [{}, { 'x-api-key': mint() }] as Record<string, string>[]) {
        // An empty JSON object: even if a route were reached, there is nothing for a model to answer.
        const response = await raw('POST', target, headers, '{}');
        note(`POST ${target}${headers['x-api-key'] ? ' (valid capability)' : ''}`, response);
        expect([target, [400, 401, 404].includes(response.status)]).toEqual([target, true]);
        expect(response.body).not.toMatch(/root:|"id":"msg_|"type":"message"/);
      }
    }
    // A dot-segment path that resolves onto the messages route is the messages route: it still needs a capability.
    const resolved = await raw('POST', `${base()}/x/../v1/messages`, {}, '{}');
    note('POST /model/x/../v1/messages (no capability)', resolved);
    expect([401, 404]).toContain(resolved.status);
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) { const response = await raw(method, `${base()}/v1/messages`); note(`${method} messages`, response); expect(response.status).toBe(404); }
  });

  it('with a valid capability the deployed build still refuses what the handler refuses, before any provider call', async () => {
    const refusals: [string, string, number][] = [
      ['a provider-run MCP connector', JSON.stringify({ model: 'x', max_tokens: 1, messages: [], mcp_servers: [{ type: 'url', url: 'https://example.invalid/mcp', name: 'x' }] }), 400],
      ['a server-side web tool', JSON.stringify({ model: 'x', max_tokens: 1, messages: [], tools: [{ type: 'web_fetch_20250910', name: 'web_fetch' }] }), 400],
      ['a body that is not JSON', 'not json', 400],
      ['a JSON array', '[]', 400],
      ['max_tokens missing', JSON.stringify({ model: 'x', messages: [] }), 400],
    ];
    for (const [label, body, status] of refusals) {
      const response = await raw('POST', `${base()}/v1/messages`, { 'x-api-key': mint() }, body);
      note(`valid capability, ${label}`, response);
      expect([label, response.status]).toEqual([label, status]);
      expect(response.body).not.toMatch(/"type":"message"/);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------

const EGRESS_SCRIPT = `
import dns from 'node:dns/promises';
import http from 'node:http';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const proxyUrl = process.env.QA_PROXY_URL;
const hosts = JSON.parse(process.env.QA_HOSTS);
const forward = process.env.HTTPS_PROXY || process.env.https_proxy || '';
const direct = async url => { try { const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(6000) }); await r.body?.cancel().catch(() => {}); return r.status; } catch { return null; } };
const tcp = (host, port) => new Promise(resolve => { const s = net.connect({ host, port, timeout: 4000 }); const end = v => { s.destroy(); resolve(v); }; s.on('connect', () => end(true)); s.on('timeout', () => end(false)); s.on('error', () => end(false)); });
const tunnel = host => new Promise(resolve => {
  if (!forward) return resolve(null);
  let done = false; const end = v => { if (!done) { done = true; resolve(v); } };
  try {
    const p = new URL(forward);
    const headers = { host: host + ':443' };
    if (p.username) headers['proxy-authorization'] = 'Basic ' + Buffer.from(decodeURIComponent(p.username) + ':' + decodeURIComponent(p.password)).toString('base64');
    const r = http.request({ host: p.hostname, port: p.port || 80, method: 'CONNECT', path: host + ':443', headers, timeout: 6000 });
    r.on('connect', (res, socket) => { socket.destroy(); end(res.statusCode); }); r.on('response', res => { res.resume(); end(res.statusCode); });
    r.on('timeout', () => { r.destroy(); end(null); }); r.on('error', () => end(null)); r.end();
  } catch { end(null); }
});
const runs = (file, args) => { try { execFileSync(file, args, { stdio: 'ignore', timeout: 4000 }); return true; } catch { return false; } };
const out = { user: process.getuid(), forwardProxySet: !!forward, envNames: Object.keys(process.env).sort(), tools: { git: runs('git', ['--version']), curl: runs('curl', ['--version']), ssh: runs('ssh', ['-V']), npm: runs('npm', ['--version']) }, proxy: {}, hosts: [] };
out.proxy.health = await direct(proxyUrl + '/health');
out.proxy.root = await direct(new URL(proxyUrl).origin + '/');
try { const r = await fetch(proxyUrl + '/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(6000) }); out.proxy.messagesWithoutCapability = r.status; } catch { out.proxy.messagesWithoutCapability = null; }
for (const host of hosts) {
  const isIp = net.isIP(host) !== 0;
  const [https443, http80, tcp443, tcp80, viaTunnel, resolved] = await Promise.all([
    direct('https://' + host + '/'), direct('http://' + host + '/'), tcp(host, 443), tcp(host, 80), tunnel(host),
    isIp ? Promise.resolve(null) : dns.lookup(host).then(() => true, () => false),
  ]);
  out.hosts.push({ host, https443, http80, tcp443, tcp80, tunnel: viaTunnel, dnsResolves: resolved });
}
// Exec output is capped at 2,000 characters by the provider, so the result is collected as a file.
writeFileSync('/tmp/qa-egress/out.json', JSON.stringify(out));
process.stdout.write('qa-egress hosts=' + out.hosts.length);
`;

describe.skipIf(!SANDBOX)('a real sandbox reaches the model proxy and nothing else (live, no model call)', { timeout: 420_000 }, () => {
  let config: SandboxPublisherConfig;
  let sandbox: SandboxHandle | null = null;
  const entry = `e_qa_egress_${Date.now().toString(36)}`;
  const labels = { workload: SANDBOX_WORKLOAD, env: 'development', entry, run: randomUUID() };
  // Not the developers' canaries: code hosts, package registries, model providers, Radar's own web host, Daytona's API,
  // paste and webhook services, a bare IP, the cloud metadata address, and other names on the proxy's parent domain.
  const HOSTS = ['github.com', 'codeload.github.com', 'raw.githubusercontent.com', 'pypi.org', 'registry.yarnpkg.com', 'api.openai.com', 'openrouter.ai', 'radar.thally.io', 'app.daytona.io', 'pastebin.com', 'webhook.site', 'www.google.com', 'example.org', 'up.railway.app', 'railway.app', 'backboard.railway.app', '1.1.1.1', '169.254.169.254'];

  beforeAll(async () => {
    config = configured();
    sandbox = await daytonaProvider(config.daytonaKey).create({ snapshotId: config.snapshotId, allowDomain: config.proxyUrl.hostname.toLowerCase(), ttlMinutes: SANDBOX_BUDGET.ttlMinutes, labels, env: { ...SANDBOX_ENV }, timeoutSec: SANDBOX_BUDGET.createSec });
  });
  afterAll(async () => { await sandbox?.destroy(SANDBOX_BUDGET.destroySec).catch(() => {}); });

  it('the proxy answers; every other host fails over HTTPS, HTTP, raw TCP and a CONNECT tunnel', async () => {
    await sandbox!.upload([{ path: '/tmp/qa-egress/egress.mjs', data: Buffer.from(EGRESS_SCRIPT) }], 60);
    // The first request to the allowed host can time out right after creation; give the route a moment, as probe.mjs does.
    await new Promise(resolve => setTimeout(resolve, 5000));
    const ran = await sandbox!.exec('node /tmp/qa-egress/egress.mjs', { cwd: '/tmp', env: { QA_PROXY_URL: config.proxyUrl.href.replace(/\/$/, ''), QA_HOSTS: JSON.stringify(HOSTS) }, timeoutSec: 180 });
    expect(ran.exitCode, ran.output.slice(0, 200)).toBe(0);
    const result = JSON.parse((await sandbox!.download('/tmp/qa-egress/out.json', 200_000, 60)).toString('utf8')) as { user: number; forwardProxySet: boolean; envNames: string[]; tools: Record<string, boolean>; proxy: Record<string, number | null>; hosts: { host: string; https443: number | null; http80: number | null; tcp443: boolean; tcp80: boolean; tunnel: number | null; dnsResolves: boolean | null }[] };
    console.info('[qa.live.egress]', JSON.stringify({ sandbox: sandbox!.id, appliedAllowDomainMatches: sandbox!.appliedAllowDomain === null ? 'not reported' : sandbox!.appliedAllowDomain.trim().toLowerCase() === config.proxyUrl.hostname.toLowerCase(), user: result.user, forwardProxySet: result.forwardProxySet, tools: result.tools, proxy: result.proxy, hosts: result.hosts, envNames: result.envNames }));
    expect(result.proxy.health).toBe(200);
    expect(result.proxy.messagesWithoutCapability).toBe(401);
    expect(result.user).not.toBe(0);
    expect(result.tools.git).toBe(false);
    // Reached means an HTTP answer came back or a CONNECT tunnel was granted. A bare TCP handshake is recorded but not
    // counted: the sandbox's egress layer accepts connections to ports 80, 443 and 53 itself and then resets them (first
    // run: 1.1.1.1 "connected" on 80 and 443 and returned nothing). The block below checks that no byte comes back.
    const reached = result.hosts.filter(row => row.https443 !== null || row.http80 !== null || (row.tunnel !== null && row.tunnel >= 200 && row.tunnel < 300));
    expect(reached.map(row => row.host)).toEqual([]);
    expect(result.hosts.filter(row => row.dnsResolves === true).map(row => row.host)).toEqual([]);
    expect(result.envNames.filter(name => /DAYTONA.*KEY|API_KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|RADAR_/i.test(name))).toEqual([]);
  });

  it('is deleted, and no sandbox for this entry remains listed', async () => {
    await sandbox!.destroy(SANDBOX_BUDGET.destroySec);
    sandbox = null;
    const { Daytona } = await import('@daytona/sdk');
    const client = new Daytona({ apiKey: config.daytonaKey, apiUrl: DAYTONA_API_URL });
    const listed = async () => { const ids: string[] = []; for await (const item of client.list({ labels: { workload: SANDBOX_WORKLOAD, entry } })) ids.push(item.id); return ids; };
    let remaining = await listed();
    for (const startedAt = Date.now(); remaining.length && Date.now() - startedAt < 45_000;) { await new Promise(resolve => setTimeout(resolve, 3000)); remaining = await listed(); }
    expect(remaining).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe.skipIf(!SWEEP)('no publishing sandbox is left in the organization (live, read-only)', { timeout: 120_000 }, () => {
  it('lists nothing labelled workload=radar-publisher', async () => {
    const config = configured();
    const { Daytona } = await import('@daytona/sdk');
    const client = new Daytona({ apiKey: config.daytonaKey, apiUrl: DAYTONA_API_URL });
    const found: { id: string; entry: string | undefined; state: unknown }[] = [];
    // The server-side filter is checked again here; nothing is deleted by this test.
    for await (const item of client.list({ labels: { workload: SANDBOX_WORKLOAD } })) if ((item as any).labels?.workload === SANDBOX_WORKLOAD) found.push({ id: item.id, entry: (item as any).labels?.entry, state: (item as any).state });
    console.info('[qa.live.sweep]', JSON.stringify({ labelled: found.length, found }));
    expect(found).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Follow-up to the egress probe above, which found that a raw TCP connection to an IP literal completes. This block
// characterises that: does any byte come back from an address that is not the model proxy, by IP, by another TLS name
// on the proxy's own address, or over DNS?
//   RADAR_QA_LIVE_SANDBOX_DEEP=1  one real sandbox, deleted at the end, no model call

const DEEP = READY && process.env.RADAR_QA_LIVE_SANDBOX_DEEP === '1';
const DEEP_SCRIPT = `
import dgram from 'node:dgram';
import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import { writeFileSync } from 'node:fs';
const proxyHost = process.env.QA_PROXY_HOST;
const out = { resolvers: dns.getServers(), proxyAddresses: null, lookups: {}, tcp: [], tls: [], udpDns: null, tcpDns: null, customResolver: null };
const lookup = name => dns.promises.lookup(name, { all: true }).then(rows => rows.map(row => row.address), error => 'error:' + error.code);
out.proxyAddresses = await lookup(proxyHost);
for (const name of ['github.com', 'radar.thally.io', 'example.com', 'one.one.one.one']) out.lookups[name] = await lookup(name);
/** Connect, optionally send bytes, report how many bytes came back and the first line of them. */
const exchange = (host, port, send) => new Promise(resolve => {
  const row = { host, port, connected: false, bytes: 0, firstLine: null, end: null };
  const socket = net.connect({ host, port });
  const finish = why => { row.end = row.end || why; socket.destroy(); resolve(row); };
  const timer = setTimeout(() => finish('timeout'), 6000);
  socket.on('connect', () => { row.connected = true; if (send) socket.write(send); });
  socket.on('data', chunk => { row.bytes += chunk.length; if (row.firstLine === null) row.firstLine = chunk.toString('latin1').split('\\r\\n')[0].replace(/[^\\x20-\\x7e]/g, '.').slice(0, 80); });
  socket.on('error', error => { clearTimeout(timer); finish('error:' + error.code); });
  socket.on('close', () => { clearTimeout(timer); finish('closed'); });
});
out.tcp.push(await exchange('1.1.1.1', 80, 'GET / HTTP/1.1\\r\\nHost: 1.1.1.1\\r\\nConnection: close\\r\\n\\r\\n'));
out.tcp.push(await exchange('1.1.1.1', 80, 'GET / HTTP/1.1\\r\\nHost: example.com\\r\\nConnection: close\\r\\n\\r\\n'));
out.tcp.push(await exchange('1.0.0.1', 80, 'GET / HTTP/1.1\\r\\nHost: 1.0.0.1\\r\\nConnection: close\\r\\n\\r\\n'));
out.tcp.push(await exchange('8.8.8.8', 443, null));
out.tcp.push(await exchange('8.8.8.8', 53, null));
for (const port of [22, 25, 8080, 5432]) out.tcp.push(await exchange('1.1.1.1', port, null));
/** TLS to an address with a chosen server name; reports who answered (certificate subject and issuer) and an HTTP status line. */
const handshake = (host, servername, path) => new Promise(resolve => {
  const row = { host: host === 'PROXY_IP' ? 'proxy address' : host, servername, authorized: null, subject: null, issuer: null, statusLine: null, end: null };
  let socket;
  const finish = why => { row.end = row.end || why; socket?.destroy(); resolve(row); };
  const timer = setTimeout(() => finish('timeout'), 8000);
  try {
    socket = tls.connect({ host: host === 'PROXY_IP' ? proxyIp : host, port: 443, servername, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      row.authorized = socket.authorized; row.subject = cert?.subject?.CN || null; row.issuer = cert?.issuer?.O || cert?.issuer?.CN || null;
      socket.write('GET ' + path + ' HTTP/1.1\\r\\nHost: ' + servername + '\\r\\nUser-Agent: radar-qa-egress-probe\\r\\nConnection: close\\r\\n\\r\\n');
    });
    socket.on('data', chunk => { if (row.statusLine === null) { row.statusLine = chunk.toString('latin1').split('\\r\\n')[0].replace(/[^\\x20-\\x7e]/g, '.').slice(0, 60); clearTimeout(timer); finish('answered'); } });
    socket.on('error', error => { clearTimeout(timer); finish('error:' + (error.code || error.message).slice(0, 40)); });
    socket.on('close', () => { clearTimeout(timer); finish('closed'); });
  } catch (error) { clearTimeout(timer); finish('threw'); }
});
const proxyIp = Array.isArray(out.proxyAddresses) ? out.proxyAddresses.find(address => net.isIPv4(address)) || out.proxyAddresses[0] : null;
out.tls.push(await handshake('1.1.1.1', 'one.one.one.one', '/dns-query?name=example.com&type=A'));
out.tls.push(await handshake('1.1.1.1', 'cloudflare-dns.com', '/'));
if (proxyIp) {
  out.tls.push(await handshake('PROXY_IP', proxyHost, '/model/health'));
  // Other names served from the same address as the proxy (a shared platform edge).
  out.tls.push(await handshake('PROXY_IP', 'radar.thally.io', '/robots.txt'));
  out.tls.push(await handshake('PROXY_IP', 'railway.com', '/robots.txt'));
}
/** A DNS A query for example.com, sent straight to a public resolver. */
const query = Buffer.from('1234010000010000000000000765786d706c6503636f6d0000010001'.replace('6d706c65', '616d706c65'), 'hex');
out.udpDns = await new Promise(resolve => { const socket = dgram.createSocket('udp4'); const timer = setTimeout(() => { socket.close(); resolve('no answer'); }, 5000); socket.on('message', message => { clearTimeout(timer); socket.close(); resolve('answer bytes=' + message.length); }); socket.on('error', error => { clearTimeout(timer); socket.close(); resolve('error:' + error.code); }); socket.send(query, 53, '8.8.8.8', error => { if (error) { clearTimeout(timer); socket.close(); resolve('send error:' + error.code); } }); });
const framed = Buffer.concat([Buffer.from([0, query.length]), query]);
out.tcpDns = await exchange('8.8.8.8', 53, framed);
out.tcp = out.tcp.filter(row => row.port !== 53);
try { const resolver = new dns.promises.Resolver({ timeout: 4000, tries: 1 }); resolver.setServers(['1.1.1.1']); out.customResolver = await resolver.resolve4('example.com'); } catch (error) { out.customResolver = 'error:' + error.code; }
writeFileSync('/tmp/qa-egress/deep.json', JSON.stringify(out));
process.stdout.write('qa-egress-deep done');
`;

describe.skipIf(!DEEP)('what an IP literal, another TLS name and DNS can reach from the sandbox (live, no model call)', { timeout: 420_000 }, () => {
  let config: SandboxPublisherConfig;
  let sandbox: SandboxHandle | null = null;
  const entry = `e_qa_egress_deep_${Date.now().toString(36)}`;
  beforeAll(async () => {
    config = configured();
    sandbox = await daytonaProvider(config.daytonaKey).create({ snapshotId: config.snapshotId, allowDomain: config.proxyUrl.hostname.toLowerCase(), ttlMinutes: SANDBOX_BUDGET.ttlMinutes, labels: { workload: SANDBOX_WORKLOAD, env: 'development', entry, run: randomUUID() }, env: { ...SANDBOX_ENV }, timeoutSec: SANDBOX_BUDGET.createSec });
  });
  afterAll(async () => { await sandbox?.destroy(SANDBOX_BUDGET.destroySec).catch(() => {}); });

  it('records what answers', async () => {
    await sandbox!.upload([{ path: '/tmp/qa-egress/deep.mjs', data: Buffer.from(DEEP_SCRIPT) }], 60);
    await new Promise(resolve => setTimeout(resolve, 5000));
    const ran = await sandbox!.exec('node /tmp/qa-egress/deep.mjs', { cwd: '/tmp', env: { QA_PROXY_HOST: config.proxyUrl.hostname.toLowerCase() }, timeoutSec: 240 });
    expect(ran.exitCode, ran.output.slice(0, 300)).toBe(0);
    const result = JSON.parse((await sandbox!.download('/tmp/qa-egress/deep.json', 200_000, 60)).toString('utf8'));
    // Addresses of the proxy are reduced to a count: the host name is already in the repository, its addresses need not be.
    console.info('[qa.live.egress.deep]', JSON.stringify({ ...result, proxyAddresses: Array.isArray(result.proxyAddresses) ? `${result.proxyAddresses.length} address(es)` : result.proxyAddresses }));
    // No byte from any address or name other than the proxy's own.
    expect(result.tcp.filter((row: any) => row.bytes > 0).map((row: any) => `${row.host}:${row.port}`)).toEqual([]);
    expect(result.tcp.filter((row: any) => ![80, 443, 53].includes(row.port) && row.connected).map((row: any) => `${row.host}:${row.port}`)).toEqual([]);
    const answered = result.tls.filter((row: any) => row.statusLine !== null);
    expect(answered.map((row: any) => row.servername)).toEqual([config.proxyUrl.hostname.toLowerCase()]);
    expect(answered[0].statusLine).toBe('HTTP/1.1 200 OK');
    // Names other than the proxy's do not resolve, through the system resolver or a resolver address chosen by the caller.
    expect(Object.values(result.lookups).every(value => typeof value === 'string' && value.startsWith('error:'))).toBe(true);
    expect(String(result.customResolver)).toMatch(/^error:/);
    // A DNS question sent straight to a public resolver address does get a reply, but with no answer record: the reply
    // is the size of the question (29 bytes over UDP, 29 plus the 2-byte length over TCP). Whether the layer that
    // answers forwards the question anywhere cannot be seen from inside the sandbox.
    expect(result.udpDns === 'no answer' || result.udpDns === 'answer bytes=29').toBe(true);
    expect([0, 31]).toContain(result.tcpDns.bytes);
  });

  it('is deleted', async () => {
    await sandbox!.destroy(SANDBOX_BUDGET.destroySec);
    sandbox = null;
    const { Daytona } = await import('@daytona/sdk');
    const client = new Daytona({ apiKey: config.daytonaKey, apiUrl: DAYTONA_API_URL });
    const listed = async () => { const ids: string[] = []; for await (const item of client.list({ labels: { workload: SANDBOX_WORKLOAD, entry } })) ids.push(item.id); return ids; };
    let remaining = await listed();
    for (const startedAt = Date.now(); remaining.length && Date.now() - startedAt < 45_000;) { await new Promise(resolve => setTimeout(resolve, 3000)); remaining = await listed(); }
    expect(remaining).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The tool fence against the real pinned Agent SDK in the real image, with no model: a loopback server inside the
// sandbox plays the model and asks for the calls a steered agent might make. What matters is what the SDK sends back
// as each tool's result, and what exists on disk afterwards.
//   RADAR_QA_LIVE_FENCE=1  one real sandbox, deleted at the end, no model call, no capability

const FENCE = READY && process.env.RADAR_QA_LIVE_FENCE === '1';
const FENCE_CALLS = [
  { id: 'toolu_qa_01', name: 'Read', input: { file_path: '/proc/self/environ' }, expect: 'refused' },
  { id: 'toolu_qa_02', name: 'Read', input: { file_path: '/opt/radar-agent/run.mjs' }, expect: 'refused' },
  { id: 'toolu_qa_03', name: 'Write', input: { file_path: '/opt/radar-agent/qa-planted.txt', content: 'planted\n' }, expect: 'refused' },
  { id: 'toolu_qa_04', name: 'Write', input: { file_path: '/workspace/repo/.git/hooks/qa-planted', content: 'planted\n' }, expect: 'refused' },
  { id: 'toolu_qa_05', name: 'Write', input: { file_path: '/output/result.json', content: '{"version":1,"status":"completed","agentError":null,"sessionId":null,"turns":1,"changed":[]}' }, expect: 'refused' },
  { id: 'toolu_qa_06', name: 'Bash', input: { command: 'cat /proc/self/environ > /workspace/repo/qa-env.txt' }, expect: 'refused' },
  { id: 'toolu_qa_07', name: 'Glob', input: { pattern: '/proc/*/environ' }, expect: 'refused' },
  { id: 'toolu_qa_08', name: 'Grep', input: { pattern: 'ANTHROPIC', path: '/proc/self', output_mode: 'content' }, expect: 'refused' },
  { id: 'toolu_qa_09', name: 'Read', input: { file_path: '/workspace/repo/../../proc/self/environ' }, expect: 'refused' },
  { id: 'toolu_qa_10', name: 'WebFetch', input: { url: 'https://example.com/', prompt: 'x' }, expect: 'refused' },
  { id: 'toolu_qa_11', name: 'Read', input: { file_path: '/workspace/repo/README.md' }, expect: 'allowed' },
  { id: 'toolu_qa_12', name: 'Write', input: { file_path: '/workspace/repo/content/qa-allowed.md', content: 'allowed write\n' }, expect: 'allowed' },
  { id: 'toolu_qa_13', name: 'Read', input: { file_path: '/workspace/input/task.json' }, expect: 'allowed' },
];
const FENCE_SCRIPT = `
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const CALLS = ${JSON.stringify(FENCE_CALLS)};
const MARKER = 'qa-loopback-key-not-a-capability-0123456789';
const out = { requests: [], toolResults: {}, exit: null, line: '', files: {}, result: null, markerInToolResults: false };
const sse = events => events.map(event => 'event: ' + event.type + '\\ndata: ' + JSON.stringify(event) + '\\n\\n').join('');
const message = (content, stop) => {
  const events = [{ type: 'message_start', message: { id: 'msg_qa_' + out.requests.length, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }];
  content.forEach((block, index) => {
    if (block.type === 'text') { events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } }); }
    else { events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } }, { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } }); }
    events.push({ type: 'content_block_stop', index });
  });
  events.push({ type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } }, { type: 'message_stop' });
  return { events, json: { id: 'msg_qa_' + out.requests.length, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: content.map(block => block.type === 'text' ? block : { type: 'tool_use', id: block.id, name: block.name, input: block.input }), stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 20 } } };
};
const server = http.createServer((req, res) => {
  const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => {
    const path = (req.url || '').split('?')[0]; let body = null; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
    const row = { method: req.method, path, tools: Array.isArray(body?.tools) ? body.tools.map(tool => tool.name) : null, stream: body?.stream === true };
    out.requests.push(row);
    if (req.method !== 'POST' || !path.endsWith('/v1/messages')) { res.writeHead(path.endsWith('/count_tokens') ? 200 : 404, { 'content-type': 'application/json' }); res.end(path.endsWith('/count_tokens') ? '{"input_tokens":10}' : '{"type":"error","error":{"type":"not_found_error","message":"Not found."}}'); return; }
    const results = [];
    for (const turn of Array.isArray(body?.messages) ? body.messages : []) for (const block of Array.isArray(turn?.content) ? turn.content : []) if (block?.type === 'tool_result') results.push(block);
    for (const block of results) {
      const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '');
      if (text.includes(MARKER)) out.markerInToolResults = true;
      out.toolResults[block.tool_use_id] = { isError: block.is_error === true, text: text.replace(MARKER, '[marker]').replace(/[^\\x20-\\x7e]/g, ' ').slice(0, 160) };
    }
    const reply = !row.tools || !row.tools.includes('Read') ? message([{ type: 'text', text: 'ok' }], 'end_turn') : results.length ? message([{ type: 'text', text: 'Finished the fence check.' }], 'end_turn') : message(CALLS.map(call => ({ type: 'tool_use', id: call.id, name: call.name, input: call.input })), 'tool_use');
    if (row.stream) { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); res.end(sse(reply.events)); }
    else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(reply.json)); }
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const child = spawn(process.execPath, ['/opt/radar-agent/run.mjs'], { cwd: '/workspace/repo', env: { ...process.env, ANTHROPIC_API_KEY: MARKER, ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + port, RADAR_AGENT_MODEL: 'claude-opus-5-5', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }, stdio: ['ignore', 'pipe', 'ignore'] });
child.stdout.on('data', chunk => { out.line += chunk.toString('utf8'); });
const timer = setTimeout(() => child.kill('SIGKILL'), 150000);
out.exit = await new Promise(resolve => child.on('exit', code => resolve(code)));
clearTimeout(timer); server.close();
out.line = out.line.replace(/[^\\x20-\\x7e]/g, ' ').slice(0, 200);
out.files = { runnerDirPlanted: existsSync('/opt/radar-agent/qa-planted.txt'), gitHookPlanted: existsSync('/workspace/repo/.git/hooks/qa-planted'), envDump: existsSync('/workspace/repo/qa-env.txt'), allowedWrite: existsSync('/workspace/repo/content/qa-allowed.md') };
try { out.result = JSON.parse(readFileSync('/output/result.json', 'utf8')); } catch { out.result = null; }
// The capability stand-in must not be in anything the run left for the control plane to collect.
out.markerInOutputs = ['/output/result.json', '/output/report.json', '/output/transcript.jsonl'].some(file => { try { return readFileSync(file, 'utf8').includes(MARKER); } catch { return false; } });
writeFileSync('/tmp/qa-fence/out.json', JSON.stringify(out));
process.stdout.write('qa-fence requests=' + out.requests.length + ' exit=' + out.exit);
`;

describe.skipIf(!FENCE)('the tool fence holds against the real Agent SDK (live sandbox, scripted model, no model call)', { timeout: 600_000 }, () => {
  let config: SandboxPublisherConfig;
  let sandbox: SandboxHandle | null = null;
  const entry = `e_qa_fence_${Date.now().toString(36)}`;
  beforeAll(async () => {
    config = configured();
    sandbox = await daytonaProvider(config.daytonaKey).create({ snapshotId: config.snapshotId, allowDomain: config.proxyUrl.hostname.toLowerCase(), ttlMinutes: SANDBOX_BUDGET.ttlMinutes, labels: { workload: SANDBOX_WORKLOAD, env: 'development', entry, run: randomUUID() }, env: { ...SANDBOX_ENV }, timeoutSec: SANDBOX_BUDGET.createSec });
  });
  afterAll(async () => { await sandbox?.destroy(SANDBOX_BUDGET.destroySec).catch(() => {}); });

  it('refuses reads of process state, writes outside the repository, and tools outside the list; allows the workspace', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const { archiveOf } = await import('./helpers');
    // The runner, installed and prepared exactly as an attempt does it, on a three-file synthetic repository.
    const directory = path.resolve(process.cwd(), 'sandbox/publisher');
    const scripts = await Promise.all(['run.mjs', 'prepare.mjs', 'probe.mjs', 'agent-environment.mjs', 'write-scope.mjs'].map(async name => ({ path: `/opt/radar-agent/${name}`, data: await readFile(path.join(directory, name)) })));
    await sandbox!.upload(scripts, 120);
    expect((await sandbox!.exec('mkdir -p /workspace/input /tmp/qa-fence', { timeoutSec: 30 })).exitCode).toBe(0);
    const archive = archiveOf({ 'README.md': '# Fence check\n', 'content/first.md': 'First post.\n', 'package.json': '{}\n' }, 'qa-fence-0000000');
    const task = { version: 1, runId: randomUUID(), mode: 'new', hint: 'content', repository: { fullName: 'radar-qa/fence', commitSha: '0'.repeat(40) }, article: { title: 'x', seoTitle: 'x', description: 'x', slug: 'x', date: '2026-11-12', keyword: 'x', author: 'x', authorSource: 'business-profile-fallback', image: null, canonical: null, refreshUrl: null, sources: [], videos: [], bodyImages: [] }, identity: { retry: null, legacy: null }, limits: { changedFiles: 16, fileBytes: 1_000_000 }, deadlineEpochMs: Date.now() + 300_000 };
    await sandbox!.upload([{ path: '/workspace/input/repo.tar.gz', data: archive }, { path: '/workspace/input/task.json', data: Buffer.from(JSON.stringify(task)) }, { path: '/workspace/input/article.json', data: Buffer.from('{"blocks":[],"units":[]}') }, { path: '/tmp/qa-fence/fence.mjs', data: Buffer.from(FENCE_SCRIPT) }], 120);
    const prepared = await sandbox!.exec('node /opt/radar-agent/prepare.mjs', { cwd: '/workspace', timeoutSec: 120 });
    expect(prepared.exitCode, prepared.output.slice(0, 200)).toBe(0);
    const ran = await sandbox!.exec('node /tmp/qa-fence/fence.mjs', { cwd: '/tmp/qa-fence', timeoutSec: 240 });
    const out = JSON.parse((await sandbox!.download('/tmp/qa-fence/out.json', 500_000, 60)).toString('utf8'));
    console.info('[qa.live.fence]', JSON.stringify({ sandbox: sandbox!.id, exec: ran.output.slice(0, 120), ...out }));
    // The scripted model was asked through the SDK's real request path, with exactly the five file tools on the wire.
    const modelRequests = out.requests.filter((row: any) => row.method === 'POST' && row.path.endsWith('/v1/messages') && row.tools?.includes('Read'));
    expect(modelRequests.length).toBeGreaterThanOrEqual(2);
    for (const row of modelRequests) expect([...row.tools].sort()).toEqual(['Edit', 'Glob', 'Grep', 'Read', 'Write']);
    // Every call got an answer, and each answer is the one the fence should give.
    for (const call of FENCE_CALLS) {
      const answer = out.toolResults[call.id];
      expect([call.id, call.name, !!answer]).toEqual([call.id, call.name, true]);
      expect([call.id, call.name, answer.isError ? 'refused' : 'allowed']).toEqual([call.id, call.name, call.expect]);
    }
    expect(out.markerInToolResults).toBe(false); // nothing returned to the model carried the key stand-in
    expect(out.markerInOutputs).toBe(false);
    expect(out.files).toEqual({ runnerDirPlanted: false, gitHookPlanted: false, envDump: false, allowedWrite: true });
    // The runner's result lists only the one file written inside the repository.
    expect(out.result?.changed?.map((file: any) => file.path)).toEqual(['content/qa-allowed.md']);
  });

  it('is deleted', async () => {
    await sandbox!.destroy(SANDBOX_BUDGET.destroySec);
    sandbox = null;
    const { Daytona } = await import('@daytona/sdk');
    const client = new Daytona({ apiKey: config.daytonaKey, apiUrl: DAYTONA_API_URL });
    const listed = async () => { const ids: string[] = []; for await (const item of client.list({ labels: { workload: SANDBOX_WORKLOAD, entry } })) ids.push(item.id); return ids; };
    let remaining = await listed();
    for (const startedAt = Date.now(); remaining.length && Date.now() - startedAt < 45_000;) { await new Promise(resolve => setTimeout(resolve, 3000)); remaining = await listed(); }
    expect(remaining).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// SBX-6 against the real provider: what Daytona reports for a publishing sandbox (lifetime, network, user), and that
// the leftover sweep at the start of an attempt deletes that entry's sandbox and no other.
//   RADAR_QA_LIVE_ORPHAN=1  two real sandboxes, both deleted, no model call

const ORPHAN = READY && process.env.RADAR_QA_LIVE_ORPHAN === '1';
describe.skipIf(!ORPHAN)('a leftover sandbox is bounded by its TTL and removed by the next attempt (live, no model call)', { timeout: 420_000 }, () => {
  let config: SandboxPublisherConfig;
  const stamp = Date.now().toString(36);
  const entryA = `e_qa_orphan_a_${stamp}`; const entryB = `e_qa_orphan_b_${stamp}`;
  const handles: SandboxHandle[] = [];
  const spec = (entry: string) => ({ snapshotId: config.snapshotId, allowDomain: config.proxyUrl.hostname.toLowerCase(), ttlMinutes: SANDBOX_BUDGET.ttlMinutes, labels: { workload: SANDBOX_WORKLOAD, env: 'development', entry, run: randomUUID() }, env: { ...SANDBOX_ENV }, timeoutSec: SANDBOX_BUDGET.createSec });
  afterAll(async () => { for (const handle of handles) await handle.destroy(SANDBOX_BUDGET.destroySec).catch(() => {}); });

  it('reports the lifetime and network settings an attempt asks for, and the sweep deletes only its own entry', async () => {
    config = configured();
    const provider = daytonaProvider(config.daytonaKey);
    const a = await provider.create(spec(entryA)); handles.push(a);
    const b = await provider.create(spec(entryB)); handles.push(b);
    const { Daytona } = await import('@daytona/sdk');
    const client = new Daytona({ apiKey: config.daytonaKey, apiUrl: DAYTONA_API_URL });
    const raw = await client.get(a.id) as unknown as Record<string, unknown>;
    const reported = Object.fromEntries(Object.entries(raw).filter(([key, value]) => /ttl|expire|autostop|autodelete|autoarchive|allowlist|blockall|ephemeral|^user$|^state$|^labels$|^public$/i.test(key) && (value === null || ['string', 'number', 'boolean'].includes(typeof value) || key === 'labels')));
    console.info('[qa.live.orphan] reported', JSON.stringify({ ...reported, domainAllowList: typeof reported.domainAllowList === 'string' ? (reported.domainAllowList.trim().toLowerCase() === config.proxyUrl.hostname.toLowerCase() ? 'the proxy host only' : 'OTHER') : reported.domainAllowList }));
    expect(String(raw.domainAllowList ?? '').trim().toLowerCase()).toBe(config.proxyUrl.hostname.toLowerCase());
    expect(raw.autoStopInterval).toBe(0);
    expect(raw.autoDeleteInterval).toBe(0); // ephemeral: deleted as soon as it stops
    expect(raw.user).toBe('radar-agent');
    expect((raw.labels as Record<string, string>).workload).toBe(SANDBOX_WORKLOAD);
    expect(raw.public === true).toBe(false);

    // The refusals that protect the other workloads in this organization.
    await expect(provider.destroyMatching({ workload: 'thally-docs-agent', entry: entryA }, 30)).rejects.toThrow(/workload and entry/);
    await expect(provider.destroyMatching({ workload: SANDBOX_WORKLOAD }, 30)).rejects.toThrow(/workload and entry/);
    await expect(provider.destroyMatching({}, 30)).rejects.toThrow(/workload and entry/);

    // What the next attempt for entry A does first.
    const deleted = await provider.destroyMatching({ workload: SANDBOX_WORKLOAD, env: 'development', entry: entryA }, 60);
    expect(deleted).toBe(1);
    const listed = async (entry: string) => { const ids: string[] = []; for await (const item of client.list({ labels: { workload: SANDBOX_WORKLOAD, entry } })) ids.push(item.id); return ids; };
    let remainingA = await listed(entryA);
    for (const startedAt = Date.now(); remainingA.length && Date.now() - startedAt < 45_000;) { await new Promise(resolve => setTimeout(resolve, 3000)); remainingA = await listed(entryA); }
    expect(remainingA).toEqual([]);
    expect(await listed(entryB)).toEqual([b.id]); // the other entry's sandbox is untouched
    expect((await b.exec('true', { timeoutSec: 30 })).exitCode).toBe(0);
    // A second sweep for A finds nothing; a handle whose sandbox is already gone destroys cleanly.
    expect(await provider.destroyMatching({ workload: SANDBOX_WORKLOAD, env: 'development', entry: entryA }, 60)).toBe(0);
    await a.destroy(30);
    await b.destroy(SANDBOX_BUDGET.destroySec);
    let remainingB = await listed(entryB);
    for (const startedAt = Date.now(); remainingB.length && Date.now() - startedAt < 45_000;) { await new Promise(resolve => setTimeout(resolve, 3000)); remainingB = await listed(entryB); }
    expect(remainingB).toEqual([]);
    console.info('[qa.live.orphan] swept', JSON.stringify({ deletedForEntryA: deleted, entryBSurvivedSweep: true, bothGone: true }));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// SBX-6, the worker-death bound: is the hard TTL really enforced by this Daytona organization? One sandbox is created
// through the product's provider with a one-minute TTL and then left alone, as a killed worker would leave it.
//   RADAR_QA_LIVE_TTL=1  one real sandbox, no model call; deleted here if Daytona does not delete it

const TTL = READY && process.env.RADAR_QA_LIVE_TTL === '1';
describe.skipIf(!TTL)('an abandoned sandbox is destroyed by its TTL (live, no model call)', { timeout: 600_000 }, () => {
  it('disappears on its own within a few minutes of a one-minute TTL', async () => {
    const config = configured();
    const entry = `e_qa_ttl_${Date.now().toString(36)}`;
    const createdAt = Date.now();
    const handle = await daytonaProvider(config.daytonaKey).create({ snapshotId: config.snapshotId, allowDomain: config.proxyUrl.hostname.toLowerCase(), ttlMinutes: 1, labels: { workload: SANDBOX_WORKLOAD, env: 'development', entry, run: randomUUID() }, env: { ...SANDBOX_ENV }, timeoutSec: SANDBOX_BUDGET.createSec });
    const { Daytona } = await import('@daytona/sdk');
    const client = new Daytona({ apiKey: config.daytonaKey, apiUrl: DAYTONA_API_URL });
    const raw = await client.get(handle.id) as unknown as Record<string, unknown>;
    const lifetimeKeys = Object.keys(raw).filter(key => /ttl|expir|lifetime|deadline|autodelete|autostop/i.test(key));
    const listed = async () => { const ids: string[] = []; for await (const item of client.list({ labels: { workload: SANDBOX_WORKLOAD, entry } })) ids.push(item.id); return ids; };
    expect(await listed()).toEqual([handle.id]);
    let goneAfterMs: number | null = null;
    try {
      for (const limit = createdAt + 300_000; Date.now() < limit;) {
        await new Promise(resolve => setTimeout(resolve, 10_000));
        if (!(await listed()).length) { goneAfterMs = Date.now() - createdAt; break; }
      }
    } finally {
      if (goneAfterMs === null) await handle.destroy(SANDBOX_BUDGET.destroySec).catch(() => {});
    }
    console.info('[qa.live.ttl]', JSON.stringify({ sandbox: handle.id, ttlMinutes: 1, lifetimeFieldsReported: lifetimeKeys.map(key => `${key}=${String(raw[key])}`), goneWithoutBeingDeletedAfterSeconds: goneAfterMs === null ? null : Math.round(goneAfterMs / 1000) }));
    expect(goneAfterMs, 'Daytona did not destroy the sandbox within 5 minutes of a 1-minute TTL; QA deleted it').not.toBeNull();
    expect(goneAfterMs!).toBeGreaterThan(45_000); // it was the TTL, not an early failure
  });
});
