// The same results as before the page reader (AC7). The fixture sites and home pages of sameAsMain.fixtures.ts are run
// through crawlSite and detectBrand, the only two ways in, and everything they give is compared with a stored record:
// the pages, what was asked of the site and in what order, what was stored. The record was made by this very file on
// the commit named in it, where cheerio ran in this process:
//   git worktree add <dir> <commit> && cd <dir> && npm ci
//   cp <here>/sameAsMain.{test,fixtures}.ts src/server/services/analysis/
//   SAME_AS_MAIN_RECORD=<commit> npx vitest run src/server/services/analysis/sameAsMain.test.ts
// and the record it writes beside itself copied back. Nothing in here knows how a page is read.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ lookup: vi.fn(), stored: [] as { key: string; type: string; body: string }[] }));
vi.mock('node:dns/promises', () => ({ default: { lookup: H.lookup } }));
vi.mock('@/server/env', () => ({ env: { devStubs: false, crawlerUserAgent: 'RadarBot/1.0 (+https://radar.test/bot)' } }));
vi.mock('../storage', () => ({
  putObject: async (key: string, body: Buffer, type: string) => { H.stored.push({ key, type, body: body.toString('utf8') }); return '/api/files/' + key; },
  objectKey: (bid: string, kind: string, ext: string) => `${bid}/${kind}.${ext}`,
}));
import { crawlSite, CrawlError } from './crawl';
import { detectBrand } from './brand';
import { BRANDS, BRAND_ORIGIN, CRAWLS, SITES, type Served, type Site } from './sameAsMain.fixtures';

const RECORD = path.join(__dirname, 'sameAsMain.record.json');
const recording = process.env.SAME_AS_MAIN_RECORD;
const record: { from: string; crawls: Record<string, unknown>; brands: Record<string, unknown> } = recording ? { from: recording, crawls: {}, brands: {} } : JSON.parse(fs.readFileSync(RECORD, 'utf8'));

/** The record keeps long values as their length and a digest, so it stays readable; the comparison is still exact. */
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
function compact(value: unknown): unknown {
  if (typeof value === 'string') return value.length > 1000 ? { characters: value.length, sha256: sha(value) } : value;
  if (Array.isArray(value)) return value.length > 150 ? { entries: value.length, sha256: sha(JSON.stringify(value)) } : value.map(compact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, compact(v)]));
  return value;
}

let asked: string[] = [];
let serving: (url: URL) => Served | undefined = () => undefined;
const answer = (file: Served | undefined): Response => {
  if (!file) return new Response('<!doctype html><html><head><title>Not found</title></head><body><h1>Not found</h1><a href="/from-the-404-page">x</a></body></html>', { status: 404, headers: { 'content-type': 'text/html' } });
  if (file.redirect) return new Response(null, { status: 301, headers: { location: file.redirect } });
  return new Response(file.body ?? '', { status: file.status ?? 200, headers: { 'content-type': file.type ?? 'text/html' } });
};
const fetchMock = vi.fn(async (href: string) => {
  asked.push(href);
  const file = serving(new URL(href));
  if (file?.fail) throw new TypeError('fetch failed');
  return answer(file);
});
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); H.lookup.mockReset(); H.lookup.mockResolvedValue([{ address: '93.184.216.34' }]); asked = []; H.stored.length = 0; });
afterAll(() => { vi.unstubAllGlobals(); if (recording) fs.writeFileSync(RECORD, JSON.stringify(record, null, 1) + '\n'); });

const same = (kind: 'crawls' | 'brands', name: string, got: unknown) => {
  const value = JSON.parse(JSON.stringify(compact(got)));
  if (recording) { record[kind][name] = value; return; }
  expect(record[kind]).toHaveProperty([name]);
  expect(value).toEqual(record[kind][name]);
};

describe(`crawlSite gives what it gave on ${record.from.slice(0, 8)}`, () => {
  it.each(CRAWLS)('%s', async domain => {
    serving = url => { const site = SITES[url.host]; return site ? site[url.pathname + url.search] : { fail: true }; };
    const progress: number[] = [];
    let result: unknown;
    try { result = await crawlSite(domain, n => progress.push(n)); }
    catch (e) { if (!(e instanceof CrawlError)) throw e; result = { crawlError: e.reason }; }
    same('crawls', domain, { result, asked, progress });
  }, 60_000);
});

describe(`detectBrand gives what it gave on ${record.from.slice(0, 8)}`, () => {
  it.each(BRANDS.map(c => [c.name, c] as const))('%s', async (name, c) => {
    const origin = c.origin ?? BRAND_ORIGIN; const files: Site = c.files ?? {};
    serving = url => files[url.href] ?? (url.origin === origin ? files[url.pathname + url.search] : undefined);
    const result = await detectBrand('biz', c.html, origin);
    same('brands', name, { result, asked, stored: [...H.stored] });
  }, 60_000);
  it('every case has its own name, and the record has no case this file does not run', () => {
    expect(new Set(BRANDS.map(c => c.name)).size).toBe(BRANDS.length);
    if (recording) return;
    expect(Object.keys(record.brands).sort()).toEqual(BRANDS.map(c => c.name).sort());
    expect(Object.keys(record.crawls).sort()).toEqual([...CRAWLS].sort());
  });
});
