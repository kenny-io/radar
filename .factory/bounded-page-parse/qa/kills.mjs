// Round 2, D4: a reader that ends without the document being the cause gets the document once more. Kills at every
// moment, twice in a row, with a queue behind; a document that itself ends readers is not retried for ever; the order
// of answers is kept. One JSON line per scenario.
//   npx tsx .factory/bounded-page-parse/qa/kills.mjs [filter]
import path from 'node:path';
import { load, children, alive, sleep, log, O, describeError, timed, ROOT } from './lib.mjs';
const filter = process.argv[2] || '';
const { reader } = await load();
const fx = await import(path.join(ROOT, 'src/server/services/analysis/stalling.fixtures.ts'));
let unhandled = 0; process.on('unhandledRejection', e => { unhandled++; log({ unhandledRejection: String(e && e.stack || e).slice(0, 300) }); }); process.on('uncaughtException', e => { unhandled++; log({ uncaughtException: String(e && e.stack || e).slice(0, 300) }); });
const page = (t, n = 0) => `<!doctype html><html lang="en"><head><title>${t}</title></head><body><h1>${t}</h1>${'<p>x</p>'.repeat(n)}<a href="/next">n</a></body></html>`;
const BLOG = fx.ordinary.blogIndex();            // 1.5 MB, about 0.25 s of the reader, an answer of 143 KB
const BIG = `<html><head><style>${'\n'.repeat(1_900_000)}</style>`; // an answer of 3.8 MB
const last = () => children[children.length - 1];
const warm = () => reader.readSitemap('<urlset/>', O + '/s.xml', 'site.example');
const gone = async pid => { while (alive(pid)) await sleep(5); };
const stop = async () => { await reader.readSitemap('<urlset/>', O + '/s.xml', 'site.example', { idleMs: 1 }); await gone(last().pid); };
const kind = r => r.error ? describeError(r.error).replace('The document could not be read: ', '') : 'read';
/** Kills every reader started from now on as soon as it exists, `n` times in all. */
const killNext = n => { let seen = children.length, left = n; const t = setInterval(() => { while (left > 0 && children.length > seen) { const c = children[seen++]; try { process.kill(c.pid, 'SIGKILL'); left--; } catch { /* gone */ } } if (left <= 0) clearInterval(t); }, 1); return () => clearInterval(t); };
const scenarios = {
  async 'a warm reader killed (SIGKILL) at 0 to 400 ms into the 1.5 MB blog index, every 10 ms'() {
    const ref = JSON.stringify(await reader.readPage(BLOG, O + '/blog', O)); const out = {}; let wrong = 0, readers = 0;
    for (let at = 0; at <= 400; at += 10) { await warm(); const child = last(); const before = children.length; const p = timed(() => reader.readPage(BLOG, O + '/blog', O)); setTimeout(() => { try { process.kill(child.pid, 'SIGKILL'); } catch { /* */ } }, at); const r = await p; const k = kind(r); out[k] = (out[k] || 0) + 1; if (!r.error && JSON.stringify(r.value) !== ref) wrong++; readers += children.length - before; }
    return { outcomes: out, wrongAnswers: wrong, secondReadersStarted: readers };
  },
  async 'a new reader killed at 0 to 200 ms after it is started for a 100-byte page, every 5 ms'() {
    const out = {}; let wrong = 0;
    for (let at = 0; at <= 200; at += 5) { await stop(); const before = children.length; const p = timed(() => reader.readPage(page('Cold ' + at), O + '/p', O)); const child = children[before]; setTimeout(() => { try { process.kill(child.pid, 'SIGKILL'); } catch { /* */ } }, at); const r = await p; const k = kind(r); out[k] = (out[k] || 0) + 1; if (!r.error && r.value.title !== 'Cold ' + at) wrong++; }
    return { outcomes: out, wrongAnswers: wrong };
  },
  async 'a reader killed while its 3.8 MB answer is on its way, at 150 to 400 ms, every 10 ms'() {
    const ref = JSON.stringify(await reader.readBrandPage(BIG, O)); const out = {}; let wrong = 0;
    for (let at = 150; at <= 400; at += 10) { await warm(); const child = last(); const p = timed(() => reader.readBrandPage(BIG, O)); setTimeout(() => { try { process.kill(child.pid, 'SIGKILL'); } catch { /* */ } }, at); const r = await p; const k = kind(r); out[k] = (out[k] || 0) + 1; if (!r.error && JSON.stringify(r.value) !== ref) wrong++; }
    return { outcomes: out, wrongAnswers: wrong };
  },
  async 'each other signal from outside, 100 ms into the blog index'() {
    const out = {};
    for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT', 'SIGSEGV', 'SIGABRT', 'SIGUSR2', 'SIGPIPE', 'SIGALRM']) { await warm(); const before = children.length; const child = children.filter(c => c.exitCode === null && c.signalCode === null).at(-1); const p = timed(() => reader.readPage(BLOG, O + '/blog', O)); await sleep(100); let sent = 'sent'; try { process.kill(child.pid, sig); } catch (e) { sent = 'not sent: ' + e.code; } const r = await p; out[sig] = `${sent}; ${kind(r)} after ${r.ms} ms; reader ended with ${child.signalCode ?? child.exitCode ?? 'nothing (still running)'}; ${children.length - before} more reader(s) started`; await sleep(50); }
    return out;
  },
  async 'two readers in a row killed with the same ordinary page; the next page after it'() {
    await stop(); const before = children.length; const off = killNext(2);
    const first = await timed(() => reader.readPage(page('Twice'), O + '/p', O)); off(); const next = await timed(() => reader.readPage(page('After'), O + '/p', O));
    return { first: kind(first), next: kind(next), nextTitle: next.value?.title, readersStarted: children.length - before };
  },
  async 'three readers in a row killed, six pages asked for at once'() {
    await stop(); const before = children.length; const off = killNext(3); const order = [];
    const all = [1, 2, 3, 4, 5, 6].map(i => timed(() => reader.readPage(page('P' + i), O + '/p', O).then(v => { order.push(i); return v; }, e => { order.push(i); throw e; })));
    const done = await Promise.all(all); off();
    return { outcomes: done.map(kind), titles: done.map(d => d.value?.title ?? null), settledInOrder: order.join(''), readersStarted: children.length - before };
  },
  async 'the reader killed while six reads wait behind a 3 s page'() {
    await warm(); const child = last(); const order = [];
    const docs = [`<html><head><title>Slow</title></head><body>${'<a><table>'.repeat(80_000)}`, page('P1'), page('P2'), page('P3'), page('P4'), page('P5'), page('P6')];
    const all = docs.map((d, i) => timed(() => reader.readPage(d, O + '/p', O).then(v => { order.push(i); return v; })));
    await sleep(1000); process.kill(child.pid, 'SIGKILL'); const done = await Promise.all(all);
    return { outcomes: done.map(kind), titles: done.map(d => d.value?.title ?? null), settledInOrder: order.join(''), ms: done.map(d => d.ms) };
  },
  async 'the out-of-memory page: how many readers end, and how long it takes'() {
    await warm(); const before = children.length; const counted = [];
    const r = await timed(() => reader.readPage(fx.stalling.openFonts(30_000), O + '/p', O, { spent: ms => counted.push(ms) }));
    const next = await timed(() => reader.readPage(page('After'), O + '/p', O));
    return { outcome: kind(r), ms: r.ms, readersEnded: children.slice(before - 1).filter(c => c.signalCode === 'SIGABRT').length, readersStartedForIt: children.length - before - 1, countedMs: counted, next: kind(next) };
  },
  async 'the out-of-memory page five times running, then ordinary pages'() {
    const ms = []; const outs = [];
    for (let i = 0; i < 5; i++) { const r = await timed(() => reader.readPage(fx.stalling.openFonts(30_000), O + '/p', O)); ms.push(r.ms); outs.push(kind(r).slice(0, 30)); }
    const after = await Promise.all([1, 2, 3].map(i => timed(() => reader.readPage(page('A' + i), O + '/p', O))));
    return { outcomes: [...new Set(outs)], ms, after: after.map(kind) };
  },
  async 'a page that takes 4 s and then runs the reader out of memory would take two limits: a 4.5 s page killed from outside at 4 s, twice'() {
    await warm(); const before = children.length; let n = 0;
    const t = setInterval(() => { for (const c of children.slice(before - 1)) if (c.exitCode === null && c.signalCode === null && !c.qaTimer) { c.qaTimer = setTimeout(() => { try { process.kill(c.pid, 'SIGKILL'); n++; } catch { /* */ } }, 4000); } }, 5);
    const r = await timed(() => reader.readPage(`<html><body>${'<a><table>'.repeat(95_000)}`, O + '/p', O)); clearInterval(t);
    for (const c of children) if (c.qaTimer) clearTimeout(c.qaTimer);
    return { outcome: kind(r), ms: r.ms, kills: n, note: 'the longest a document can hold the reader: twice its limit' };
  },
  async 'killed between two reads, the next asked for at once (round 1, D4)'() {
    await warm(); const child = last(); process.kill(child.pid, 'SIGKILL');
    const r = await timed(() => reader.readPage(page('Straight after'), O + '/p', O)); return { outcome: kind(r), title: r.value?.title };
  },
  async 'killed before its first message (round 1, D4)'() {
    await stop(); const before = children.length; const p = timed(() => reader.readPage(page('First'), O + '/p', O)); children[before].kill('SIGKILL'); const r = await p;
    return { outcome: kind(r), title: r.value?.title, readersStarted: children.length - before };
  },
};
for (const [name, run] of Object.entries(scenarios)) {
  if (filter && !name.includes(filter)) continue;
  let row; try { row = await run(); } catch (e) { row = { threw: describeError(e) }; }
  log({ scenario: name, ...row });
}
await sleep(100);
log({ done: true, unhandledInCaller: unhandled, readersStarted: children.length, stillRunning: children.filter(c => c.exitCode === null && c.signalCode === null).length });
