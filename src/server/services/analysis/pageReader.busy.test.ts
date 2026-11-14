// The page reader while the process that uses it is busy, and after a reader has been ended from outside. The limit is
// the reader's, by its own clock (D1): a document is not unreadable because this process was late to read its answer.
// A reader that ends without the document being the cause is followed by one more try (D4). The reader is real
// throughout. Where a test keeps this process busy it does so with a loop that really holds the thread, as checking a
// hundred thousand links against robots rules does in the worker.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
const H = vi.hoisted(() => ({ spawn: vi.fn(), start: (..._args: any[]): any => null, children: [] as any[] }));
vi.mock('node:child_process', async original => {
  const real = await original<typeof import('node:child_process')>();
  H.start = (command: string, args: string[], options: any) => { const child = real.spawn(command, args, options); H.children.push(child); return child; };
  H.spawn.mockImplementation(H.start);
  return { ...real, default: { ...real, spawn: H.spawn }, spawn: H.spawn };
});
import fs from 'node:fs';
import { PAGE_READ_MS, PageUnreadable, READER_GRACE_MS, WATCHDOG_SIGNAL, readBrandPage, readPage, readSitemap as readSitemapOf, type ReadOptions } from './pageReader';
import { ordinary, stalling } from './stalling.fixtures';

/** Starts a process this file does not watch or count: a helper, not a reader. */
const { spawn: realSpawn, execFileSync } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
const URL_ = 'https://site.example/dir/page', ORIGIN = 'https://site.example';
const readSitemap = (xml: string, o?: ReadOptions) => readSitemapOf(xml, 'https://site.example/sitemap.xml', 'site.example', o);
const pause = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });
const running = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** Whether the process has ended, also when this process has been too busy to be told: it is gone, or it is waiting to be collected. */
const ended = (pid: number) => { try { const state = execFileSync('/bin/ps', ['-o', 'stat=', '-p', String(pid)]).toString().trim(); return state === '' || state.startsWith('Z'); } catch { return true; } };
async function gone(pid: number, within = 3000) { for (const end = Date.now() + within; Date.now() < end;) { if (!running(pid)) return true; await pause(20); } return !running(pid); }
const lastChild = () => H.children[H.children.length - 1] as ChildProcess;
async function stopReader() { await readSitemap('<urlset/>', { idleMs: 1 }); expect(await gone(lastChild().pid!)).toBe(true); }
/** Holds this process's one thread for `ms`, and notes when `pid` was first seen to have ended, counted from the start. */
function busyFor(ms: number, pid?: number): number | null {
  const began = Date.now(); let endedAt: number | null = null;
  for (let now = began, checked = began; now - began < ms; now = Date.now()) { if (pid && endedAt === null && now - checked >= 50) { checked = now; if (ended(pid)) endedAt = Date.now() - began; } }
  return endedAt;
}
/** Busy in pieces: `piece` ms of work in every turn of this process's event loop, for `total` ms. Between two pieces the loop turns once (timers, one read of each channel). */
const choppy = (total: number, piece: number) => new Promise<void>(done => { const until = Date.now() + total; const turn = () => { busyFor(piece); if (Date.now() < until) setImmediate(turn); else done(); }; setImmediate(turn); });
type Outcome = { value: any; error: any; ms: number };
async function watched(read: () => Promise<unknown>): Promise<Outcome> {
  const began = performance.now(); let value: any = null, error: any = null;
  try { value = await read(); } catch (e) { error = e; }
  return { value, error, ms: performance.now() - began };
}
const reason = (o: Outcome) => (o.error instanceof PageUnreadable ? o.error.reason : o.error ? 'another error: ' + o.error.message : 'read');

beforeEach(() => { H.spawn.mockReset(); H.spawn.mockImplementation(H.start); });
afterAll(async () => { await stopReader(); });

describe('the limit is the reader’s, kept by its own clock; this process only reads the outcome (D1)', () => {
  const small = ordinary.small('Ordinary');
  it('an ordinary page read while this process is busy for six seconds, longer than the limit, is read', async () => {
    await readSitemap('<urlset/>'); const child = lastChild(); H.spawn.mockClear();
    const read = watched(() => readPage(small, URL_, ORIGIN)); // the reader answers in a few milliseconds
    setImmediate(() => busyFor(PAGE_READ_MS + 1000));
    const outcome = await read;
    expect(reason(outcome)).toBe('read'); expect(outcome.value.title).toBe('Ordinary'); expect(outcome.ms).toBeGreaterThan(PAGE_READ_MS + 900); // heard of a second after the limit had passed
    expect(running(child.pid!)).toBe(true); expect(H.spawn).not.toHaveBeenCalled(); // the reader did nothing wrong and is kept
  }, 20_000);
  it.each([
    ['in a callback of its own', (ms: number) => { setImmediate(() => busyFor(ms)); }],
    ['in an I/O callback', (ms: number) => { fs.readFile(__filename, () => busyFor(ms)); }],
    ['in the middle of what it was doing', (ms: number) => { busyFor(ms); }],
  ])('a page with a large answer is read too, however late this process comes to it: busy past the limit and the backstop, %s', async (_name, keepBusy) => {
    // 1.5 MB, an answer of 143 KB: more than the channel holds, so the reader is still writing it when this process is free again.
    const html = ordinary.blogIndex(); const LIMIT = 1000;
    await readSitemap('<urlset/>'); H.spawn.mockClear();
    const read = watched(() => readPage(html, ORIGIN + '/blog', ORIGIN, { timeoutMs: LIMIT }));
    await pause(100); // the reader has the page and is at work on it
    keepBusy(LIMIT + READER_GRACE_MS + 800);
    const outcome = await read;
    expect(reason(outcome)).toBe('read'); expect(outcome.value.links).toHaveLength(4003); expect(H.spawn).not.toHaveBeenCalled();
    expect(await readPage(small, URL_, ORIGIN)).toMatchObject({ title: 'Ordinary' });
  }, 20_000);
  it('a large page asked for just as this process becomes busy cannot even be handed over until it is free: it is read then, with its whole limit', async () => {
    const html = ordinary.blogIndex(); const LIMIT = 1000;
    await readSitemap('<urlset/>'); H.spawn.mockClear();
    const read = watched(() => readPage(html, ORIGIN + '/blog', ORIGIN, { timeoutMs: LIMIT }));
    busyFor(LIMIT + READER_GRACE_MS + 800);
    const outcome = await read;
    expect(reason(outcome)).toBe('read'); expect(outcome.value.links).toHaveLength(4003); expect(H.spawn).not.toHaveBeenCalled();
  }, 20_000);
  it('busy in pieces, 300 ms of work in every turn of its event loop for longer than the limit and the backstop, with megabytes still to pass each way: the page is read', async () => {
    const LIMIT = 500;
    // 0.6 MB of control characters in a <style>: 3.6 MB to hand over as JSON and 3.6 MB of answer, and each turn of a busy process moves one channel-buffer of it.
    const html = `<!doctype html><html lang="en"><head><style>${'\u0001'.repeat(600_000)}</style></head></html>`;
    await readSitemap('<urlset/>'); H.spawn.mockClear();
    const read = watched(() => readBrandPage(html, ORIGIN, { timeoutMs: LIMIT }));
    const began = performance.now();
    await choppy(LIMIT + READER_GRACE_MS + 1500, 300); // some fourteen turns, four more than the backstop would count if busy turns counted
    const outcome = await read;
    expect(reason(outcome)).toBe('read'); expect(outcome.value.css).toHaveLength(600_000); expect(outcome.value.htmlLang).toBe('en');
    expect(H.spawn).not.toHaveBeenCalled(); expect(performance.now() - began).toBeGreaterThan(LIMIT + READER_GRACE_MS + 1500);
  }, 30_000);
  it('a stalling page read while this process is busy is timed_out, and the reader was gone at its limit, not when this process looked', async () => {
    const LIMIT = 600;
    await readSitemap('<urlset/>'); const child = lastChild(); let endedAt: number | null = null;
    const asked = Date.now();
    const read = watched(() => readPage(stalling.nestedDivs(), URL_, ORIGIN, { timeoutMs: LIMIT }));
    await pause(100); // the reader has the page
    const before = Date.now() - asked;
    setImmediate(() => { endedAt = busyFor(LIMIT + READER_GRACE_MS + 800, child.pid!); });
    const outcome = await read;
    expect(reason(outcome)).toBe('timed_out'); expect(child.signalCode).toBe(WATCHDOG_SIGNAL);
    expect(endedAt).not.toBeNull(); expect(before + endedAt!).toBeGreaterThanOrEqual(LIMIT - 50); expect(before + endedAt!).toBeLessThan(LIMIT + 700);
    expect(outcome.ms).toBeGreaterThan(LIMIT + READER_GRACE_MS + 800); // this process heard of it when it was free again
    expect(await readPage(small, URL_, ORIGIN)).toMatchObject({ title: 'Ordinary' });
  }, 20_000);
  it('an answer the reader wrote before it was killed is used: the answer is read before the end of the channel is acted on', async () => {
    await readSitemap('<urlset/>'); const child = lastChild(); H.spawn.mockClear();
    // Something else kills the reader 0.3 s from now, after it has answered and while this process is busy.
    const killer = realSpawn('/bin/sh', ['-c', `sleep 0.3; kill -9 ${child.pid}`], { stdio: 'ignore' });
    const read = readPage(small, URL_, ORIGIN);
    busyFor(1200);
    expect(ended(child.pid!)).toBe(true); // killed, and both its exit and its answer are waiting to be seen
    expect(await read).toMatchObject({ title: 'Ordinary' });
    expect(H.spawn).not.toHaveBeenCalled(); // not a second try: the first answer
    expect(await readPage(small, URL_, ORIGIN)).toMatchObject({ title: 'Ordinary' }); expect(H.spawn).toHaveBeenCalledTimes(1);
    killer.unref();
  }, 20_000);
  it('a failure is decided when a reader’s channel has closed, not when it has exited: an answer handed on after its exit is used', async () => {
    await stopReader(); H.spawn.mockClear();
    // This reader's events are handed on in an order that is allowed and that this machine does not produce by itself:
    // its exit first, then the answer it wrote before it ended, then the end of its channel.
    const held: any[][] = []; let closing: any[] | null = null, exited = false, child: ChildProcess | null = null;
    H.spawn.mockImplementationOnce((...args: any[]) => {
      const started: ChildProcess = H.start(...args); child = started; const emit = started.emit.bind(started);
      started.emit = ((event: string, ...rest: any[]) => {
        if (exited) return emit(event, ...rest);
        if (event === 'message') { held.push(rest); return true; }
        if (event === 'disconnect') { closing = rest; return true; }
        if (event !== 'exit') return emit(event, ...rest);
        exited = true; const handled = emit(event, ...rest);
        for (const answer of held) emit('message', ...answer);
        if (closing) emit('disconnect', ...closing);
        return handled;
      }) as typeof started.emit;
      return started;
    });
    const read = readPage(small, URL_, ORIGIN);
    for (const end = Date.now() + 5000; Date.now() < end && !held.length;) await pause(10);
    expect(held).toHaveLength(1); // the answer has arrived and is being kept back
    process.kill(child!.pid!, 'SIGKILL');
    expect(await read).toMatchObject({ title: 'Ordinary' });
    expect(exited).toBe(true); expect(H.spawn).toHaveBeenCalledTimes(1); // the first reader's answer, not a second try
  }, 20_000);
  it('a reader frozen from outside cannot end itself: this process kills it two seconds past the limit, and the document is timed_out', async () => {
    const LIMIT = 300;
    await readSitemap('<urlset/>'); const child = lastChild(); process.kill(child.pid!, 'SIGSTOP');
    const outcome = await watched(() => readPage(small, URL_, ORIGIN, { timeoutMs: LIMIT }));
    expect(reason(outcome)).toBe('timed_out'); expect(child.signalCode).toBe('SIGKILL');
    expect(outcome.ms).toBeGreaterThanOrEqual(LIMIT + READER_GRACE_MS - 50); expect(outcome.ms).toBeLessThan(LIMIT + READER_GRACE_MS + 1000);
    expect(await readPage(small, URL_, ORIGIN)).toMatchObject({ title: 'Ordinary' });
  }, 20_000);
  it('each read says how long the document took by the reader’s clock; an unreadable one counts its whole limit', async () => {
    const took = async (read: (o: ReadOptions) => Promise<unknown>, o: ReadOptions = {}) => { const said: number[] = []; const began = performance.now(); const outcome = await read({ ...o, spent: ms => said.push(ms) }).then(() => 'read', e => (e instanceof PageUnreadable ? e.reason : 'ours')); return { outcome, said, wall: performance.now() - began }; };
    await readSitemap('<urlset/>');
    const quick = await took(o => readPage(small, URL_, ORIGIN, o));
    expect(quick.outcome).toBe('read'); expect(quick.said).toHaveLength(1); expect(quick.said[0]).toBeGreaterThanOrEqual(0); expect(quick.said[0]).toBeLessThan(200);
    const slow = await took(o => readPage(`<!doctype html><html><body>${'<a><table>'.repeat(30_000)}</body></html>`, URL_, ORIGIN, o)); // about half a second of honest work
    expect(slow.outcome).toBe('read'); expect(slow.said[0]).toBeGreaterThan(150); expect(slow.said[0]).toBeLessThanOrEqual(Math.ceil(slow.wall)); expect(slow.said[0]).toBeGreaterThan(slow.wall - 250);
    expect(await took(o => readSitemap(`<urlset><url><loc>${'<a>'.repeat(12_000)}x</loc></url></urlset>`, o))).toMatchObject({ outcome: 'failed', said: [expect.any(Number)] });
    expect(await took(o => readPage(stalling.nestedDivs(), URL_, ORIGIN, o), { timeoutMs: 700 })).toMatchObject({ outcome: 'timed_out', said: [700] });
    // While this process is busy, the reader's clock is the one that counts: a quick page is still a quick page.
    const late = took(o => readPage(small, URL_, ORIGIN, o)); busyFor(800);
    expect((await late).said[0]).toBeLessThan(200);
    await stopReader(); H.spawn.mockImplementationOnce(() => { throw new Error('spawn EAGAIN'); });
    expect(await took(o => readPage(small, URL_, ORIGIN, o))).toMatchObject({ outcome: 'ours', said: [] });
  }, 30_000);
});

describe('a reader that ends without the document being the cause is followed by one more try (D4)', () => {
  const small = (title: string) => ordinary.small(title);
  /** The next `n` readers started are killed at once, as by something outside this process. */
  const killNext = (n: number) => { for (let i = 0; i < n; i++) H.spawn.mockImplementationOnce((...args: any[]) => { const child = H.start(...args); child.kill('SIGKILL'); return child; }); };
  it('the reader is killed before it has read its first document: the document is read, by a second reader', async () => {
    await stopReader(); H.spawn.mockClear(); killNext(1);
    expect(await readPage(small('Never the cause'), URL_, ORIGIN)).toMatchObject({ title: 'Never the cause' });
    expect(H.spawn).toHaveBeenCalledTimes(2);
  });
  it('the reader is killed between two reads and the next is asked for at once: it is read', async () => {
    await readSitemap('<urlset/>'); const child = lastChild(); H.spawn.mockClear();
    process.kill(child.pid!, 'SIGKILL');
    expect(await readPage(small('Straight after'), URL_, ORIGIN)).toMatchObject({ title: 'Straight after' });
    expect(H.spawn).toHaveBeenCalledTimes(1); expect(lastChild()).not.toBe(child);
  });
  it('the reader is ended in the middle of a document (SIGTERM): the document is read by the next reader', async () => {
    await readSitemap('<urlset/>'); const child = lastChild();
    const slow = `<!doctype html><html><head><title>Slow</title></head><body>${'<a><table>'.repeat(30_000)}</body></html>`; // half a second of work
    const read = readPage(slow, URL_, ORIGIN); await pause(150); process.kill(child.pid!, 'SIGTERM');
    expect(await read).toMatchObject({ title: 'Slow' }); expect(child.signalCode).toBe('SIGTERM');
  });
  it('two readers in a row end with the same document: it is unreadable (crashed), and the reads waiting behind it are answered in order', async () => {
    await stopReader(); H.spawn.mockClear(); killNext(2);
    const order: string[] = [];
    const ask = (name: string, read: Promise<unknown>) => read.then(value => { order.push(name); return value; }, error => { order.push(name + ' failed'); throw error; });
    const results = await Promise.allSettled([ask('twice', readPage(small('Twice'), URL_, ORIGIN)), ask('a', readPage(small('A'), URL_, ORIGIN)), ask('b', readBrandPage(small('B'), ORIGIN)), ask('c', readSitemap('<urlset><url><loc>/c</loc></url></urlset>'))]);
    expect(results[0]).toMatchObject({ status: 'rejected', reason: { name: 'PageUnreadable', reason: 'crashed' } });
    expect(results.slice(1).map(r => r.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    expect((results[1] as PromiseFulfilledResult<any>).value.title).toBe('A'); expect((results[3] as PromiseFulfilledResult<any>).value.urls).toEqual([ORIGIN + '/c']);
    expect(order).toEqual(['twice failed', 'a', 'b', 'c']);
    expect(H.spawn).toHaveBeenCalledTimes(3); // two for the first document, one for the rest
  });
  it('a document its reader ran out of time on is not tried again', async () => {
    await readSitemap('<urlset/>'); H.spawn.mockClear();
    expect(await readPage(stalling.nestedDivs(), URL_, ORIGIN, { timeoutMs: 400 }).catch(e => e.reason)).toBe('timed_out');
    expect(H.spawn).not.toHaveBeenCalled();
    expect(await readPage(small('After'), URL_, ORIGIN)).toMatchObject({ title: 'After' }); expect(H.spawn).toHaveBeenCalledTimes(1);
  });
});
