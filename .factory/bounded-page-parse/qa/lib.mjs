// QA harness (T2). Run with `npx tsx <probe>.mjs` from the root of the checkout under test (the branch worktree or a
// checkout of the base): the code under test is imported from QA_ROOT (default: the working directory), the site is a
// function behind a stubbed global fetch, DNS answers a public address, and nothing reaches the network.
import path from 'node:path';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { execFile } from 'node:child_process';
import { monitorEventLoopDelay } from 'node:perf_hooks';
const require = createRequire(import.meta.url);

export const ROOT = process.env.QA_ROOT || process.cwd();
export const DOMAIN = 'site.example', O = 'https://site.example';

// Files a brand detection stores go to a scratch directory, not into the checkout.
if (process.env.QA_STORAGE) process.env.STORAGE_DIR = path.relative(process.cwd(), process.env.QA_STORAGE);
delete process.env.RADAR_DEV_STUBS;

// Every child process this process starts is recorded (the page reader is one).
export const children = [];
const cp = require('node:child_process');
const realSpawn = cp.spawn;
cp.spawn = function (...args) { const child = realSpawn.apply(this, args); children.push(child); return child; };
syncBuiltinESMExports();

const dns = require('node:dns/promises');
dns.lookup = async () => [{ address: '93.184.216.34', family: 4 }];

export const asked = [];
let serving = () => undefined;
/** site: (URL) => { type?, body?: string | Buffer, status?, redirect?, fail? } | undefined, or a table of paths. */
export function serve(site) { asked.length = 0; serving = typeof site === 'function' ? site : url => (url.host === DOMAIN || url.host === 'www.' + DOMAIN ? site[url.pathname + url.search] ?? site[url.pathname] : { fail: true }); }
globalThis.fetch = async href => {
  const url = new URL(String(href)); asked.push(url.pathname.length > 200 ? url.pathname.slice(0, 60) + `…(${url.pathname.length})` : url.pathname + url.search);
  // A real fetch waits on the network, so the event loop turns between a request and its answer; so does this one.
  // Without that, a crawl of many failing addresses would run from microtask to microtask and a late timer here would
  // say nothing about any one stretch of work.
  await new Promise(resolve => setImmediate(resolve));
  const file = serving(url);
  if (file?.fail) throw new TypeError('fetch failed');
  if (!file) return new Response('<!doctype html><html><head><title>Not found</title></head><body><h1>Not found</h1></body></html>', { status: 404, headers: { 'content-type': 'text/html' } });
  if (file.redirect) return new Response(null, { status: 301, headers: { location: file.redirect } });
  return new Response(file.body ?? '', { status: file.status ?? 200, headers: { 'content-type': file.type ?? 'text/html; charset=utf-8' } });
};

export const html = body => ({ type: 'text/html; charset=utf-8', body });
export const xml = body => ({ type: 'application/xml', body });
export const linking = (title, paths, extra = '') => html(`<!doctype html><html lang="en"><head><title>${title}</title></head><body><h1>${title}</h1>${paths.map(p => `<a href="${p}">${p}</a>`).join('')}${extra}</body></html>`);

export async function load() {
  const at = f => path.join(ROOT, 'src/server/services/analysis', f);
  const crawl = await import(at('crawl.ts'));
  const brand = await import(at('brand.ts'));
  let reader = null; try { reader = await import(at('pageReader.ts')); } catch { /* the base has none */ }
  return { crawlSite: crawl.crawlSite, CrawlError: crawl.CrawlError, detectBrand: brand.detectBrand, reader };
}

/** How late a 10 ms timer in this process ever was (AC3), and the event-loop delay histogram's maximum beside it. */
export function monitor() {
  let late = 0, last = performance.now();
  const tick = setInterval(() => { const now = performance.now(); late = Math.max(late, now - last - 10); last = now; }, 10);
  const h = monitorEventLoopDelay({ resolution: 10 }); h.enable();
  return { get late() { return late; }, stop() { clearInterval(tick); h.disable(); const now = performance.now(); late = Math.max(late, now - last - 10); return { lateMs: Math.round(late * 10) / 10, loopMaxMs: Math.round(h.max / 1e5) / 10 }; } };
}

export async function timed(work) {
  const began = performance.now(); let value, error;
  try { value = await work(); } catch (e) { error = e; }
  return { value, error, ms: Math.round(performance.now() - began) };
}
export const describeError = e => e == null ? null : `${e.constructor?.name}${e.reason ? `(${e.reason})` : ''}: ${String(e.message).slice(0, 160)}`;

const ps = (args) => new Promise(resolve => execFile('/bin/ps', args, (_e, out) => resolve(String(out || ''))));
/** Resident memory of a process in MB, or 0 when it is gone. */
export const rssMb = async pid => Math.round((parseInt((await ps(['-o', 'rss=', '-p', String(pid)])).trim()) || 0) / 1024);
export const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** Samples the resident memory of every recorded child and of this process until stopped. */
export function watchMemory(everyMs = 100) {
  let reader = 0, caller = 0, on = true;
  const loop = (async () => { while (on) { for (const c of children) if (c.pid && c.exitCode === null && c.signalCode === null) reader = Math.max(reader, await rssMb(c.pid)); caller = Math.max(caller, Math.round(process.memoryUsage().rss / 1048576)); await new Promise(r => setTimeout(r, everyMs)); } })();
  return { async stop() { on = false; await loop; return { readerRssMb: reader, callerRssMb: caller }; } };
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const mb = s => Math.round((typeof s === 'string' ? Buffer.byteLength(s) : s.length) / 1048576 * 100) / 100;
export const log = row => console.log(JSON.stringify(row));
