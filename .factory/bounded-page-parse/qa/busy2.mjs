// Round 2, D1: the limit is now the reader's. Is any ordinary read still lost when the calling process is busy, in
// whatever way and at whatever moment, for answers of every size up to the 8 MB cap? One JSON line per case.
//   npx tsx .factory/bounded-page-parse/qa/busy2.mjs [group filter: solid | choppy | retry | queue | stall | frozen | self]
import path from 'node:path';
import { spawn as spawnProcess } from 'node:child_process';
import { load, children, alive, sleep, log, O, describeError, timed, ROOT } from './lib.mjs';
const filter = process.argv[2] || '';
const { reader } = await load();
const fx = await import(path.join(ROOT, 'src/server/services/analysis/stalling.fixtures.ts'));
let unhandled = 0; process.on('unhandledRejection', e => { unhandled++; log({ unhandledRejection: String(e && e.stack || e).slice(0, 300) }); }); process.on('uncaughtException', e => { unhandled++; log({ uncaughtException: String(e && e.stack || e).slice(0, 300) }); });
const busyFor = ms => { const until = Date.now() + ms; while (Date.now() < until) { /* this process's one thread is held */ } };
/** Busy in pieces: `chunk` ms of work in every turn of the event loop, for `total` ms. Between two pieces the loop does turn (timers, I/O), once. */
const choppy = (total, chunk) => new Promise(resolve => { const until = Date.now() + total; const piece = () => { busyFor(chunk); if (Date.now() < until) setImmediate(piece); else resolve(); }; setImmediate(piece); });
const last = () => children[children.length - 1];
const small = `<!doctype html><html lang="en"><head><title>Small</title></head><body><h1>Small</h1><a href="/next">n</a></body></html>`;
const STALLS = `<!doctype html><html><body>${'<div>'.repeat(64_000)}`;
const SLOW = n => `<!doctype html><html><head><title>Slow</title></head><body>${'<a><table>'.repeat(n)}</body></html>`;
const rep = (n, f) => { const out = new Array(n); for (let i = 0; i < n; i++) out[i] = f(i); return out.join(''); };
// Documents by the size of their answer. Each is at most 2 MB.
const DOCS = {
  'a 100-byte page (answer 0.2 KB)': { kind: 'page', text: small },
  'the 1.5 MB blog index (answer 0.14 MB)': { kind: 'page', text: fx.ordinary.blogIndex() },
  'a page of 20,000 links (answer 0.5 MB)': { kind: 'page', text: `<html><body>${rep(60_000, i => `<a href=/${i.toString(36)}>`)}` },
  'a sitemap of 45,000 addresses (answer 1.2 MB)': { kind: 'sitemap', text: `<urlset>${rep(45_000, i => `<url><loc>https://site.example/${i.toString(36)}</loc></url>`)}</urlset>` },
  'a home page with 1.9 MB of CSS (answer 1.9 MB)': { kind: 'brand', text: `<html><head><style>${':root{--brand:#2563eb}'.repeat(90_000)}</style>` },
  'a home page with 1.9 MB of blank lines in a style (answer 3.8 MB)': { kind: 'brand', text: `<html><head><style>${'\n'.repeat(1_900_000)}</style>` },
  'a home page with 1.3 MB of control characters in a style (answer 7.8 MB)': { kind: 'brand', text: `<html><head><style>${'\u0001'.repeat(1_300_000)}</style>` },
};
const read = d => d.kind === 'page' ? reader.readPage(d.text, O + '/p', O) : d.kind === 'brand' ? reader.readBrandPage(d.text, O) : reader.readSitemap(d.text, O + '/sitemap.xml', 'site.example');
const warm = () => reader.readSitemap('<urlset/>', O + '/s.xml', 'site.example');
const reference = {}; const mb = v => Math.round(Buffer.byteLength(JSON.stringify(v)) / 10485.76) / 100;
const check = (name, r) => r.error ? describeError(r.error).replace('The document could not be read: ', '') : JSON.stringify(r.value) === reference[name] ? 'read, the same answer as when idle' : 'READ, BUT A DIFFERENT ANSWER';
const want = g => !filter || filter === g;
for (const [name, d] of Object.entries(DOCS)) { if (Buffer.byteLength(d.text) > 2 * 1024 * 1024) throw new Error('over 2 MB: ' + name); const v = await read(d); reference[name] = JSON.stringify(v); log({ group: 'reference', document: name, documentMb: Math.round(Buffer.byteLength(d.text) / 10485.76) / 100, answerMb: mb(v) }); }

if (want('solid')) for (const [name, d] of Object.entries(DOCS)) {
  for (const [when, go] of [['in the same turn, before the document is handed over', ms => busyFor(ms)], ['0.1 s later, the reader at work', async ms => { await sleep(100); busyFor(ms); }], ['0.5 s later, the answer in the channel', async ms => { await sleep(500); busyFor(ms); }], ['in an I/O callback', ms => { setImmediate(() => busyFor(ms)); }]]) {
    await warm(); const before = children.length;
    const r = timed(() => read(d)); await go(8000); const done = await r;
    log({ group: 'solid', document: name, callerBusy: `8 s, ${when}`, outcome: check(name, done), ms: done.ms, newReader: children.length > before });
  }
}
if (want('choppy')) for (const name of ['a 100-byte page (answer 0.2 KB)', 'the 1.5 MB blog index (answer 0.14 MB)', 'a sitemap of 45,000 addresses (answer 1.2 MB)', 'a home page with 1.9 MB of blank lines in a style (answer 3.8 MB)', 'a home page with 1.3 MB of control characters in a style (answer 7.8 MB)']) {
  for (const chunk of [20, 60, 120, 260, 500, 1000]) {
    await warm(); const before = children.length;
    const r = timed(() => read(DOCS[name])); const busy = choppy(15_000, chunk); const done = await r; await busy;
    log({ group: 'choppy', document: name, callerBusy: `${chunk} ms in every turn of its event loop, for 15 s`, outcome: check(name, done), ms: done.ms, newReader: children.length > before });
  }
}
if (want('retry')) for (const name of ['a 100-byte page (answer 0.2 KB)', 'the 1.5 MB blog index (answer 0.14 MB)', 'a home page with 1.9 MB of blank lines in a style (answer 3.8 MB)']) {
  // The reader is killed from outside 50 ms after the document is asked for, and the caller is busy from then for 8 s:
  // it learns of the kill late, and the second try starts late.
  await warm(); const child = last(); const before = children.length;
  const r = timed(() => read(DOCS[name])); spawnProcess('/bin/sh', ['-c', `sleep 0.05; kill -9 ${child.pid}`], { stdio: 'ignore' }).unref(); await sleep(10); busyFor(8000); const done = await r;
  log({ group: 'retry', document: name, what: 'reader killed from outside 50 ms in, caller busy 8 s from then', outcome: check(name, done), ms: done.ms, readersStarted: children.length - before });
}
if (want('queue')) {
  await warm(); const names = Object.keys(DOCS).slice(0, 5);
  const all = names.map(n => timed(() => read(DOCS[n]))); busyFor(8000); const done = await Promise.all(all);
  log({ group: 'queue', what: 'five reads asked for together, then the caller is busy 8 s', outcomes: done.map((d, i) => check(names[i], d)), ms: done.map(d => d.ms) });
  const all2 = [timed(() => reader.readPage(STALLS, O + '/p', O)), ...names.map(n => timed(() => read(DOCS[n])))]; await sleep(50); const busy = choppy(12_000, 300); const done2 = await Promise.all(all2); await busy;
  log({ group: 'queue', what: 'a stalling page and five reads behind it; the caller busy 300 ms in every turn for 12 s', outcomes: [done2[0].error ? describeError(done2[0].error).slice(0, 60) : 'read', ...done2.slice(1).map((d, i) => check(names[i], d))], ms: done2.map(d => d.ms) });
}
if (want('stall')) {
  await warm(); let r = await timed(() => reader.readPage(STALLS, O + '/p', O));
  log({ group: 'stall', what: 'a stalling page, the caller idle', outcome: check('', r), ms: r.ms, signal: children.filter(c => c.signalCode).at(-1)?.signalCode });
  await warm(); const child = last(); const p = timed(() => reader.readPage(STALLS, O + '/p', O)); await sleep(100);
  let goneAt = null; const began = Date.now(); const until = began + 9000; let checked = began;
  const { execFileSync } = await import('node:child_process');
  while (Date.now() < until) { const now = Date.now(); if (goneAt === null && now - checked >= 100) { checked = now; const st = execFileSync('/bin/ps', ['-o', 'stat=', '-p', String(child.pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); if (st === '' || st.startsWith('Z')) goneAt = now - began + 100; } }
  r = await p;
  log({ group: 'stall', what: 'a stalling page, the caller busy 9 s from 0.1 s in', outcome: check('', r), ms: r.ms, readerEndedMsAfterItGotThePage: goneAt, signal: child.signalCode });
  await warm(); r = await timed(() => reader.readPage(fx.stalling.openFonts(30_000), O + '/p', O));
  log({ group: 'stall', what: 'the out-of-memory page, the caller idle (two readers end)', outcome: check('', r), ms: r.ms });
}
if (want('frozen')) {
  await warm(); let child = last(); process.kill(child.pid, 'SIGSTOP');
  let r = await timed(() => reader.readPage(small, O + '/p', O));
  log({ group: 'frozen', what: 'the reader is frozen (SIGSTOP) and stays frozen; a 100-byte page', outcome: check('a 100-byte page (answer 0.2 KB)', r), ms: r.ms, readerGone: !alive(child.pid), signal: child.signalCode });
  await warm(); child = last(); process.kill(child.pid, 'SIGSTOP'); setTimeout(() => process.kill(child.pid, 'SIGCONT'), 6000);
  r = await timed(() => reader.readPage(small, O + '/p', O));
  log({ group: 'frozen', what: 'the reader is frozen before it gets a 100-byte page and thawed 6 s later', outcome: check('a 100-byte page (answer 0.2 KB)', r), ms: r.ms, sameReader: last() === child });
  await warm(); child = last(); let p = timed(() => reader.readPage(SLOW(30_000), O + '/p', O)); await sleep(150); process.kill(child.pid, 'SIGSTOP'); setTimeout(() => { try { process.kill(child.pid, 'SIGCONT'); } catch { /* gone */ } }, 6000);
  r = await p;
  log({ group: 'frozen', what: 'the reader is frozen 0.15 s into a page that takes it half a second, and thawed 6 s later', outcome: r.error ? describeError(r.error).replace('The document could not be read: ', '') : `read (${r.value.title})`, ms: r.ms, signal: child.signalCode, note: 'the reader\'s clock ran while it was frozen' });
  await warm(); child = last(); p = timed(() => reader.readPage(SLOW(30_000), O + '/p', O)); await sleep(150); process.kill(child.pid, 'SIGSTOP'); setTimeout(() => { try { process.kill(child.pid, 'SIGCONT'); } catch { /* gone */ } }, 2000);
  r = await p;
  log({ group: 'frozen', what: 'the same, thawed 2 s later', outcome: r.error ? describeError(r.error).replace('The document could not be read: ', '') : `read (${r.value.title})`, ms: r.ms, signal: child.signalCode });
}
if (want('self')) for (const [what, d, name] of [['the 1.5 MB blog index', DOCS['the 1.5 MB blog index (answer 0.14 MB)'], 'the 1.5 MB blog index (answer 0.14 MB)'], ['a stalling page', { kind: 'page', text: STALLS }, '']]) {
  // This whole process is frozen from outside for 9 s (SIGSTOP, then SIGCONT from a helper), 0.1 s after asking.
  await warm(); const child = last(); const r = timed(() => read(d)); await sleep(100);
  spawnProcess('/bin/sh', ['-c', `kill -STOP ${process.pid}; sleep 9; kill -CONT ${process.pid}`], { stdio: 'ignore' }).unref();
  const done = await r;
  log({ group: 'self', what: `${what}; the calling process itself is frozen for 9 s from 0.1 s in`, outcome: name ? check(name, done) : describeError(done.error).replace('The document could not be read: ', ''), ms: done.ms, signal: child.signalCode });
}
await sleep(50);
log({ done: true, unhandledInCaller: unhandled, readersStarted: children.length });
