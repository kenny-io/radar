// What a read in flight comes to when the calling process itself is busy for longer than the limit. The worker runs four
// jobs at once on one thread (WORKER_CONCURRENCY), so one job's long synchronous stretch is every other job's too.
//   npx tsx .factory/bounded-page-parse/qa/busy.mjs unit       an ordinary page is being read while the caller is busy 6 s
//   npx tsx .factory/bounded-page-parse/qa/busy.mjs crawls     two crawls at once: site A is the known robots-rules × links
//                                                               stall (out of scope by itself), site B is an ordinary site
// `crawls` runs on the base too (cd <base checkout>; same command with the worktree's path to this file).
import { load, serve, html, linking, log, sleep, describeError, timed, children, alive } from './lib.mjs';
const mode = process.argv[2] || 'unit';
const { crawlSite, reader } = await load();
let unhandled = 0; process.on('unhandledRejection', e => { unhandled++; log({ unhandledRejection: String(e) }); });
const warnings = []; console.warn = (...a) => { warnings.push(a.join(' ').slice(0, 200)); };
const busyFor = ms => { const until = Date.now() + ms; while (Date.now() < until) { /* busy */ } };
const small = t => `<!doctype html><html lang="en"><head><title>${t}</title></head><body><h1>${t}</h1></body></html>`;

if (mode === 'unit') {
  const O = 'https://site.example';
  for (const [where, ms] of [['in a setImmediate callback', 6000], ['in a setImmediate callback', 4000], ['in an I/O callback (a file read)', 6000], ['straight after asking, in the same turn', 6000]]) {
    await reader.readSitemap('<urlset/>', O + '/s.xml', 'site.example'); const child = children[children.length - 1];
    const read = timed(() => reader.readPage(small('Ordinary'), O + '/p', O));
    if (where.startsWith('in a setImmediate')) setImmediate(() => busyFor(ms));
    else if (where.startsWith('in an I/O')) (await import('node:fs')).readFile(new URL(import.meta.url), () => busyFor(ms));
    else busyFor(ms);
    const r = await read;
    log({ scenario: `an ordinary page is read by a warm reader (it answers in a few ms); the caller is busy ${ms / 1000} s ${where}`, outcome: r.error ? describeError(r.error) : 'read', settledAfterMs: r.ms, readerKilled: !alive(child.pid) });
    await sleep(50);
  }
} else {
  // Site A: a robots.txt of 10,000 rules and a home page of 100,000 links. Checking the links against the rules keeps the
  // calling process busy for many seconds (the brief's known follow-up). Site B: a home page and 12 pages, nothing odd.
  const rules = `User-agent: *\n${Array.from({ length: 10_000 }, (_, i) => `Disallow: /private-area-number-${i}/section/\n`).join('')}`;
  const aHome = `<!doctype html><html><head><title>A</title></head><body>${Array.from({ length: 100_000 }, (_, i) => `<a href=/a${i.toString(36)}>`).join('')}</body></html>`;
  const bPaths = Array.from({ length: 12 }, (_, i) => `/page-${i}`);
  const B = { '/': linking('B home', bPaths), '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nAllow: /\n' } };
  for (const p of bPaths) B[p] = linking('B ' + p, []);
  // `midcrawl`: A's first three pages are like its home page, B has 40 pages and its server takes 0.4 s over each, and B starts first.
  const mid = mode === 'midcrawl';
  if (mid) for (let i = 12; i < 40; i++) { bPaths.push(`/page-${i}`); B[`/page-${i}`] = linking(`B /page-${i}`, []); }
  if (mid) B['/'] = linking('B home', bPaths);
  const aPages = mid ? new Set(['/', '/a0', '/a1', '/a2']) : new Set(['/']);
  const answer = url => url.host === 'a.example' ? (aPages.has(url.pathname) ? html(aHome) : url.pathname === '/robots.txt' ? { type: 'text/plain', body: rules } : undefined) : url.host === 'b.example' ? B[url.pathname] : { fail: true };
  serve(answer);
  if (mid) { const stub = globalThis.fetch; globalThis.fetch = async href => { if (String(href).includes('b.example/page-')) await sleep(400); return stub(href); }; }
  const began = performance.now(); const at = () => Math.round(performance.now() - began);
  let late = 0, last = performance.now(); const tick = setInterval(() => { const now = performance.now(); late = Math.max(late, now - last - 10); last = now; }, 10);
  const startA = () => crawlSite('a.example').then(r => ({ a: `${r.pages.length} page(s)`, ms: at() }), e => ({ a: describeError(e), ms: at() }));
  const startB = () => crawlSite('b.example').then(r => ({ b: `${r.pages.length} page(s) of ${bPaths.length + 1}: ${r.pages.map(p => p.path).join(' ')}`, ms: at() }), e => ({ b: describeError(e), ms: at() }));
  let a, b;
  if (mid) { b = startB(); await sleep(300); a = startA(); } // B is already crawling when A's analysis starts
  else { a = startA(); await sleep(Number(process.argv[3] || 150)); b = startB(); } // B's analysis starts a moment after A's
  const [ra, rb] = await Promise.all([a, b]); clearInterval(tick);
  log({ scenario: mid ? 'two crawls at once in one process: B (ordinary, 41 pages, 0.4 s per page) is already crawling when A starts (10,000 robots rules; its home page and three more pages have 100,000 links each)' : 'two crawls at once in one process: A (10,000 robots rules, 100,000 links on its home page) and B (ordinary, 13 pages)', ...ra, B: rb.b, bMs: rb.ms, callerLongestBusyMs: Math.round(late), warnings, expectedForB: `${bPaths.length + 1} page(s), however long A keeps the process` });
}
log({ done: true, unhandled });
