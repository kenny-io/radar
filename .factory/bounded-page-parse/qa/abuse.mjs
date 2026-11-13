// The reader as a process, abused from the calling process (AC5, AC8): it is killed, stopped and cut off at awkward
// moments, the caller is kept busy, and many reads are asked for at once. One JSON line per scenario; the last line
// counts unhandled rejections and uncaught exceptions in the caller (the worker ends itself on either).
// npx tsx .factory/bounded-page-parse/qa/abuse.mjs [scenario filter]
import { load, children, alive, sleep, log, O, describeError, timed } from './lib.mjs';
const filter = process.argv[2] || '';
const { reader } = await load();
const { readPage, readBrandPage, readSitemap, PageUnreadable } = reader;
let unhandled = 0; process.on('unhandledRejection', e => { unhandled++; log({ unhandledRejection: String(e && e.stack || e).slice(0, 300) }); }); process.on('uncaughtException', e => { unhandled++; log({ uncaughtException: String(e && e.stack || e).slice(0, 300) }); });
const small = (t = 'Small') => `<!doctype html><html lang="en"><head><title>${t}</title></head><body><h1>${t}</h1><a href="/next">n</a></body></html>`;
const STALLS = `<!doctype html><html><body>${'<div>'.repeat(64_000)}`;
const SLOW = `<!doctype html><html><body>${'<a><table>'.repeat(80_000)}`; // about 3 s of honest work, then an answer
const last = () => children[children.length - 1];
const kind = o => o.error ? describeError(o.error) : 'read';
const page = (text, o) => readPage(text, O + '/p', O, o);
const map = o => readSitemap('<urlset><url><loc>/x</loc></url></urlset>', O + '/s.xml', 'site.example', o);
const gone = async (pid, within = 3000) => { for (const end = Date.now() + within; Date.now() < end;) { if (!alive(pid)) return true; await sleep(10); } return !alive(pid); };
const stopReader = async () => { await map({ idleMs: 1 }); const c = last(); await gone(c.pid); };
const scenarios = {
  async 'the reader is killed before its first message'() {
    await stopReader(); const before = children.length;
    const read = timed(() => page(small())); const child = children[before]; child.kill('SIGKILL');
    const first = await read; const next = await timed(() => page(small('After')));
    return { first: kind(first), firstMs: first.ms, next: kind(next), nextTitle: next.value?.title };
  },
  async 'the reader is killed (SIGKILL) 300 ms into a stalling document'() {
    await map(); const child = last(); const read = timed(() => page(STALLS)); await sleep(300); process.kill(child.pid, 'SIGKILL');
    const first = await read; const next = await timed(() => page(small('After')));
    return { first: kind(first), firstMs: first.ms, next: kind(next), newReader: last() !== child };
  },
  async 'the reader is ended (SIGTERM) 300 ms into a stalling document'() {
    await map(); const child = last(); const read = timed(() => page(STALLS)); await sleep(300); process.kill(child.pid, 'SIGTERM');
    const first = await read; const next = await timed(() => page(small('After')));
    return { first: kind(first), firstMs: first.ms, next: kind(next) };
  },
  async 'the reader is frozen (SIGSTOP) inside an ordinary document'() {
    await map(); const child = last(); process.kill(child.pid, 'SIGSTOP'); const first = await timed(() => page(small()));
    const dead = await gone(child.pid); const next = await timed(() => page(small('After')));
    return { first: kind(first), firstMs: first.ms, frozenReaderGone: dead, next: kind(next) };
  },
  async 'the reader is killed between two reads, and the next read is asked for at once'() {
    await map(); const child = last(); process.kill(child.pid, 'SIGKILL');
    const first = await timed(() => page(small('Straight after the kill'))); const next = await timed(() => page(small('After')));
    return { first: kind(first), firstMs: first.ms, next: kind(next), note: 'the first document here is ordinary and was never read' };
  },
  async 'the reader is killed between two reads, and the next read is asked for 100 ms later'() {
    await map(); const child = last(); process.kill(child.pid, 'SIGKILL'); await sleep(100);
    const first = await timed(() => page(small())); return { first: kind(first), firstMs: first.ms };
  },
  async 'the reader ends itself between two reads (its channel is closed from here)'() {
    await map(); const child = last(); child.disconnect();
    const first = await timed(() => page(small())); await sleep(100); const next = await timed(() => page(small()));
    return { first: kind(first), next: kind(next), oldReaderGone: await gone(child.pid) };
  },
  async 'the reader is killed while six reads wait behind a stalling one'() {
    await map(); const child = last();
    const all = [timed(() => page(STALLS)), ...[1, 2, 3].map(i => timed(() => page(small('P' + i)))), timed(() => readBrandPage(small(), O)), timed(() => map()), timed(() => page(small('P6')))];
    await sleep(300); process.kill(child.pid, 'SIGKILL');
    const done = await Promise.all(all);
    return { outcomes: done.map(kind), ms: done.map(d => d.ms), titles: done.map(d => d.value?.title) };
  },
  async 'three stalling documents and three ordinary ones asked for at once'() {
    const began = performance.now();
    const all = [STALLS, small('A'), STALLS, small('B'), STALLS, small('C')].map(text => timed(() => page(text)));
    const done = await Promise.all(all);
    return { outcomes: done.map(kind), ms: done.map(d => d.ms), totalMs: Math.round(performance.now() - began), note: 'each ordinary page waits behind every stalling one before it' };
  },
  async '300 reads of all three kinds asked for at once'() {
    const began = performance.now();
    const all = Array.from({ length: 300 }, (_, i) => i % 3 === 0 ? page(small('T' + i)).then(v => v.title === 'T' + i) : i % 3 === 1 ? readBrandPage(small(), O).then(v => v.htmlLang === 'en') : readSitemap(`<urlset><url><loc>/u${i}</loc></url></urlset>`, O + '/s.xml', 'site.example').then(v => v.urls[0] === `${O}/u${i}`));
    const done = await Promise.allSettled(all); const child = last();
    return { right: done.filter(d => d.status === 'fulfilled' && d.value === true).length, of: 300, ms: Math.round(performance.now() - began), listeners: ['message', 'exit', 'error', 'disconnect', 'close'].map(e => `${e}:${child.listenerCount(e)}`).join(' '), timers: process.getActiveResourcesInfo().filter(r => r === 'Timeout').length };
  },
  async 'the caller is busy for 6 s while an ordinary document is read (the answer arrives in milliseconds)'() {
    await map(); const child = last();
    const read = timed(() => page(small('Ordinary')));
    await sleep(0); const until = Date.now() + 6000; while (Date.now() < until) { /* this process is busy, as it is while it checks links against robots rules */ }
    const first = await read; const next = await timed(() => page(small('After')));
    return { first: kind(first), firstMs: first.ms, readerWasKilled: last() !== child || !alive(child.pid), next: kind(next), expected: 'read: the document is ordinary and its answer was waiting' };
  },
  async 'the caller is busy for 4 s while an ordinary document is read'() {
    await map(); const read = timed(() => page(small('Ordinary')));
    await sleep(0); const until = Date.now() + 4000; while (Date.now() < until) { /* busy */ }
    const first = await read; return { first: kind(first), firstMs: first.ms };
  },
  async 'the caller is busy for 8 s while a stalling document is read (the reader must end itself at 7 s)'() {
    await map(); const child = last(); const began = Date.now();
    const read = timed(() => page(STALLS));
    await sleep(0); let goneAt = 0; const until = Date.now() + 8000; while (Date.now() < until) { if (!goneAt && Date.now() % 50 === 0 && !alive(child.pid)) goneAt = Date.now() - began; }
    const first = await read; return { first: kind(first), firstMs: first.ms, readerGoneAtMs: goneAt || 'still running at 8 s' };
  },
  async 'a slow honest document (about 3 s) is read, not cut short, and the next waits its turn'() {
    const all = await Promise.all([timed(() => page(SLOW)), timed(() => page(small('Behind')))]);
    return { outcomes: all.map(kind), ms: all.map(d => d.ms) };
  },
  async 'reads asked for just as the idle time runs out (50 tries, idle 20 ms)'() {
    let ok = 0; const errors = [];
    for (let i = 0; i < 50; i++) { await map({ idleMs: 20 }); await sleep(17 + (i % 7)); const r = await timed(() => map({ idleMs: 20 })); if (!r.error && r.value.urls.length === 1) ok++; else errors.push(kind(r)); }
    return { ok, of: 50, errors: [...new Set(errors)] };
  },
  async 'no reader is left when this process has nothing to do (checked by the driver)'() { return { reader: last()?.pid, readersStarted: children.length, zombies: children.filter(c => c.exitCode === null && c.signalCode === null).length }; },
};
for (const [name, run] of Object.entries(scenarios)) {
  if (filter && !name.includes(filter)) continue;
  let row; try { row = await run(); } catch (e) { row = { threw: describeError(e) }; }
  log({ scenario: name, ...row });
}
await sleep(50);
log({ done: true, unhandledInCaller: unhandled, readersStarted: children.length, stillRunning: children.filter(c => c.exitCode === null && c.signalCode === null).map(c => c.pid) });
