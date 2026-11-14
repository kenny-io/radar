// What the crawl and brand detection do with a document the page reader cannot read (AC6): a home page, a crawled
// page, a sitemap; one that stalls, one that runs the reader out of memory, one cheerio throws on. The site is a table
// of paths behind a mocked fetch and the reader is the real one. Its time limit is two seconds here instead of five,
// so a stalling document costs two; which reads were asked for, and of what, is recorded on the way through. The
// out-of-memory page keeps the real five seconds: it ends a reader by itself in about one, longer on a busy machine,
// and then a second one (a reader that ends is followed by one more try), and must not be cut short and mistaken for
// a stall.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ lookup: vi.fn(), putObject: vi.fn(), spawn: vi.fn(), start: (..._args: any[]): any => null, children: [] as any[], reads: [] as string[], limit: 2000, pretendMs: null as number | null, afterAsk: null as null | ((what: string) => void), patient: (_text: string): boolean => false, idleMs: undefined as number | undefined, broken: null as string | null, brokenAfter: 0, count: {} as Record<string, number> }));
vi.mock('node:child_process', async original => {
  const real = await original<typeof import('node:child_process')>();
  H.start = (command: string, args: string[], options: any) => { const child = real.spawn(command, args, options); H.children.push(child); return child; };
  H.spawn.mockImplementation(H.start);
  return { ...real, default: { ...real, spawn: H.spawn }, spawn: H.spawn };
});
vi.mock('node:dns/promises', () => ({ default: { lookup: H.lookup } }));
vi.mock('@/server/env', () => ({ env: { devStubs: false, crawlerUserAgent: 'RadarBot/1.0 (+https://radar.test/bot)' } }));
vi.mock('../storage', () => ({ putObject: H.putObject, objectKey: (bid: string, kind: string, ext: string) => `${bid}/${kind}.${ext}` }));
vi.mock('./pageReader', async original => {
  const real = await original<typeof import('./pageReader')>();
  // `broken`: this kind of read finds the reader unable to run, whatever the document, once `brokenAfter` of them have been answered.
  // `pretendMs`: every document is counted as having taken the reader this long, whatever it took. `afterAsk`: called
  // when a read has been handed to the reader and nothing has come back yet.
  const through = <T>(kind: string, what: string, o: import('./pageReader').ReadOptions | undefined, text: string, read: (o: import('./pageReader').ReadOptions) => Promise<T>) => {
    H.reads.push(what); const nth = (H.count[kind] = (H.count[kind] ?? 0) + 1);
    if (H.broken === kind && nth > H.brokenAfter) return Promise.reject(new Error('The page reader could not run: spawn EAGAIN'));
    const pretend = H.pretendMs;
    const asked = read({ ...o, timeoutMs: H.patient(text) ? real.PAGE_READ_MS : H.limit, idleMs: H.idleMs, ...(pretend === null ? {} : { spent: () => o?.spent?.(pretend) }) });
    H.afterAsk?.(what);
    return asked;
  };
  return { ...real,
    readPage: (html: string, url: string, origin: string, o?: import('./pageReader').ReadOptions) => through('page', new URL(url).host === 'site.example' ? new URL(url).pathname : new URL(url).host.split('.')[0] + ':' + new URL(url).pathname, o, html, opts => real.readPage(html, url, origin, opts)),
    readBrandPage: (html: string, origin: string, o?: import('./pageReader').ReadOptions) => through('brand', 'brand', o, html, opts => real.readBrandPage(html, origin, opts)),
    readSitemap: (xml: string, url: string, host: string, o?: import('./pageReader').ReadOptions) => through('sitemap', 'sitemap', o, xml, opts => real.readSitemap(xml, url, host, opts)) };
});
import fs from 'node:fs';
import path from 'node:path';
import { CRAWL_READ_MS, crawlSite, CrawlError } from './crawl';
import { detectBrand } from './brand';
import { MAX_LINKS_CHARS, PAGE_READ_MS, PageUnreadable, READER_CODE, READER_GRACE_MS } from './pageReader';
import { ordinary, stalling } from './stalling.fixtures';

const DOMAIN = 'site.example', O = 'https://site.example';
type Served = { type?: string; body: string; status?: number };
const html = (body: string): Served => ({ type: 'text/html; charset=utf-8', body });
const xml = (body: string): Served => ({ type: 'application/xml', body });
const linking = (title: string, paths: string[]) => html(`<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1>${paths.map(p => `<a href="${p}">${p}</a>`).join('')}</body></html>`);
const urlset = (paths: string[]) => xml(`<urlset>${paths.map(p => `<url><loc>${O}${p}</loc></url>`).join('')}</urlset>`);
const robots = (sitemaps: string[]): Served => ({ type: 'text/plain', body: `User-agent: *\nAllow: /\n${sitemaps.map(s => `Sitemap: ${O}${s}\n`).join('')}` });
// Three ways to be unreadable. Each is far past what it takes: the first needs 24 s to parse, the second builds 90 million elements.
const STALLS = stalling.nestedDivs(), OUT_OF_MEMORY = stalling.openFonts(30_000);
H.patient = text => text === OUT_OF_MEMORY;
const THROWS = `<!doctype html><html><head><title>x</title></head><body><main>${'<span>'.repeat(12_000)}text</main></body></html>`; // too deep for its text to be collected

let asked: string[] = [];
let site: Record<string, Served> = {};
const serve = async (href: string) => {
  const url = new URL(href); asked.push(url.pathname);
  const file = url.host === DOMAIN ? site[url.pathname] : undefined;
  if (url.host !== DOMAIN) throw new TypeError('fetch failed');
  return file ? new Response(file.body, { status: file.status ?? 200, headers: { 'content-type': file.type ?? 'text/html' } }) : new Response('<html><body>Not found</body></html>', { status: 404, headers: { 'content-type': 'text/html' } });
};
const fetchMock = vi.fn(serve);
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); H.lookup.mockReset(); H.lookup.mockResolvedValue([{ address: '93.184.216.34' }]);
  H.spawn.mockReset(); H.spawn.mockImplementation(H.start); H.putObject.mockReset(); H.putObject.mockImplementation(async (key: string) => '/api/files/' + key);
  asked = []; site = {}; H.reads.length = 0; H.limit = 2000; H.idleMs = undefined; H.broken = null; H.brokenAfter = 0; H.count = {}; H.pretendMs = null; H.afterAsk = null;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  return () => { warn.mockRestore(); vi.unstubAllGlobals(); };
});
afterAll(async () => { H.broken = null; H.idleMs = 1; await detectBrand('biz', '', O); });

const timed = async <T>(work: () => Promise<T>) => { const began = performance.now(); let value: T | undefined, error: any; try { value = await work(); } catch (e) { error = e; } return { value, error, ms: performance.now() - began }; };
const warnings = () => warn.mock.calls.map(call => call.join(' '));
const running = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** Stops the reader, as thirty idle seconds would, so the next read has to start one. */
async function stopReader() {
  H.idleMs = 1; await detectBrand('biz', '', O); H.idleMs = undefined; H.reads.length = 0;
  const pid = H.children[H.children.length - 1].pid as number;
  for (const end = Date.now() + 3000; Date.now() < end && running(pid);) await new Promise(r => setTimeout(r, 20));
  expect(running(pid)).toBe(false);
}

describe('the home page cannot be read: there is no site to analyse', () => {
  it.each([['stalls', STALLS, 'timed_out'], ['runs the reader out of memory', OUT_OF_MEMORY, 'crashed'], ['makes cheerio throw', THROWS, 'failed']])('a home page that %s: CrawlError(unreachable), and nothing else is asked of the site', async (_name, body, reason) => {
    site = { '/': html(body), '/robots.txt': robots(['/sitemap.xml']), '/sitemap.xml': urlset(['/a']), '/a': linking('A', []) };
    const crawl = await timed(() => crawlSite(DOMAIN));
    expect(crawl.error).toBeInstanceOf(CrawlError); expect(crawl.error.reason).toBe('unreachable'); // what analysis.site turns into its one permanent failure
    expect(crawl.ms).toBeLessThan(body === OUT_OF_MEMORY ? 2 * PAGE_READ_MS : H.limit + 1000);
    expect(asked).toEqual(['/', '/robots.txt']); expect(H.reads).toEqual(['/']);
    expect(warnings()).toEqual([`[crawl] ${O}/ (the home page) could not be read (${reason})`]);
  }, 20_000);
  it('a site that robots.txt closes is still "blocked", and its home page is never read', async () => {
    site = { '/': html(STALLS), '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /\n' } };
    const crawl = await timed(() => crawlSite(DOMAIN));
    expect(crawl.error).toBeInstanceOf(CrawlError); expect(crawl.error.reason).toBe('blocked');
    expect(H.reads).toEqual([]); expect(crawl.ms).toBeLessThan(1000);
  });
});

describe('any other page that cannot be read is passed over, as a failed fetch is', () => {
  it('the crawl goes on: the pages before and after it are read, and their links followed', async () => {
    site = { '/': linking('Home', ['/a', '/stalls', '/b', '/out-of-memory', '/c']), '/robots.txt': robots([]), '/a': linking('A', ['/from-a']), '/stalls': html(STALLS), '/b': linking('B', ['/from-b']), '/out-of-memory': html(OUT_OF_MEMORY), '/c': linking('C', []),
      '/from-a': linking('From A', []), '/from-b': linking('From B', []) };
    const progress: number[] = [];
    const crawl = await timed(() => crawlSite(DOMAIN, n => progress.push(n)));
    expect(crawl.error).toBeUndefined();
    expect(crawl.value!.pages.map(p => [p.path, p.title])).toEqual([['/', 'Home'], ['/a', 'A'], ['/b', 'B'], ['/c', 'C'], ['/from-a', 'From A'], ['/from-b', 'From B']]);
    expect(crawl.value).toMatchObject({ origin: O, host: DOMAIN, robotsBlocked: false });
    expect(H.reads).toEqual(['/', '/a', '/stalls', '/b', '/out-of-memory', '/c', '/from-a', '/from-b']); // the site has no sitemap to read
    expect(warnings()).toEqual([`[crawl] ${O}/stalls could not be read (timed_out)`, `[crawl] ${O}/out-of-memory could not be read (crashed)`]);
    expect(progress[progress.length - 1]).toBe(6);
    expect(crawl.ms).toBeLessThan(H.limit + 2 * PAGE_READ_MS + 1000);
  }, 30_000);
  it('a page cheerio throws on is passed over too', async () => {
    site = { '/': linking('Home', ['/throws', '/a']), '/robots.txt': robots([]), '/throws': html(THROWS), '/a': linking('A', []) };
    const crawl = await crawlSite(DOMAIN);
    expect(crawl.pages.map(p => p.path)).toEqual(['/', '/a']);
    expect(warnings()).toEqual([`[crawl] ${O}/throws could not be read (failed)`]);
  });
});

describe('a sitemap that cannot be read is ignored, as a failed fetch is', () => {
  it('the other sitemaps are still read and the crawl goes on', async () => {
    site = { '/': linking('Home', ['/a']), '/robots.txt': robots(['/stalls.xml', '/good.xml']), '/stalls.xml': xml(stalling.deepSitemap()), '/good.xml': urlset(['/from-the-sitemap']), '/a': linking('A', []), '/from-the-sitemap': linking('From the sitemap', []) };
    const crawl = await timed(() => crawlSite(DOMAIN));
    expect(crawl.value!.pages.map(p => p.path)).toEqual(['/', '/a', '/from-the-sitemap']);
    expect(H.reads).toEqual(['/', 'sitemap', 'sitemap', '/a', '/from-the-sitemap']);
    expect(warnings()).toEqual([`[crawl] ${O}/stalls.xml could not be read (timed_out)`]);
    expect(crawl.ms).toBeLessThan(H.limit + 1000);
  }, 20_000);
  it('a full sitemap of 35,000 addresses is read, and the crawl still reads no more than a hundred pages', async () => {
    const wide = ordinary.wideSitemap(35_000, O); expect(Buffer.byteLength(wide)).toBeGreaterThan(1.7 * 1024 * 1024); expect(Buffer.byteLength(wide)).toBeLessThanOrEqual(2 * 1024 * 1024);
    site = { '/': linking('Home', []), '/robots.txt': robots(['/wide.xml']), '/wide.xml': xml(wide) };
    for (let i = 0; i < 150; i++) site[`/page-${i}`] = linking(`Page ${i}`, []);
    const crawl = await crawlSite(DOMAIN);
    expect(crawl.pages).toHaveLength(100); expect(crawl.pages[99].path).toBe('/page-98'); expect(warn).not.toHaveBeenCalled();
  }, 30_000);
  it('this process does none of the work on those 35,000 addresses: its 10 ms timer is never 100 ms late while the sitemap is dealt with', async () => {
    // The site has no robots.txt, so the sitemap is the one at /sitemap.xml and no address is checked against robots
    // rules: that check is still made here, address by address, and is not what this test is about.
    site = { '/': linking('Home', []), '/sitemap.xml': xml(ordinary.wideSitemap(35_000, O)) };
    for (let i = 0; i < 150; i++) site[`/page-${i}`] = linking(`Page ${i}`, []);
    let late = 0, last = performance.now(), watching = false;
    const tick = setInterval(() => { const now = performance.now(); if (watching) late = Math.max(late, now - last - 10); last = now; }, 10);
    // From the request for the sitemap to the first request for a page: the fetch, the read, and the queueing of what it gave.
    fetchMock.mockImplementation(async (href: string) => {
      const url = new URL(href); asked.push(url.pathname);
      if (url.pathname === '/sitemap.xml') watching = true; else if (watching && url.pathname.startsWith('/page-')) { await new Promise(r => setTimeout(r, 15)); watching = false; }
      const file = site[url.pathname];
      return file ? new Response(file.body, { status: 200, headers: { 'content-type': file.type ?? 'text/html' } }) : new Response('', { status: 404, headers: { 'content-type': 'text/html' } });
    });
    try {
      const crawl = await crawlSite(DOMAIN);
      expect(asked.slice(0, 4)).toEqual(['/', '/robots.txt', '/sitemap.xml', '/page-0']); expect(crawl.pages).toHaveLength(100);
      expect(late).toBeLessThanOrEqual(100);
    } finally { clearInterval(tick); fetchMock.mockImplementation(serve); }
  }, 60_000);
});

describe('a crawl stops reading after three unreadable documents and returns what it has', () => {
  it('a sitemap and two pages: the third ends the crawl, the page fetched beside it is not read, and the rest is never fetched', async () => {
    site = { '/': linking('Home', ['/p1', '/p2', '/p3', '/p4', '/p5', '/p6']), '/robots.txt': robots(['/stalls.xml']), '/stalls.xml': xml(stalling.nestedSitemap()),
      '/p1': linking('One', ['/from-p1']), '/p2': html(STALLS), '/p3': html(OUT_OF_MEMORY), '/p4': linking('Four', []), '/p5': linking('Five', []), '/p6': linking('Six', []), '/from-p1': linking('From one', []) };
    const progress: number[] = [];
    const crawl = await timed(() => crawlSite(DOMAIN, n => progress.push(n)));
    expect(crawl.error).toBeUndefined();
    expect(crawl.value!.pages.map(p => p.path)).toEqual(['/', '/p1']);
    expect(crawl.value!.pages[0].html).toBe(site['/'].body); expect(crawl.value!.homeHtml).toBe(site['/'].body);
    expect(H.reads).toEqual(['/', 'sitemap', '/p1', '/p2', '/p3']);
    expect(asked).toEqual(['/', '/robots.txt', '/stalls.xml', '/p1', '/p2', '/p3', '/p4']); // pages are fetched four at a time
    expect(warnings()).toEqual([`[crawl] ${O}/stalls.xml could not be read (timed_out)`, `[crawl] ${O}/p2 could not be read (timed_out)`, `[crawl] ${O}/p3 could not be read (crashed)`]);
    expect(progress).toEqual([1, 2]);
    expect(crawl.ms).toBeLessThan(2 * H.limit + 2 * PAGE_READ_MS + 2000);
  }, 30_000);
  it('three sitemaps: the fourth is never fetched, no page is fetched, and the home page is what the crawl has', async () => {
    site = { '/': linking('Home', ['/a']), '/robots.txt': robots(['/1.xml', '/2.xml', '/3.xml', '/4.xml']), '/a': linking('A', []), '/4.xml': urlset(['/from-the-fourth']) };
    for (const n of [1, 2, 3]) site[`/${n}.xml`] = xml(stalling.deepSitemap());
    const crawl = await timed(() => crawlSite(DOMAIN));
    expect(crawl.value!.pages.map(p => p.path)).toEqual(['/']);
    expect(asked).toEqual(['/', '/robots.txt', '/1.xml', '/2.xml', '/3.xml']); expect(H.reads).toEqual(['/', 'sitemap', 'sitemap', 'sitemap']);
    expect(crawl.ms).toBeLessThan(3 * (H.limit + 1000));
  }, 30_000);
  it('two do not stop it', async () => {
    site = { '/': linking('Home', ['/p1', '/p2', '/p3', '/p4', '/p5']), '/robots.txt': robots([]), '/p1': html(THROWS), '/p2': html(THROWS), '/p3': linking('Three', []), '/p4': linking('Four', []), '/p5': linking('Five', []) };
    expect((await crawlSite(DOMAIN)).pages.map(p => p.path)).toEqual(['/', '/p3', '/p4', '/p5']);
    expect(warn).toHaveBeenCalledTimes(2);
  });
  it('the count is per crawl: the next crawl starts from none', async () => {
    site = { '/': linking('Home', ['/p1', '/p2', '/p3', '/p4']), '/robots.txt': robots([]), '/p1': html(THROWS), '/p2': html(THROWS), '/p3': html(THROWS), '/p4': linking('Four', []) };
    expect((await crawlSite(DOMAIN)).pages.map(p => p.path)).toEqual(['/']);
    site = { '/': linking('Home', ['/p1', '/p2', '/p3']), '/robots.txt': robots([]), '/p1': html(THROWS), '/p2': html(THROWS), '/p3': linking('Three', []) };
    expect((await crawlSite(DOMAIN)).pages.map(p => p.path)).toEqual(['/', '/p3']);
  });
});

describe('a crawl has sixty seconds of the reader in all, by the reader’s clock (D3)', () => {
  const six = () => ({ '/': linking('Home', ['/p1', '/p2', '/p3', '/p4', '/p5', '/p6']), '/robots.txt': robots([]), ...Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => [`/p${n}`, linking(`Page ${n}`, [])])) });
  it('the time is sixty seconds, and an ordinary crawl comes nowhere near it', async () => {
    expect(CRAWL_READ_MS).toBe(60_000);
    site = six();
    expect((await crawlSite(DOMAIN)).pages).toHaveLength(7); expect(warn).not.toHaveBeenCalled();
  });
  it('when its documents have had their time the crawl stops reading and returns what it has: here, every document counted as 0.4 s and one second allowed', async () => {
    site = six(); H.pretendMs = 400;
    const progress: number[] = [];
    const crawl = await crawlSite(DOMAIN, n => progress.push(n), { readMs: 1000 });
    // The home page (0.4 s), /p1 (0.8 s), /p2 (1.2 s: past the second, so it is the last). /p3 and /p4 were fetched beside them and are not read.
    expect(crawl.pages.map(p => p.path)).toEqual(['/', '/p1', '/p2']); expect(H.reads).toEqual(['/', '/p1', '/p2']);
    expect(asked).toEqual(['/', '/robots.txt', '/sitemap.xml', '/p1', '/p2', '/p3', '/p4']); expect(progress).toEqual([1, 3]);
    expect(warnings()).toEqual([`[crawl] ${O} has had its 1 s of the page reader: stopped with 3 page(s) read`]);
    expect(Object.keys(crawl.pages[1]).sort()).toEqual(['description', 'h1', 'kind', 'kindSure', 'links', 'path', 'text', 'title', 'url']); // the time is not part of a page
  });
  it('a sitemap’s time counts too, and a crawl that has just enough is not stopped', async () => {
    site = { ...six(), '/robots.txt': robots(['/map.xml']), '/map.xml': urlset(['/p6']) }; H.pretendMs = 400;
    expect((await crawlSite(DOMAIN, undefined, { readMs: 1000 })).pages.map(p => p.path)).toEqual(['/', '/p1']); // home, sitemap, /p1: 1.2 s
    H.reads.length = 0; H.pretendMs = 100;
    expect((await crawlSite(DOMAIN, undefined, { readMs: 801 })).pages).toHaveLength(7); // home, sitemap and six pages: 0.8 s
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('a document that cannot be read counts as its whole limit', async () => {
    site = { ...six(), '/p1': html(STALLS), '/p3': html(STALLS) };
    const crawl = await timed(() => crawlSite(DOMAIN, undefined, { readMs: 2 * H.limit - 500 }));
    // Two stalling pages of 2 s each are 4 s, more than the 3.5 s allowed; two unreadable documents alone would not have stopped it.
    expect(crawl.value!.pages.map(p => p.path)).toEqual(['/', '/p2']); expect(H.reads).toEqual(['/', '/p1', '/p2', '/p3']);
    expect(warnings()).toEqual([`[crawl] ${O}/p1 could not be read (timed_out)`, `[crawl] ${O}/p3 could not be read (timed_out)`, `[crawl] ${O} has had its ${Math.round((2 * H.limit - 500) / 1000)} s of the page reader: stopped with 2 page(s) read`]);
    expect(crawl.ms).toBeLessThan(2 * H.limit + 2000);
  }, 20_000);
  it('pages that are slow and readable, eight of them at about half a second of the reader each, with 1.2 s allowed: the crawl stops after a few', async () => {
    const SLOW = html(`<!doctype html><html><head><title>Slow</title></head><body>${'<a><table>'.repeat(30_000)}</body></html>`);
    const paths = Array.from({ length: 8 }, (_, i) => `/slow-${i}`);
    site = { '/': linking('Home', paths), '/robots.txt': robots([]), ...Object.fromEntries(paths.map(p => [p, SLOW])) };
    const crawl = await timed(() => crawlSite(DOMAIN, undefined, { readMs: 1200 }));
    const read = crawl.value!.pages.length - 1;
    expect(read).toBeGreaterThanOrEqual(1); expect(read).toBeLessThanOrEqual(6); // three on the machine this was written on
    expect(crawl.value!.pages.every(p => p.path === '/' || p.title === 'Slow')).toBe(true); // none of them was unreadable
    expect(warnings()).toEqual([`[crawl] ${O} has had its 1 s of the page reader: stopped with ${read + 1} page(s) read`]);
    // What it cost the reader: the time allowed and at most one more document.
    expect(crawl.ms).toBeLessThan(1200 + H.limit + 1000);
  }, 30_000);
});

describe('a document is not unreadable because this process was busy (D1)', () => {
  const busyFor = (ms: number) => { const until = Date.now() + ms; while (Date.now() < until) { /* this process's one thread is held */ } };
  it('two crawls at once: one keeps this process busy for longer than the limit and the backstop while the other has a page with the reader; the other still gets all its pages', async () => {
    H.limit = 1000;
    // B is ordinary: a home page, twelve small pages, and a 1.5 MB blog index whose answer is larger than the channel holds.
    const bPaths = [...Array.from({ length: 6 }, (_, i) => `/b-${i}`), '/blog', ...Array.from({ length: 6 }, (_, i) => `/b-${i + 6}`)];
    const B: Record<string, Served> = { '/': linking('B home', bPaths), '/robots.txt': robots([]), '/blog': html(ordinary.blogIndex()) };
    for (const p of bPaths) B[p] ??= linking('B ' + p, []);
    // A is ordinary too, but answering its second page takes this process 3.8 s of unbroken work (as checking a
    // large page's links against a long robots.txt does), and that work starts just after B's blog index went to the reader.
    const A: Record<string, Served> = { '/': linking('A home', ['/a-0', '/a-1', '/a-2']), '/robots.txt': robots([]), '/a-0': linking('A 0', []), '/a-1': linking('A 1', []), '/a-2': linking('A 2', []) };
    let release = () => {}; const blogIsWithTheReader = new Promise<void>(resolve => { release = resolve; });
    H.afterAsk = what => { if (what === 'b:/blog') setTimeout(release, 100); };
    let busy = 0;
    fetchMock.mockImplementation(async (href: string) => {
      const url = new URL(href); const table = url.host === 'a.example' ? A : url.host === 'b.example' ? B : null;
      if (!table) throw new TypeError('fetch failed');
      await new Promise(resolve => setImmediate(resolve)); // a real fetch lets the event loop turn
      if (url.host === 'a.example' && url.pathname === '/a-1') { await blogIsWithTheReader; busy++; busyFor(H.limit + READER_GRACE_MS + 800); }
      const file = table[url.pathname];
      return file ? new Response(file.body, { status: 200, headers: { 'content-type': file.type ?? 'text/html' } }) : new Response('', { status: 404, headers: { 'content-type': 'text/html' } });
    });
    try {
      const [a, b] = await Promise.all([crawlSite('a.example'), crawlSite('b.example')]);
      expect(busy).toBe(1); expect(H.reads).toContain('b:/blog');
      expect(b.pages.map(p => p.path)).toEqual(['/', ...bPaths]); expect(b.pages.find(p => p.path === '/blog')!.links).toHaveLength(4003);
      expect(a.pages.map(p => p.path)).toEqual(['/', '/a-0', '/a-1', '/a-2']);
      expect(warn).not.toHaveBeenCalled();
    } finally { fetchMock.mockImplementation(serve); }
  }, 30_000);
});

describe('what a crawl keeps of a site’s links is bounded (D2)', () => {
  it('six pages at addresses of 2,000 characters, each with 50,000 links: half a megabyte of links a page, and this process is never 100 ms late', async () => {
    const LONG = 'A'.repeat(2_000), b36 = (i: number) => i.toString(36);
    const body = `<!doctype html><html><head><title>p</title></head><body>${Array.from({ length: 50_000 }, (_, i) => `<a href=${b36(i)}>`).join('')}</body></html>`;
    const paths = Array.from({ length: 6 }, (_, i) => `/${LONG}/${i}/x`);
    site = { '/': linking('Home', paths), ...Object.fromEntries(paths.map(p => [p, html(body)])) };
    let late = 0, last = performance.now(); const tick = setInterval(() => { const now = performance.now(); late = Math.max(late, now - last - 10); last = now; }, 10);
    fetchMock.mockImplementation(async (href: string) => { await new Promise(resolve => setImmediate(resolve)); return serve(href); });
    try {
      const crawl = await crawlSite(DOMAIN);
      expect(crawl.pages).toHaveLength(7);
      for (const page of crawl.pages.slice(1)) { const kept = page.links.reduce((n, l) => n + l.length, 0); expect(kept).toBeLessThanOrEqual(MAX_LINKS_CHARS); expect(kept).toBeGreaterThan(MAX_LINKS_CHARS - 2_100); }
      expect(late).toBeLessThan(100);
    } finally { clearInterval(tick); fetchMock.mockImplementation(serve); }
  }, 60_000);
});

describe('brand detection on a home page that cannot be read', () => {
  const NOTHING = { logo: null, primary: null, secondary: null, language: null, htmlLang: null };
  it.each([['stalls', STALLS, 'timed_out'], ['runs the reader out of memory', OUT_OF_MEMORY, 'crashed']])('a home page that %s: no logo, no colours, no language, one warning, and nothing fetched or stored', async (_name, body, reason) => {
    const brand = await timed(() => detectBrand('biz', body, O));
    expect(brand.value).toEqual(NOTHING);
    expect(warnings()).toEqual([`[brand] the home page could not be read (${reason}): no logo, colors or language from it`]);
    expect(fetchMock).not.toHaveBeenCalled(); expect(H.putObject).not.toHaveBeenCalled();
    expect(brand.ms).toBeLessThan(body === OUT_OF_MEMORY ? 2 * PAGE_READ_MS : H.limit + 1000);
  }, 20_000);
  it('the next home page is read as usual', async () => {
    site = { '/icon.svg': { type: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#1d4ed8"/><circle r="2" fill="#1d4ed8"/></svg>' } };
    expect(await detectBrand('biz', STALLS, O)).toEqual(NOTHING);
    expect(await detectBrand('biz', ordinary.small(), O)).toEqual({ logo: '/api/files/biz/logo.svg', primary: '#2563EB', secondary: '#0F766E', language: 'English (UK)', htmlLang: 'en-GB' });
    expect(warn).toHaveBeenCalledTimes(1);
  }, 20_000);
});

describe('a reader that cannot run is not the site’s doing: the plain Error comes out of the crawl and of brand detection', () => {
  const SITE = { '/': linking('Home', ['/a']), '/robots.txt': robots(['/sitemap.xml']), '/sitemap.xml': urlset(['/b']), '/a': linking('A', []), '/b': linking('B', []) };
  const ours = (error: any) => { expect(error).toBeInstanceOf(Error); expect(error).not.toBeInstanceOf(CrawlError); expect(error).not.toBeInstanceOf(PageUnreadable); expect(error.message).toBe('The page reader could not run: spawn EAGAIN'); };
  it('it cannot be started: the crawl fails with it at the home page, brand detection fails with it, and both work once it can', async () => {
    await stopReader(); site = SITE;
    H.spawn.mockImplementation(() => { throw new Error('spawn EAGAIN'); });
    ours((await timed(() => crawlSite(DOMAIN))).error); expect(H.reads).toEqual(['/']);
    ours((await timed(() => detectBrand('biz', ordinary.small(), O))).error);
    expect(warn).not.toHaveBeenCalled(); // nothing was unreadable
    H.spawn.mockImplementation(H.start);
    expect((await crawlSite(DOMAIN)).pages.map(p => p.path)).toEqual(['/', '/a', '/b']);
    expect((await detectBrand('biz', ordinary.small(), O)).htmlLang).toBe('en-GB');
  });
  it.each([['a sitemap', 'sitemap', 0, ['/', 'sitemap']], ['a page after the home page', 'page', 1, ['/', 'sitemap', '/a']]] as const)('it stops running at %s: the crawl fails with it there, and does not carry on as if the document were missing', async (_name, kind, after, reads) => {
    site = SITE; H.broken = kind; H.brokenAfter = after;
    ours((await timed(() => crawlSite(DOMAIN))).error);
    expect(H.reads).toEqual(reads);
  });
});

describe('where cheerio runs (AC1)', () => {
  it('the crawler and brand detection do not load cheerio; only the code the reader runs does', () => {
    for (const file of ['crawl.ts', 'brand.ts', 'pageReader.ts']) {
      const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
      expect(source).not.toMatch(/from\s+['"]cheerio['"]|import\(\s*['"]cheerio['"]/);
      expect(/require\(\s*['"]cheerio['"]\s*\)/.test(source)).toBe(file === 'pageReader.ts'); // there, inside the code the child runs
    }
    expect(READER_CODE).toContain("require('cheerio')");
  });
});
