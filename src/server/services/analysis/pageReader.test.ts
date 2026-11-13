// The page reader: the child process every page, home page and sitemap of a site being analysed is read in. The reader
// is real throughout (a real child, real cheerio); starting one is watched, so which child read what, what it was
// started with and whether it is still running can all be shown. Most stalling documents get a one-second limit here so
// the file stays quick; the limit itself is not what makes them fail, and two are left to the real five seconds.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
const H = vi.hoisted(() => ({ spawn: vi.fn(), start: (..._args: any[]): any => null, children: [] as any[] }));
vi.mock('node:child_process', async original => {
  const real = await original<typeof import('node:child_process')>();
  H.start = (command: string, args: string[], options: any) => { const child = real.spawn(command, args, options); H.children.push(child); return child; };
  H.spawn.mockImplementation(H.start);
  return { ...real, default: { ...real, spawn: H.spawn }, spawn: H.spawn };
});
import { execFile, spawn as realSpawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { PAGE_READ_MS, PageUnreadable, READER_CODE, READER_GRACE_MS, READER_HEAP_MB, READER_IDLE_MS, normUrl, readBrandPage, readPage, readSitemap as readSitemapOf, sameSite, type ReadOptions } from './pageReader';
import { ordinary, stalling } from './stalling.fixtures';

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
    for (const read of [blog, brand, map]) { expect(read.ms).toBeLessThan(PAGE_READ_MS / 2); expect(read.late).toBeLessThanOrEqual(100); }
    expect(H.spawn).not.toHaveBeenCalled(); expect(running(child.pid!)).toBe(true);
  }, 30_000);
});

// The last two columns: what reading it as a crawled page, and as a home page, must come to with a one-second limit.
// 'timed_out' where it is known to need several times that; null where it is read in well under a second. The last
// row builds 900,000 elements, twice: the reader runs out of memory at about a second, so either end is right.
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
    for (const read of [page, brand, map]) {
      expect(read.ms).toBeLessThan(LIMIT + 1000); expect(read.late).toBeLessThanOrEqual(100);
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
    expect(reason(read)).toBe('timed_out'); expect(read.ms).toBeGreaterThanOrEqual(LIMIT - 20); expect(read.ms).toBeLessThan(LIMIT + 1000); expect(read.late).toBeLessThanOrEqual(100);
  }, 20_000);
  it('with the limit every document gets (five seconds): 100,000 style elements as a page, 64,000 nested divs as a home page', async () => {
    expect(PAGE_READ_MS).toBe(5000);
    const page = await watched(() => readPage(stalling.styleElements(), URL_, ORIGIN));
    const brand = await watched(() => readBrandPage(stalling.nestedDivs(), ORIGIN));
    for (const read of [page, brand]) {
      expect(reason(read)).toBe('timed_out');
      expect(read.ms).toBeGreaterThanOrEqual(PAGE_READ_MS - 20); expect(read.ms).toBeLessThan(PAGE_READ_MS + 1000); expect(read.late).toBeLessThanOrEqual(100);
    }
  }, 30_000);
  it('the reader that ran out of time is killed, and the next document gets a new one', async () => {
    await readSitemap('<urlset/>'); const before = lastChild();
    expect(reason(await watched(() => readPage(stalling.nestedDivs(), URL_, ORIGIN, { timeoutMs: 500 })))).toBe('timed_out');
    expect(await gone(before.pid!)).toBe(true); expect(before.signalCode).toBe('SIGKILL');
    expect(await readPage(ordinary.small(), URL_, ORIGIN)).toMatchObject({ title: 'Small' });
    expect(lastChild()).not.toBe(before); expect(running(lastChild().pid!)).toBe(true);
  }, 20_000);
});

describe('memory (AC4)', () => {
  it('the 173 KB page of open font elements ends the reader, not this process, well inside the limit; the next read works', async () => {
    const html = stalling.openFonts(30_000); expect(Buffer.byteLength(html)).toBeLessThan(180 * 1024);
    await readSitemap('<urlset/>'); const before = lastChild();
    const page = await watched(() => readPage(html, URL_, ORIGIN));
    expect(reason(page)).toBe('crashed'); expect(page.ms).toBeLessThan(PAGE_READ_MS); expect(page.late).toBeLessThanOrEqual(100);
    expect(await gone(before.pid!)).toBe(true); expect(before.signalCode).toBe('SIGABRT'); // out of memory, not stopped by us
    const brand = await watched(() => readBrandPage(html, ORIGIN));
    expect(reason(brand)).toBe('crashed'); expect(brand.ms).toBeLessThan(PAGE_READ_MS); expect(brand.late).toBeLessThanOrEqual(100);
    expect(await readPage(ordinary.small(), URL_, ORIGIN)).toMatchObject({ title: 'Small' });
  }, 30_000);
  it('the heap cap is fixed, and under it a dense 1.9 MB page of 85,000 links is read ten times in a row by the same reader', async () => {
    const html = ordinary.links(); expect(Buffer.byteLength(html)).toBeGreaterThan(1_900_000); expect(Buffer.byteLength(html)).toBeLessThanOrEqual(2 * 1024 * 1024);
    await readSitemap('<urlset/>'); const child = lastChild(); H.spawn.mockClear();
    expect(child.spawnargs).toContain(`--max-old-space-size=${READER_HEAP_MB}`);
    for (let i = 0; i < 10; i++) {
      const page = await readPage(html, URL_, ORIGIN);
      expect(page.links).toHaveLength(85_000); expect(page.links[84_999]).toBe('https://site.example/p84999');
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
    expect(['message', 'exit', 'error'].map(event => child.listenerCount(event))).toEqual([1, 1, 1]);
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
    // Three documents with a limit of 0.3 s, so a watchdog left running would end the reader 2.3 s after any of them.
    expect(await readPage(ordinary.small(), URL_, ORIGIN, { timeoutMs: 300 })).toMatchObject({ title: 'Small' });
    expect(await readSitemap(`<urlset><url><loc>${'<a>'.repeat(12_000)}x</loc></url></urlset>`, { timeoutMs: 300 }).catch(e => e.reason)).toBe('failed');
    expect(await readBrandPage(ordinary.small(), ORIGIN, { timeoutMs: 300 })).toMatchObject({ htmlLang: 'en-GB' });
    await pause(300 + READER_GRACE_MS + 500);
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
  it('a reader inside a stalling document when its user is killed ends itself at the limit plus two seconds', async () => {
    const { user, said } = startUser('stall');
    const { reader } = await said(); // 0.4 s into a document that has a limit of 1 s and needs 24
    expect(reader).toHaveLength(1);
    user.kill('SIGKILL'); const killed = performance.now();
    // Nobody is left to keep the limit: past it, the reader is still at work on the document...
    await pause(1000); expect(running(reader[0])).toBe(true);
    // ...until its own watchdog ends it, 3 s after it began (about 2.6 s after the kill). Without one it worked on for 33 s.
    expect(await gone(reader[0], 3500)).toBe(true);
    const outlived = performance.now() - killed;
    expect(outlived).toBeGreaterThan(1000 + READER_GRACE_MS - 600); expect(outlived).toBeLessThan(1000 + READER_GRACE_MS + 1500);
  }, 30_000);
  it('the reader’s code on its own: it answers over its channel and exits when the channel closes', async () => {
    const parent = `
      const { spawn } = require('node:child_process');
      const reader = spawn(process.execPath, ['--max-old-space-size=' + process.argv[2], '-e', process.argv[1]], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      reader.on('message', answer => { console.log(JSON.stringify({ answer, reader: reader.pid })); process.exit(0); });
      reader.send({ id: 7, kind: 'sitemap', text: '<urlset><url><loc>/x</loc></url></urlset>', url: 'https://site.example/sitemap.xml', host: 'site.example' });`;
    const stdout = await new Promise<string>((resolve, reject) => { execFile(process.execPath, ['-e', parent, READER_CODE, String(READER_HEAP_MB)], { cwd: process.cwd() }, (error, out) => (error ? reject(error) : resolve(out))); });
    const { answer, reader } = JSON.parse(stdout);
    expect(answer).toEqual({ id: 7, data: { sitemaps: [], urls: ['https://site.example/x'] } });
    expect(await gone(reader)).toBe(true);
  }, 30_000);
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
