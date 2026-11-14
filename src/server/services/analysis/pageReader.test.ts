// The page reader: the child process every page, home page and sitemap of a site being analysed is read in. The reader
// is real throughout (a real child, real cheerio); starting one is watched, so which child read what, what it was
// started with and whether it is still running can all be shown. Most stalling documents get a one-second limit here so
// the file stays quick; the limit itself is not what makes them fail, and two are left to the real five seconds.
// What happens while this process is itself busy, and after a reader is ended from outside, is in pageReader.busy.test.ts.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
const H = vi.hoisted(() => ({ spawn: vi.fn(), start: (..._args: any[]): any => null, children: [] as any[] }));
vi.mock('node:child_process', async original => {
  const real = await original<typeof import('node:child_process')>();
  H.start = (command: string, args: string[], options: any) => { const child = real.spawn(command, args, options); H.children.push(child); return child; };
  H.spawn.mockImplementation(H.start);
  return { ...real, default: { ...real, spawn: H.spawn }, spawn: H.spawn };
});
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { MAX_ADDRESS_CHARS, MAX_ANSWER_BYTES, MAX_CHILD_SITEMAPS, MAX_LINKS_CHARS, MAX_LOGO_CANDIDATES, MAX_SITEMAP_URLS_CHARS, PAGE_READ_MS, PageUnreadable, READER_CODE, READER_GRACE_MS, READER_HEAP_MB, READER_IDLE_MS, WATCHDOG_SIGNAL, normUrl, readBrandPage, readPage, readSitemap as readSitemapOf, sameSite, type ReadOptions } from './pageReader';
import { ordinary, stalling } from './stalling.fixtures';

/** Starts a process this file does not watch or count: a helper, not a reader. */
const { spawn: realSpawn } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
const URL_ = 'https://site.example/dir/page', ORIGIN = 'https://site.example', MAP = 'https://site.example/maps/sitemap.xml', HOST = 'site.example';
/** A sitemap fetched from MAP, for the site on HOST. */
const readSitemap = (xml: string, o?: ReadOptions) => readSitemapOf(xml, MAP, HOST, o);
const realTimeout = setTimeout;
/** A real wait, also while a test has replaced the clock. */
const pause = (ms: number) => new Promise<void>(resolve => { realTimeout(resolve, ms); });
const running = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** Waits until the process is gone; false if it is still there after `within` ms. */
async function gone(pid: number, within = 3000) { for (const end = Date.now() + within; Date.now() < end;) { if (!running(pid)) return true; await pause(20); } return !running(pid); }
const lastChild = () => H.children[H.children.length - 1] as ChildProcess;
/** Stops the reader, as thirty idle seconds would, so the next read has to start one. */
async function stopReader() { await readSitemap('<urlset/>', { idleMs: 1 }); expect(await gone(lastChild().pid!)).toBe(true); }

/** How late this process's 10 ms timer may be while the reader works before a test here fails. It was 2 to 33 ms late in
 *  every measurement of the reader, and the stalls this replaces were 4 to 30 s on `main`: the margin is for a crowded
 *  machine (one run at load average 32 saw 168 ms). The 100 ms of the acceptance criteria is held by the probes under
 *  .factory/bounded-page-parse, which run alone. */
const LATE_MS = 500;
type Outcome = { value: any; error: any; ms: number; late: number };
/** Runs one read. `ms`: how long it took to settle. `late`: the longest a 10 ms timer in this process was kept waiting meanwhile. */
async function watched(read: () => Promise<unknown>): Promise<Outcome> {
  let late = 0, last = performance.now();
  const tick = setInterval(() => { const now = performance.now(); late = Math.max(late, now - last - 10); last = now; }, 10);
  const began = performance.now(); let value: any = null, error: any = null;
  try { value = await read(); } catch (e) { error = e; }
  const ms = performance.now() - began;
  await pause(15); clearInterval(tick);
  return { value, error, ms, late };
}
const chars = (list: string[]) => list.reduce((n, entry) => n + entry.length, 0);
const reason = (o: Outcome) => (o.error instanceof PageUnreadable ? o.error.reason : o.error ? 'another error: ' + o.error.message : 'read');

beforeEach(() => { H.spawn.mockReset(); H.spawn.mockImplementation(H.start); });
afterAll(async () => { await stopReader(); });

describe('an ordinary document is read as it was in this process', () => {
  it('a page: title, heading, description, text, same-site links, article or page', async () => {
    expect(await readPage(ordinary.small('Hello'), URL_, ORIGIN)).toEqual({ title: 'Hello', h1: 'Hello', description: 'Hello, described.', text: 'HelloSome text.next', links: ['https://site.example/next'], kind: 'page', kindSure: true });
  });
  it('a home page for brand detection: the page’s CSS, stylesheets, theme colour, logo candidates, header SVG and language', async () => {
    expect(await readBrandPage(ordinary.small().replace('</head>', '<link rel="stylesheet" href="/a.css"></head>'), ORIGIN)).toEqual({
      css: ':root{--brand:#2563eb}', stylesheets: ['/a.css'], theme: '#0f766e', candidates: ['https://site.example/icon.svg'],
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path fill="#f59e0b"></path></svg>', htmlLang: 'en-GB',
    });
    expect(await readBrandPage('', ORIGIN)).toEqual({ css: '', stylesheets: [], theme: '', candidates: [], svg: null, htmlLang: null });
  });
  it('a sitemap: the text of each sitemap it names, and the addresses to follow on the site, both in order', async () => {
    const locs = [' https://site.example/a ', 'relative', '/b/?x=1#y', 'https://www.site.example/c', 'https://elsewhere.example/x', 'https://site.example/file.pdf', 'http://[bad', 'https://site.example/a'];
    expect(await readSitemap(`<sitemapindex><sitemap><loc> https://site.example/a.xml </loc></sitemap>${locs.map(l => `<url><loc>${l}</loc></url>`).join('')}<sitemap><loc>b.xml</loc></sitemap></sitemapindex>`))
      .toEqual({ sitemaps: ['https://site.example/a.xml', 'b.xml'], urls: ['https://site.example/a', 'https://site.example/maps/relative', 'https://site.example/b', 'https://www.site.example/c', 'https://site.example/a'] });
    // The same sitemap fetched from, and for, the www. host: the same addresses count.
    expect((await readSitemapOf(`<urlset><url><loc>/d</loc></url><url><loc>https://site.example/e</loc></url></urlset>`, 'https://www.site.example/sitemap.xml', 'www.site.example')).urls).toEqual(['https://www.site.example/d', 'https://site.example/e']);
  });
  it('the two large ordinary pages and a full sitemap are read well inside the limit, in the same reader', async () => {
    await readSitemap('<urlset/>'); const child = lastChild(); H.spawn.mockClear();
    const blog = await watched(() => readPage(ordinary.blogIndex(), ORIGIN + '/blog', ORIGIN));
    expect(blog.value).toMatchObject({ h1: 'Blog', kind: 'page', kindSure: true }); expect(blog.value.links).toHaveLength(4003); expect(blog.value.text).toHaveLength(4000);
    const brand = await watched(() => readBrandPage(ordinary.blogIndex(), ORIGIN));
    expect(brand.value).toMatchObject({ candidates: ['https://site.example/favicon-512.png', 'https://site.example/logo.png'], stylesheets: ['/site.css'], htmlLang: 'fr' });
    const map = await watched(() => readSitemap(ordinary.wideSitemap(35_000, ORIGIN)));
    expect(map.value.urls).toHaveLength(35_000); expect(map.value.urls[34_999]).toBe('https://site.example/page-34999');
    for (const read of [blog, brand, map]) { expect(read.ms).toBeLessThan(PAGE_READ_MS / 2); expect(read.late).toBeLessThan(LATE_MS); }
    expect(H.spawn).not.toHaveBeenCalled(); expect(running(child.pid!)).toBe(true);
  }, 30_000);
});

// The last two columns: what reading it as a crawled page, and as a home page, must come to with a one-second limit.
// 'timed_out' where it is known to need several times that; null where it is read in well under a second. The last
// row builds 900,000 elements, twice: the reader runs out of memory at about a second, so either end is right, and a
// reader that ends that way is followed by a second try, so that row may take two limits.
const STALLING: [string, () => string, string | null, string | null][] = [
  ['100,000 style elements', stalling.styleElements, 'timed_out', 'timed_out'],
  ['60,000 images in a header', stalling.headerImages, null, 'timed_out'],
  ['45,000 stylesheet links', stalling.stylesheetLinks, null, 'timed_out'],
  ['a header SVG nested 64,000 deep', stalling.deepHeaderSvg, 'timed_out', 'timed_out'],
  ['64,000 nested divs', stalling.nestedDivs, 'timed_out', 'timed_out'],
  ['16,000 nested divs, then 16,000 images', stalling.nestedDivsThenImages, 'timed_out', 'timed_out'],
  ['100,000 nested spans with text', stalling.nestedSpans, 'timed_out', 'timed_out'],
  ['300 open font elements, then 3,000 paragraphs', () => stalling.openFonts(3_000), 'timed_out or crashed', 'timed_out or crashed'],
];

describe('a stalling document settles within its limit plus a second, and this process stays responsive (AC2, AC3)', () => {
  const LIMIT = 1000;
  it.each(STALLING)('%s', async (_name, make, asPage, asBrand) => {
    const html = make(); expect(Buffer.byteLength(html)).toBeLessThanOrEqual(2 * 1024 * 1024);
    const page = await watched(() => readPage(html, URL_, ORIGIN, { timeoutMs: LIMIT }));
    const brand = await watched(() => readBrandPage(html, ORIGIN, { timeoutMs: LIMIT }));
    const map = await watched(() => readSitemap(html, { timeoutMs: LIMIT }));
    const tries = (asPage ?? '').includes('crashed') ? 2 : 1;
    for (const read of [page, brand, map]) {
      expect(read.ms).toBeLessThan(tries * LIMIT + 1000); expect(read.late).toBeLessThan(LATE_MS);
      expect(['read', 'timed_out', 'failed', 'crashed']).toContain(reason(read)); // never an error of ours
    }
    for (const [read, expected] of [[page, asPage], [brand, asBrand]] as const) {
      if (!expected) { expect(reason(read)).toBe('read'); continue; }
      expect(expected.split(' or ')).toContain(reason(read));
      if (reason(read) === 'timed_out') expect(read.ms).toBeGreaterThanOrEqual(LIMIT - 20);
    }
  }, 20_000);
  it.each([['one address under 200,000 nested elements', stalling.deepSitemap], ['a loc inside 64,000 nested url elements', stalling.nestedSitemap]] as const)('a sitemap: %s', async (_name, make) => {
    const read = await watched(() => readSitemap(make(), { timeoutMs: LIMIT }));
    expect(reason(read)).toBe('timed_out'); expect(read.ms).toBeGreaterThanOrEqual(LIMIT - 20); expect(read.ms).toBeLessThan(LIMIT + 1000); expect(read.late).toBeLessThan(LATE_MS);
  }, 20_000);
  it('with the limit every document gets (five seconds): 100,000 style elements as a page, 64,000 nested divs as a home page', async () => {
    expect(PAGE_READ_MS).toBe(5000);
    const page = await watched(() => readPage(stalling.styleElements(), URL_, ORIGIN));
    const brand = await watched(() => readBrandPage(stalling.nestedDivs(), ORIGIN));
    for (const read of [page, brand]) {
      expect(reason(read)).toBe('timed_out');
      expect(read.ms).toBeGreaterThanOrEqual(PAGE_READ_MS - 20); expect(read.ms).toBeLessThan(PAGE_READ_MS + 1000); expect(read.late).toBeLessThan(LATE_MS);
    }
  }, 30_000);
  it('the reader that ran out of time has ended itself, and the next document gets a new one', async () => {
    await readSitemap('<urlset/>'); const before = lastChild();
    expect(reason(await watched(() => readPage(stalling.nestedDivs(), URL_, ORIGIN, { timeoutMs: 500 })))).toBe('timed_out');
    expect(await gone(before.pid!)).toBe(true); expect(before.signalCode).toBe(WATCHDOG_SIGNAL); // by its own watchdog, not by this process
    expect(await readPage(ordinary.small(), URL_, ORIGIN)).toMatchObject({ title: 'Small' });
    expect(lastChild()).not.toBe(before); expect(running(lastChild().pid!)).toBe(true);
  }, 20_000);
});

describe('memory (AC4)', () => {
  it('the 173 KB page of open font elements ends the reader, not this process; it ends a second reader too and is then unreadable; the next read works', async () => {
    const html = stalling.openFonts(30_000); expect(Buffer.byteLength(html)).toBeLessThan(180 * 1024);
    await readSitemap('<urlset/>'); const before = lastChild(); H.spawn.mockClear();
    const page = await watched(() => readPage(html, URL_, ORIGIN));
    // Two readers, about a second each: well inside one limit when nothing else is going on, never past two.
    expect(reason(page)).toBe('crashed'); expect(page.ms).toBeLessThan(2 * PAGE_READ_MS); expect(page.late).toBeLessThan(LATE_MS);
    expect(H.spawn).toHaveBeenCalledTimes(1); const second = lastChild();
    expect(await gone(before.pid!)).toBe(true); expect(await gone(second.pid!)).toBe(true);
    expect([before.signalCode, second.signalCode]).toEqual(['SIGABRT', 'SIGABRT']); // out of memory both times, not stopped by anyone
    const brand = await watched(() => readBrandPage(html, ORIGIN));
    expect(reason(brand)).toBe('crashed'); expect(brand.ms).toBeLessThan(2 * PAGE_READ_MS); expect(brand.late).toBeLessThan(LATE_MS);
    expect(await readPage(ordinary.small(), URL_, ORIGIN)).toMatchObject({ title: 'Small' });
  }, 40_000);
  it('the heap cap is fixed, and under it a dense 1.9 MB page of 85,000 links is read ten times in a row by the same reader', async () => {
    const html = ordinary.links(); expect(Buffer.byteLength(html)).toBeGreaterThan(1_900_000); expect(Buffer.byteLength(html)).toBeLessThanOrEqual(2 * 1024 * 1024);
    await readSitemap('<urlset/>'); const child = lastChild(); H.spawn.mockClear();
    expect(child.spawnargs).toContain(`--max-old-space-size=${READER_HEAP_MB}`);
    // All 85,000 are parsed and looked at each time; the answer holds the first of them, up to its bound.
    let kept = 0; for (let total = 0; total + `${ORIGIN}/p${kept}`.length <= MAX_LINKS_CHARS; kept++) total += `${ORIGIN}/p${kept}`.length;
    expect(kept).toBeGreaterThan(18_000); expect(kept).toBeLessThan(85_000);
    for (let i = 0; i < 10; i++) {
      const page = await readPage(html, URL_, ORIGIN);
      expect(page.links).toHaveLength(kept); expect(page.links[kept - 1]).toBe(`${ORIGIN}/p${kept - 1}`); expect(page.title).toBe('x');
    }
    expect((await readBrandPage(html, ORIGIN)).htmlLang).toBe('fr');
    expect(H.spawn).not.toHaveBeenCalled(); expect(running(child.pid!)).toBe(true);
  }, 120_000);
});

describe('recovery and waiting in turn (AC5)', () => {
  it('of several reads asked for at once, only the stalling one fails, and the others are answered in order', async () => {
    const order: string[] = [];
    const ask = (name: string, read: Promise<unknown>) => read.then(value => { order.push(name); return value; }, error => { order.push(name + ' failed'); throw error; });
    const results = await Promise.allSettled([
      ask('a', readPage(ordinary.small('A'), URL_, ORIGIN)), ask('stall', readPage(stalling.nestedDivs(), URL_, ORIGIN, { timeoutMs: 1000 })), ask('b', readPage(ordinary.small('B'), URL_, ORIGIN)),
      ask('c', readBrandPage(ordinary.small('C'), ORIGIN)), ask('d', readSitemap('<urlset><url><loc>https://site.example/d</loc></url></urlset>')),
    ]);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled']);
    expect((results[1] as PromiseRejectedResult).reason).toMatchObject({ name: 'PageUnreadable', reason: 'timed_out' });
    expect((results[0] as PromiseFulfilledResult<any>).value.title).toBe('A'); expect((results[2] as PromiseFulfilledResult<any>).value.title).toBe('B');
    expect((results[3] as PromiseFulfilledResult<any>).value.htmlLang).toBe('en-GB'); expect((results[4] as PromiseFulfilledResult<any>).value.urls).toEqual(['https://site.example/d']);
    expect(order).toEqual(['a', 'stall failed', 'b', 'c', 'd']);
  }, 20_000);
  it('one document is read at a time, and a document’s limit starts when its turn comes', async () => {
    const began = performance.now(); const settled: number[] = [];
    const stalls = [0, 1, 2].map(() => readPage(stalling.nestedDivs(), URL_, ORIGIN, { timeoutMs: 800 }).catch(e => { settled.push(performance.now() - began); return e; }));
    const errors = await Promise.all(stalls);
    for (const e of errors) expect(e).toMatchObject({ reason: 'timed_out' });
    // Had the three limits started together, all three would have ended at 0.8 s and two of them unread.
    expect(settled[0]).toBeGreaterThanOrEqual(780); expect(settled[1] - settled[0]).toBeGreaterThanOrEqual(780); expect(settled[2] - settled[1]).toBeGreaterThanOrEqual(780);
    expect(settled[2]).toBeLessThan(3 * 800 + 1000);
  }, 20_000);
  it('a document cheerio throws on is unreadable too (failed), and the same reader reads the next', async () => {
    await readSitemap('<urlset/>'); const child = lastChild(); H.spawn.mockClear();
    const error = await readSitemap(`<urlset><url><loc>${'<a>'.repeat(12_000)}x</loc></url></urlset>`).catch(e => e);
    expect(error).toBeInstanceOf(PageUnreadable); expect(error).toMatchObject({ reason: 'failed' }); expect(error.message).toContain('Maximum call stack size exceeded');
    expect(await readSitemap('<urlset><url><loc>/after</loc></url></urlset>')).toEqual({ sitemaps: [], urls: ['https://site.example/after'] });
    expect(H.spawn).not.toHaveBeenCalled(); expect(running(child.pid!)).toBe(true);
  });
});

describe('a reader that cannot run is our fault, not the document’s: a plain Error', () => {
  const ours = async (read: Promise<unknown>) => { const error: any = await read.catch(e => e); expect(error).toBeInstanceOf(Error); expect(error).not.toBeInstanceOf(PageUnreadable); return String(error.message); };
  beforeEach(stopReader);
  it('it cannot be started (spawn throws)', async () => {
    H.spawn.mockImplementationOnce(() => { throw new Error('spawn EAGAIN'); });
    expect(await ours(readPage(ordinary.small(), URL_, ORIGIN))).toBe('The page reader could not run: spawn EAGAIN');
    expect(await readPage(ordinary.small(), URL_, ORIGIN)).toMatchObject({ title: 'Small' });
  });
  it('it cannot be started (the program is not there), and the reads waiting behind it are not lost', async () => {
    H.spawn.mockImplementationOnce((_command: string, args: string[], options: any) => H.start(path.join(os.tmpdir(), 'no-such-node'), args, options));
    const [first, second] = await Promise.allSettled([readPage(ordinary.small(), URL_, ORIGIN), readSitemap('<urlset/>')]);
    expect(first.status).toBe('rejected'); expect((first as PromiseRejectedResult).reason).not.toBeInstanceOf(PageUnreadable);
    expect(String((first as PromiseRejectedResult).reason.message)).toMatch(/^The page reader could not run: .*ENOENT/);
    expect(second).toEqual({ status: 'fulfilled', value: { sitemaps: [], urls: [] } });
  });
  it('it starts without a channel to this process, and is not left running', async () => {
    H.spawn.mockImplementationOnce((command: string) => H.start(command, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }));
    expect(await ours(readBrandPage(ordinary.small(), ORIGIN))).toMatch(/^The page reader could not run: /);
    expect(await gone(lastChild().pid!)).toBe(true);
    expect(await readBrandPage(ordinary.small(), ORIGIN)).toMatchObject({ htmlLang: 'en-GB' });
  });
  it('it starts where cheerio cannot be found', async () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(os.tmpdir());
    try {
      expect(await ours(readSitemap('<urlset/>'))).toMatch(/^The page reader could not run: cheerio did not load: Cannot find module 'cheerio'/);
      expect(await gone(lastChild().pid!)).toBe(true);
    } finally { cwd.mockRestore(); }
    expect(await readSitemap('<urlset/>')).toEqual({ sitemaps: [], urls: [] });
  });
});

describe('the reader process (AC8)', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('is started once, with a heap cap, a channel and none of this process’s environment, and reused', async () => {
    await stopReader(); H.spawn.mockClear();
    for (let i = 0; i < 30; i++) await readPage(ordinary.small(`Page ${i}`), URL_, ORIGIN);
    await Promise.all([readBrandPage(ordinary.small(), ORIGIN), readSitemap('<urlset/>'), readPage(ordinary.small(), URL_, ORIGIN)]);
    expect(H.spawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = H.spawn.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args).toEqual([`--max-old-space-size=${READER_HEAP_MB}`, '-e', READER_CODE]); // nothing from any document
    expect(Object.keys(options.env).sort()).toEqual(['NODE_ENV', 'PATH']);
    expect(options.stdio).toEqual(['ignore', 'ignore', 'ignore', 'ipc']);
    expect(options.cwd).toBe(process.cwd());
    // Nothing is added to the child per document: after 33 reads it has the listeners it started with.
    const child = lastChild();
    expect(['message', 'exit', 'error', 'disconnect'].map(event => child.listenerCount(event))).toEqual([1, 1, 1, 1]);
  });
  it('is stopped when it has had no work for the idle time, and the next read starts another', async () => {
    await readSitemap('<urlset/>', { idleMs: 300 }); const first = lastChild();
    await pause(150); expect(running(first.pid!)).toBe(true);
    await readSitemap('<urlset/>', { idleMs: 300 }); // work before the time is up: the time starts again
    await pause(200); expect(running(first.pid!)).toBe(true);
    expect(await gone(first.pid!, 2000)).toBe(true); expect(first.signalCode).toBe('SIGKILL');
    expect(await readSitemap('<urlset><url><loc>/x</loc></url></urlset>')).toEqual({ sitemaps: [], urls: ['https://site.example/x'] });
    expect(lastChild()).not.toBe(first);
  });
  it('the idle time is thirty seconds', async () => {
    expect(READER_IDLE_MS).toBe(30_000);
    await stopReader();
    // Only the clock is replaced: the child is real, and is really stopped.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await readSitemap('<urlset/>'); const child = lastChild();
    await vi.advanceTimersByTimeAsync(29_500); await pause(200);
    expect(running(child.pid!)).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await gone(child.pid!)).toBe(true);
  });
  it('is not stopped for being idle while a document is being read', async () => {
    await readSitemap('<urlset/>', { idleMs: 200 }); const child = lastChild();
    const slow = await watched(() => readSitemap(stalling.nestedSitemap(), { timeoutMs: 1000, idleMs: 200 })); // a second of work, five idle times long
    expect(reason(slow)).toBe('timed_out'); expect(child.signalCode ?? 'running').not.toBe('running');
    expect(slow.ms).toBeGreaterThanOrEqual(980);
  });

  it('its watchdog is set for one document at a time: a reader that has answered is not ended by it, whatever the answer was', async () => {
    await readSitemap('<urlset/>'); const child = lastChild(); H.spawn.mockClear();
    // Three documents with a limit of 0.3 s, so a watchdog left running would end the reader 0.3 s after any of them,
    // and a backstop left running would kill it two seconds after that.
    expect(await readPage(ordinary.small(), URL_, ORIGIN, { timeoutMs: 300 })).toMatchObject({ title: 'Small' });
    expect(await readSitemap(`<urlset><url><loc>${'<a>'.repeat(12_000)}x</loc></url></urlset>`, { timeoutMs: 300 }).catch(e => e.reason)).toBe('failed');
    expect(await readBrandPage(ordinary.small(), ORIGIN, { timeoutMs: 300 })).toMatchObject({ htmlLang: 'en-GB' });
    await pause(300 + READER_GRACE_MS + 700);
    expect(running(child.pid!)).toBe(true);
    expect(await readPage(ordinary.small(), URL_, ORIGIN)).toMatchObject({ title: 'Small' });
    expect(H.spawn).not.toHaveBeenCalled();
  }, 20_000);

  // A process of its own that uses pageReader.ts as the worker does, and says which reader it started.
  // 'leave': it reads a sitemap and has nothing more to do. 'stay': the same, and it stays. 'stall': it asks for a
  // page that takes 24 s to parse, with a limit of one second, and says which reader has it 0.4 s later.
  const USER = `
    const { execFileSync } = require('node:child_process');
    const reader = () => execFileSync('pgrep', ['-P', String(process.pid), '-f', 'max-old-space-size']).toString().trim().split(/\\s+/).map(Number);
    import(process.argv[1]).then(async m => {
      if (process.argv[2] === 'stall') {
        m.readPage('<!doctype html><html><body>' + '<div>'.repeat(64000), 'https://site.example/x', 'https://site.example', { timeoutMs: 1000 }).catch(() => {});
        setTimeout(() => { console.log(JSON.stringify({ reader: reader() })); }, 400); setInterval(() => {}, 1000); return;
      }
      const read = await m.readSitemap('<urlset><url><loc>/read</loc></url></urlset>', 'https://site.example/sitemap.xml', 'site.example');
      console.log(JSON.stringify({ read, reader: reader() }));
      if (process.argv[2] === 'stay') setInterval(() => {}, 1000);
    });`;
  const startUser = (mode: 'leave' | 'stay' | 'stall') => {
    const user = realSpawn(process.execPath, ['--import', 'tsx', '-e', USER, path.join(__dirname, 'pageReader.ts'), mode], { cwd: process.cwd(), env: { PATH: process.env.PATH || '', NODE_ENV: process.env.NODE_ENV }, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = ''; user.stdout!.on('data', chunk => { out += chunk; });
    const said = async () => { for (const end = Date.now() + 15_000; Date.now() < end && !out.includes('\n');) await pause(20); return JSON.parse(out) as { read: unknown; reader: number[] }; };
    const exited = new Promise<number | null>(resolve => { user.on('exit', code => resolve(code)); });
    return { user, said, exited };
  };
  it('does not keep the process that uses it alive, and exits when that process has', async () => {
    const { said, exited } = startUser('leave');
    const { read, reader } = await said();
    expect(read).toEqual({ sitemaps: [], urls: ['https://site.example/read'] }); expect(reader).toHaveLength(1);
    // The user process has nothing left to do: it ends by itself, long before the reader's thirty idle seconds are up.
    expect(await Promise.race([exited, pause(5000).then(() => 'still running')])).toBe(0);
    expect(await gone(reader[0])).toBe(true);
  }, 30_000);
  it('exits when the process that uses it is killed', async () => {
    const { user, said } = startUser('stay');
    const { reader } = await said();
    expect(reader).toHaveLength(1); expect(running(reader[0])).toBe(true);
    user.kill('SIGKILL');
    expect(await gone(reader[0])).toBe(true);
  }, 30_000);
  it('a reader inside a stalling document when its user is killed ends itself at the document’s limit', async () => {
    const { user, said } = startUser('stall');
    const { reader } = await said(); // 0.4 s into a document that has a limit of 1 s and needs 24
    expect(reader).toHaveLength(1);
    user.kill('SIGKILL'); const killed = performance.now();
    // Nobody is left to hear of it: the reader works on until its own watchdog ends it, 1 s after it began the document
    // (about 0.7 s after the kill). Without a watchdog it worked on for 33 s.
    expect(running(reader[0])).toBe(true);
    expect(await gone(reader[0], 2500)).toBe(true);
    const outlived = performance.now() - killed;
    expect(outlived).toBeGreaterThan(250); expect(outlived).toBeLessThan(2000);
  }, 30_000);
  it('the reader’s code on its own: it answers over its channel and exits when the channel closes', async () => {
    const parent = `
      const { spawn } = require('node:child_process');
      const reader = spawn(process.execPath, ['--max-old-space-size=' + process.argv[2], '-e', process.argv[1]], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      reader.on('message', answer => { console.log(JSON.stringify({ answer, reader: reader.pid })); process.exit(0); });
      reader.send({ id: 7, kind: 'sitemap', text: '<urlset><url><loc>/x</loc></url></urlset>', url: 'https://site.example/sitemap.xml', host: 'site.example' });`;
    const stdout = await new Promise<string>((resolve, reject) => { execFile(process.execPath, ['-e', parent, READER_CODE, String(READER_HEAP_MB)], { cwd: process.cwd() }, (error, out) => (error ? reject(error) : resolve(out))); });
    const { answer, reader } = JSON.parse(stdout);
    expect(answer).toEqual({ id: 7, data: { sitemaps: [], urls: ['https://site.example/x'] }, ms: expect.any(Number) }); // and how long it took
    expect(await gone(reader)).toBe(true);
  }, 30_000);
});

describe('the answer is bounded, in the reader (D2)', () => {
  const page = (links: string[]) => `<!doctype html><html><head><title>Bounded</title></head><body>${links.map(l => `<a href="${l}">x</a>`).join('')}</body></html>`;
  const b36 = (i: number) => i.toString(36);
  it('a 0.57 MB page of 50,000 links at an address of 2,000 characters gives half a megabyte of links, not 97 MB', async () => {
    const html = `<!doctype html><html><body>${Array.from({ length: 50_000 }, (_, i) => `<a href=${b36(i)}>`).join('')}</body></html>`;
    const at = `${ORIGIN}/${'A'.repeat(2_000)}/x`;
    const read = await watched(() => readPage(html, at, ORIGIN));
    expect(reason(read)).toBe('read'); expect(read.late).toBeLessThan(LATE_MS);
    expect(chars(read.value.links)).toBeLessThanOrEqual(MAX_LINKS_CHARS); expect(chars(read.value.links)).toBeGreaterThan(MAX_LINKS_CHARS - 2_100);
    expect(read.value.links[0]).toBe(`${ORIGIN}/${'A'.repeat(2_000)}/0`); expect(read.value.links.length).toBeLessThan(260);
    expect(JSON.stringify(read.value).length).toBeLessThan(MAX_LINKS_CHARS + 10_000);
  }, 20_000);
  it('a 1.8 MB sitemap index of 200 sitemaps nested in one another, and the same of page addresses, give nothing, not 362 MB', async () => {
    const index = `<sitemapindex>${'<sitemap><loc>'.repeat(200)}${'a'.repeat(1_900_000)}`, pages = `<urlset>${'<url><loc>'.repeat(100)}/${'a'.repeat(1_900_000)}`;
    for (const xml of [index, pages]) {
      expect(Buffer.byteLength(xml)).toBeLessThanOrEqual(2 * 1024 * 1024);
      const read = await watched(() => readSitemap(xml));
      expect(reason(read)).toBe('read'); expect(read.late).toBeLessThan(LATE_MS);
      expect(read.value).toEqual({ sitemaps: [], urls: [] }); // every one of them is a megabyte of text, not an address
    }
  }, 30_000);
  it('an address of 2,048 characters is a link and a sitemap entry; one character more is not', async () => {
    const fits = '/' + 'f'.repeat(MAX_ADDRESS_CHARS - ORIGIN.length - 1), over = '/' + 'o'.repeat(MAX_ADDRESS_CHARS - ORIGIN.length);
    expect([(ORIGIN + fits).length, (ORIGIN + over).length]).toEqual([MAX_ADDRESS_CHARS, MAX_ADDRESS_CHARS + 1]);
    expect((await readPage(page([over, fits, '/after']), URL_, ORIGIN)).links).toEqual([ORIGIN + fits, ORIGIN + '/after']);
    const map = await readSitemap(`<sitemapindex><sitemap><loc>${ORIGIN + over}</loc></sitemap><sitemap><loc>${ORIGIN + fits}</loc></sitemap><url><loc>${ORIGIN + over}</loc></url><url><loc>${ORIGIN + fits}</loc></url><url><loc>/after</loc></url></sitemapindex>`);
    expect(map).toEqual({ sitemaps: [ORIGIN + fits], urls: [ORIGIN + fits, ORIGIN + '/after'] });
  });
  it('a page’s links stop where they would pass 500,000 characters: the first ones, in order, each once', async () => {
    const long = (i: number) => `/${b36(i).padStart(4, '0')}${'l'.repeat(975)}`; // with the origin, 1,000 characters each
    const links = (await readPage(page([...Array.from({ length: 700 }, (_, i) => long(i)), '/short-and-late']), URL_, ORIGIN)).links;
    expect(links).toHaveLength(500); expect(chars(links)).toBe(MAX_LINKS_CHARS); expect(links[499]).toBe(ORIGIN + long(499));
    // Repeats do not count twice, and one address short of the bound leaves the rest in.
    const repeated = (await readPage(page([...Array.from({ length: 499 }, (_, i) => long(i)), ...Array.from({ length: 499 }, (_, i) => long(i)), '/short-and-late']), URL_, ORIGIN)).links;
    expect(repeated).toHaveLength(500); expect(repeated[499]).toBe(ORIGIN + '/short-and-late');
    // The list ends at the first link that does not fit: a later one that would have fitted is not taken in its place.
    const ended = (await readPage(page([...Array.from({ length: 499 }, (_, i) => long(i)), '/' + 'x'.repeat(1_500), '/short-and-late']), URL_, ORIGIN)).links;
    expect(ended).toHaveLength(499); expect(ended[498]).toBe(ORIGIN + long(498)); expect(chars(ended)).toBe(499_000);
  });
  it('a sitemap’s page addresses stop where they would pass 2,000,000 characters, and it names at most 100 other sitemaps, each once', async () => {
    const long = (i: number) => `${ORIGIN}/${b36(i).padStart(4, '0')}${'s'.repeat(1_995 - ORIGIN.length)}`; // 2,000 characters each
    expect(long(0)).toHaveLength(2_000);
    // 1,100 of them would be 2.2 MB of sitemap, more than can be fetched: the bound is for nested and repeated text. Here they are given outright.
    const map = await readSitemap(`<urlset>${Array.from({ length: 1_100 }, (_, i) => `<url><loc>${long(i)}</loc></url>`).join('')}</urlset>`);
    expect(map.urls).toHaveLength(1_000); expect(chars(map.urls)).toBe(MAX_SITEMAP_URLS_CHARS); expect(map.urls[999]).toBe(long(999));
    const index = await readSitemap(`<sitemapindex>${Array.from({ length: 300 }, (_, i) => `<sitemap><loc>${ORIGIN}/s${i % 150}.xml</loc></sitemap>`).join('')}</sitemapindex>`);
    expect(index.sitemaps).toHaveLength(MAX_CHILD_SITEMAPS); expect(index.sitemaps).toEqual(Array.from({ length: 100 }, (_, i) => `${ORIGIN}/s${i}.xml`));
    const twice = await readSitemap(`<sitemapindex>${['a', 'b', 'a', 'c', 'b'].map(n => `<sitemap><loc>${ORIGIN}/${n}.xml</loc></sitemap>`).join('')}</sitemapindex>`);
    expect(twice.sitemaps).toEqual(['a', 'b', 'c'].map(n => `${ORIGIN}/${n}.xml`));
  });
  it('brand detection is given the first six logo candidates', async () => {
    const read = await readBrandPage(`<!doctype html><html><body><header>${Array.from({ length: 3_000 }, (_, i) => `<img src="/logo-${i}.png">`).join('')}</header></body></html>`, ORIGIN);
    expect(read.candidates).toEqual(Array.from({ length: MAX_LOGO_CANDIDATES }, (_, i) => `${ORIGIN}/logo-${i}.png`)); expect(MAX_LOGO_CANDIDATES).toBe(6);
  });
  it('an answer over 8 MB is not sent: the read fails, and the reader goes on', async () => {
    await readSitemap('<urlset/>'); const child = lastChild(); H.spawn.mockClear();
    // 1.9 MB of control characters in a <style>: each one is six bytes of JSON, so the page's CSS alone would be an answer of 11 MB.
    const html = `<!doctype html><html lang="en"><head><style>${'\u0001'.repeat(1_900_000)}</style></head></html>`; expect(Buffer.byteLength(html)).toBeLessThanOrEqual(2 * 1024 * 1024);
    const read = await watched(() => readBrandPage(html, ORIGIN));
    expect(read.error).toBeInstanceOf(PageUnreadable); expect(read.error).toMatchObject({ reason: 'failed' }); expect(read.error.message).toContain('answer too large');
    expect(read.late).toBeLessThan(LATE_MS); expect(MAX_ANSWER_BYTES).toBe(8 * 1024 * 1024);
    expect((await readBrandPage(`<!doctype html><html><head><style>${':root{--brand:#2563eb}'.repeat(300_000)}</style></head></html>`, ORIGIN)).css).toHaveLength(6_600_000); // 6.6 MB of ordinary CSS, more than a page can hold, is sent
    expect(H.spawn).not.toHaveBeenCalled(); expect(running(child.pid!)).toBe(true);
  }, 20_000);
});

describe('the reader’s copies of normUrl and sameSite are the ones in this process', () => {
  // [href, the page it is on, the site's origin, what the link comes to: an address, or null when it is not a link to follow]
  const S = 'https://site.example';
  const TABLE: [string, string, string, string | null][] = [
    ['/a', URL_, S, `${S}/a`], ['/a/', URL_, S, `${S}/a`], ['/a#frag', URL_, S, `${S}/a`], ['/a?x=1', URL_, S, `${S}/a`], ['/a/?x=1#y', URL_, S, `${S}/a`], ['/', URL_, S, `${S}/`], ['', URL_, S, `${S}/dir/page`], ['#top', URL_, S, `${S}/dir/page`], ['?q=1', URL_, S, `${S}/dir/page`],
    ['about', URL_, S, `${S}/dir/about`], ['./rel', URL_, S, `${S}/dir/rel`], ['../up', URL_, S, `${S}/up`], ['next', `${S}/dir/`, S, `${S}/dir/next`], ['/x/../y/./z', URL_, S, `${S}/y/z`], ['/trailing//', URL_, S, `${S}/trailing/`],
    ['//site.example/proto', URL_, S, `${S}/proto`], ['//site.example/proto', 'http://site.example/p', S, 'http://site.example/proto'], ['//other.example/proto', URL_, S, null],
    ['https://www.site.example/www', URL_, S, 'https://www.site.example/www'], ['https://site.example/bare', URL_, 'https://www.site.example', `${S}/bare`], ['https://www.site.example/both', URL_, 'https://www.site.example', 'https://www.site.example/both'],
    ['https://www.www.site.example/twice', URL_, S, null], ['https://wwwsite.example/no-dot', URL_, S, null], ['https://sub.site.example/sub', URL_, S, null], ['https://site.example.evil.example/x', URL_, S, null], ['https://other.example/x', URL_, S, null],
    ['https://site.example./dot', URL_, S, null], ['HTTPS://SITE.EXAMPLE/Caps', URL_, S, `${S}/Caps`], ['https://WWW.site.example/caps-www', URL_, S, 'https://www.site.example/caps-www'], ['https://site.example:8443/port', URL_, S, 'https://site.example:8443/port'],
    ['http://site.example/http', URL_, S, 'http://site.example/http'], ['https://user:pw@site.example/auth', URL_, S, 'https://user:pw@site.example/auth'],
    ['mailto:a@site.example', URL_, S, null], ['tel:+15550100', URL_, S, null], ['javascript:void(0)', URL_, S, null], ['data:text/html,x', URL_, S, null], ['ftp://site.example/f', URL_, S, null], ['http://[bad', URL_, S, null], ['https://', URL_, S, null], ['http://exa mple.com/', URL_, S, null],
    [' /spaced ', URL_, S, `${S}/spaced`], ['/tab\tin', URL_, S, `${S}/tabin`], ['/sp ace', URL_, S, `${S}/sp%20ace`], ['/üñí', URL_, S, `${S}/%C3%BC%C3%B1%C3%AD`], ['/a%20b', URL_, S, `${S}/a%20b`],
    ...['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'pdf', 'zip', 'mp4', 'mp3', 'css', 'js', 'xml', 'json', 'txt', 'woff', 'woff2'].map(ext => [`/file.${ext}`, URL_, S, null] as [string, string, string, null]),
    ['/FILE.PNG', URL_, S, null], ['/file.png?x=1', URL_, S, null], ['/doc.pdf#p2', URL_, S, null], ['/file.png/', URL_, S, `${S}/file.png`], ['/file.jpgx', URL_, S, `${S}/file.jpgx`], ['/x.html', URL_, S, `${S}/x.html`], ['/png', URL_, S, `${S}/png`], ['/a.js/b', URL_, S, `${S}/a.js/b`],
  ];
  const here = (href: string, base: string, origin: string) => { const n = normUrl(href, base); if (!n) return null; try { return sameSite(new URL(n).hostname, new URL(origin).hostname) ? n : null; } catch { return null; } };
  const escaped = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  it(`on ${TABLE.length} addresses, each read as the one link of a page`, async () => {
    const there = await Promise.all(TABLE.map(([href, base, origin]) => readPage(`<a href="${escaped(href)}">x</a>`, base, origin).then(page => page.links)));
    TABLE.forEach(([href, base, origin, expected], i) => {
      expect([href, here(href, base, origin)]).toEqual([href, expected]);
      expect([href, there[i]]).toEqual([href, expected === null ? [] : [expected]]);
    });
  });
  it('and on the same addresses, each read as the one address of a sitemap', async () => {
    const there = await Promise.all(TABLE.map(([href, base, origin]) => readSitemapOf(`<urlset><url><loc>${href.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</loc></url></urlset>`, base, new URL(origin).hostname).then(map => map.urls)));
    TABLE.forEach(([href, , , expected], i) => { expect([href, there[i]]).toEqual([href, expected === null ? [] : [expected]]); });
  });
  it('sameSite ignores one leading www. on either side and nothing else', () => {
    expect([sameSite('www.a.example', 'a.example'), sameSite('a.example', 'www.a.example'), sameSite('www.a.example', 'www.a.example'), sameSite('a.example', 'a.example')]).toEqual([true, true, true, true]);
    expect([sameSite('b.a.example', 'a.example'), sameSite('wwwa.example', 'a.example'), sameSite('www.www.a.example', 'a.example'), sameSite('a.example', 'a.example.')]).toEqual([false, false, false, false]);
  });
});
