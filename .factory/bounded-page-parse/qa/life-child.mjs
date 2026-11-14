// One calling process for life.mjs: it reads through crawlSite / the reader as the worker would, tells the driver the
// reader's pid on stdout, and then ends (or is ended by the driver) in the way the scenario names.
import { load, serve, linking, html, children, sleep, O, DOMAIN } from './lib.mjs';
const scenario = process.argv[2];
const say = row => process.stdout.write(JSON.stringify({ t: Date.now(), ...row }) + '\n');
const STALLS = `<!doctype html><html><body>${'<div>'.repeat(64_000)}`;
const { crawlSite, reader } = await load();
say({ self: process.pid });
const site = home => ({ '/': home, '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nAllow: /\n' }, '/a': linking('A', []) });
const pid = () => children[children.length - 1]?.pid;

if (scenario.startsWith('cold-')) {
  // The very first document a new reader gets is the stalling one.
  serve(site(html(STALLS)));
  const crawl = crawlSite(DOMAIN).then(() => say({ settled: 'read' }), e => say({ settled: e.reason || e.message }));
  while (!pid()) await sleep(1);
  say({ reader: pid(), busy: true });
  if (scenario === 'cold-exit') { await sleep(60); process.exit(0); }
  await crawl;
} else {
  serve(site(linking('Home', ['/a'])));
  const first = await crawlSite(DOMAIN);
  say({ reader: pid(), pages: first.pages.length });
  const busy = scenario.includes('busy');
  let crawl = null;
  if (scenario.includes('frozen')) {
    // Round 2: the reader is frozen from outside, then given an ordinary home page; this process has nothing else to do.
    process.kill(pid(), 'SIGSTOP');
    crawl = crawlSite(DOMAIN).then(() => say({ settled: 'read' }), e => say({ settled: e.reason || e.message }));
    await sleep(100); say({ busy: true, reader: pid() });
  }
  if (busy) {
    serve(site(html(STALLS)));
    crawl = crawlSite(DOMAIN).then(() => say({ settled: 'read' }), e => say({ settled: e.reason || e.message }));
    await sleep(400); say({ busy: true, reader: pid() });
  }
  if (scenario.startsWith('return')) { /* nothing more: the process ends when it has nothing left to do */ }
  else if (scenario.startsWith('exit')) process.exit(0);
  else if (scenario.startsWith('throw')) setTimeout(() => { throw new Error('QA: an uncaught exception in the caller'); }, 0);
  else if (scenario.startsWith('reject')) { Promise.reject(new Error('QA: an unhandled rejection in the caller')); }
  else if (scenario.startsWith('wait')) { say({ waiting: true }); await sleep(Number(process.argv[3] || 60_000)); say({ waited: true, readerAlive: (() => { try { process.kill(pid(), 0); return true; } catch { return false; } })() }); if (crawl) await crawl; if (scenario.includes('again')) { serve(site(linking('Home', ['/a']))); const again = await crawlSite(DOMAIN); say({ again: again.pages.length, reader: pid() }); } }
}
