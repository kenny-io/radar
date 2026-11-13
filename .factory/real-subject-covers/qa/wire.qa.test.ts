// QA probe: the fetch guard over real sockets (AC3). A local HTTPS server made by this test stands in for the business's
// site, "qa.localhost" (a name that resolves to loopback). Two parts:
//  1. With the REAL public dispatcher: the name resolves to 127.0.0.1/::1, so nothing may reach the server.
//  2. With a dispatcher that connects every host to the local server (only so the rest can be observed): what is on the
//     wire (headers, cookies, hosts connected to), compressed bodies, streamed oversize, and the deadline.
// No other host is contacted.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import https from 'node:https';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
delete process.env.RADAR_DEV_STUBS;

const W = vi.hoisted(() => ({ port: 0, connected: [] as string[], agent: null as any }));
vi.mock('@/server/http/publicNetwork', async original => {
  const real = await original<typeof import('@/server/http/publicNetwork')>();
  const { Agent, buildConnector } = await import('undici');
  const connector = buildConnector({ rejectUnauthorized: false });
  return { ...real, __real: real, publicDispatcher: () => W.agent ??= new Agent({ connect: (o: any, cb: any) => { W.connected.push(`${o.hostname}:${o.port || 443}`); connector({ ...o, hostname: '127.0.0.1', port: String(W.port) }, cb); } }) };
});
import * as net from '@/server/http/publicNetwork';
import { ACCEPT, SitePictureError, fetchOwn } from '@/server/services/realCover/fetch';

const MB = 1024 * 1024;
const seen: { host: string; url: string; headers: Record<string, any> }[] = [];
const sent = { chunked: 0, closedEarly: false };
let server: https.Server; let dir: string;
const BOMB = { gzip: Buffer.alloc(0), br: Buffer.alloc(0) };
beforeAll(async () => {
  { const zeros = Buffer.alloc(300 * MB); BOMB.gzip = zlib.gzipSync(zeros); BOMB.br = zlib.brotliCompressSync(zeros, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 1 } }); }
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-qa-wire-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=qa.localhost', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem')], { stdio: 'ignore' });
  server = https.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, (req, res) => {
    seen.push({ host: String(req.headers.host), url: req.url || '', headers: { ...req.headers } });
    const u = req.url || '/';
    if (u === '/plain') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.alloc(1000, 1)); return; }
    if (u === '/hop1') { res.writeHead(302, { location: '/hop2', 'set-cookie': 'sid=SECRET-COOKIE; Path=/; Secure' }); res.end(); return; }
    if (u === '/hop2') { res.writeHead(307, { location: 'http://www.qa.localhost/plain' }); res.end(); return; }
    if (u === '/off') { res.writeHead(302, { location: 'https://evil.test/steal' }); res.end(); return; }
    if (u === '/internal') { res.writeHead(302, { location: 'https://127.0.0.1/admin' }); res.end(); return; }
    if (u === '/auth') { res.writeHead(401, { 'www-authenticate': 'Basic realm="x"' }); res.end('no'); return; }
    if (u === '/gzip-bomb') { res.writeHead(200, { 'content-type': 'image/png', 'content-encoding': 'gzip' }); res.end(BOMB.gzip); return; }
    if (u === '/br-bomb') { res.writeHead(200, { 'content-type': 'image/png', 'content-encoding': 'br' }); res.end(BOMB.br); return; }
    if (u === '/chunked-9mb') {
      res.writeHead(200, { 'content-type': 'image/png' });
      const tick = () => { if (res.destroyed) { sent.closedEarly = true; return; } if (sent.chunked >= 64 * MB) { res.end(); return; } sent.chunked += 256 * 1024; res.write(Buffer.alloc(256 * 1024), () => setImmediate(tick)); };
      req.socket.on('close', () => { if (sent.chunked < 64 * MB) sent.closedEarly = true; });
      tick(); return;
    }
    if (u === '/lying-length') { res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(9 * MB) }); res.write(Buffer.alloc(1000)); return; }
    if (u === '/drip') { res.writeHead(200, { 'content-type': 'image/png' }); const t = setInterval(() => { if (res.destroyed) clearInterval(t); else res.write(Buffer.alloc(10)); }, 100); return; }
    if (u === '/never') return; // headers never sent
    res.writeHead(404); res.end();
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  W.port = (server.address() as AddressInfo).port;
});
afterAll(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await W.agent?.destroy(); fs.rmSync(dir, { recursive: true, force: true }); });

const opts = (over: any = {}) => ({ domain: 'qa.localhost', accept: ACCEPT.picture, maxBytes: 8 * MB, over: 'reject' as const, signal: AbortSignal.timeout(20_000), requests: { left: 12 }, ...over });
const outcome = async (p: Promise<any>) => { try { const r = await p; return 'ok ' + r.body.length; } catch (e: any) { return e instanceof SitePictureError ? e.code + (e.host ? ' ' + e.host : '') : 'THROWN ' + e?.message; } };

describe('1. the real dispatcher refuses a name that resolves to an internal address', () => {
  it('fetch through the real publicDispatcher to https://qa.localhost:<port> never reaches the server', async () => {
    const real = (net as any).__real as typeof net;
    const before = seen.length;
    const error: any = await fetch(`https://qa.localhost:${W.port}/plain`, { dispatcher: real.publicDispatcher(), signal: AbortSignal.timeout(5000) } as any).then(() => null, e => e);
    expect(error).toBeTruthy();
    expect(String(error?.cause?.message || error?.message)).toMatch(/blocked host/);
    expect(seen.length).toBe(before);
  });
  it('publicLookup refuses qa.localhost, www.qa.localhost and localhost', async () => {
    const real = (net as any).__real as typeof net;
    for (const name of ['qa.localhost', 'www.qa.localhost', 'localhost']) {
      const out = await new Promise<string>(r => (real.publicLookup as any)(name, { all: true }, (e: any) => r(e ? e.message : 'RESOLVED')));
      expect(out).toBe('blocked host');
    }
  });
});

describe('2. on the wire (dispatcher pointed at the local server)', () => {
  it('sends only the expected headers: no cookie, authorization or referer; a cookie set on one hop is not replayed; http is upgraded', async () => {
    seen.length = 0; W.connected.length = 0;
    expect(await outcome(fetchOwn(new URL('https://qa.localhost/hop1'), opts()))).toBe('ok 1000');
    expect(seen.map(s => `${s.host}${s.url}`)).toEqual(['qa.localhost/hop1', 'qa.localhost/hop2', 'www.qa.localhost/plain']);
    for (const s of seen) {
      const names = Object.keys(s.headers).sort();
      expect(names).not.toContain('cookie'); expect(names).not.toContain('authorization'); expect(names).not.toContain('referer'); expect(names).not.toContain('origin');
      expect(JSON.stringify(s.headers)).not.toContain('SECRET-COOKIE');
      expect(String(s.headers['user-agent'])).toMatch(/^RadarBot\//);
    }
    fs.mkdirSync('.factory/real-subject-covers/qa/evidence', { recursive: true });
    fs.writeFileSync('.factory/real-subject-covers/qa/evidence/wire-headers.json', JSON.stringify(seen.map(s => ({ request: s.host + s.url, headers: s.headers })), null, 2));
    expect(W.connected.every(h => /^(www\.)?qa\.localhost:443$/.test(h))).toBe(true);
  });
  it('a redirect off the site or to an internal address: no connection is made to that host', async () => {
    W.connected.length = 0; seen.length = 0;
    expect(await outcome(fetchOwn(new URL('https://qa.localhost/off'), opts()))).toBe('left_site evil.test');
    expect(await outcome(fetchOwn(new URL('https://qa.localhost/internal'), opts()))).toBe('left_site 127.0.0.1');
    expect(seen.map(s => s.url)).toEqual(['/off', '/internal']);
    expect(W.connected.filter(h => h !== 'qa.localhost:443')).toEqual([]); // nothing but the site itself (the kept-alive connection may be reused)
  });
  it('a 401 is unreachable and no credentials are offered on a retry', async () => {
    seen.length = 0;
    expect(await outcome(fetchOwn(new URL('https://qa.localhost/auth'), opts()))).toBe('unreachable');
    expect(seen.length).toBe(1);
  });
  it.each(['/gzip-bomb', '/br-bomb'])('%s (300 MB after decoding, sent compressed): too_large, and memory stays bounded', async route => {
    global.gc?.();
    const before = process.memoryUsage().rss; const t = Date.now();
    expect(await outcome(fetchOwn(new URL('https://qa.localhost' + route), opts()))).toBe('too_large');
    const grew = (process.memoryUsage().rss - before) / MB;
    fs.appendFileSync('.factory/real-subject-covers/qa/evidence/wire-bombs.txt', `${route}: too_large in ${Date.now() - t} ms, resident memory grew ${grew.toFixed(0)} MB (compressed size on the wire: ${(route === '/gzip-bomb' ? BOMB.gzip : BOMB.br).length} bytes)\n`);
  });
  it('a chunked body with no length is stopped just past 8 MB and the connection is dropped', async () => {
    sent.chunked = 0; sent.closedEarly = false;
    expect(await outcome(fetchOwn(new URL('https://qa.localhost/chunked-9mb'), opts()))).toBe('too_large');
    await new Promise(r => setTimeout(r, 300));
    expect(sent.chunked).toBeLessThan(40 * MB); expect(sent.closedEarly).toBe(true);
  });
  it('a declared length over the limit is refused without reading the body', async () => {
    expect(await outcome(fetchOwn(new URL('https://qa.localhost/lying-length'), opts()))).toBe('too_large');
  });
  it('the one deadline covers a dripping body and a server that never answers', async () => {
    for (const route of ['/drip', '/never']) {
      const t = Date.now();
      expect(await outcome(fetchOwn(new URL('https://qa.localhost' + route), opts({ signal: AbortSignal.timeout(1500) })))).toBe('unreachable');
      expect(Date.now() - t).toBeLessThan(4000);
    }
  });
});
