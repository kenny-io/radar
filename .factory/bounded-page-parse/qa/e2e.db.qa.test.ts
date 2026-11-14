// One level above crawlSite and detectBrand (AC6): the real onboarding analysis job (`analysis.site`) through the real
// job queue (enqueue + runJobNow), a real Postgres database and the real page reader, in development-stub mode: the
// stub site answers the crawler and the stub extraction stands in for the AI providers. Only what the stub site
// answers for one path is changed per scenario. The run is the earlier QA's (`.factory/safe-logo-decode/qa/e2e-shared.ts`).
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const M = vi.hoisted(() => {
  process.env.RADAR_DEV_STUBS = '1'; process.env.STORAGE_DIR = '.data/bounded-page-parse-qa'; process.env.RADAR_BILLING = 'off';
  for (const k of ['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'ANTHROPIC_API_KEY']) delete process.env[k];
  return { rewrite: { current: null as any }, fetched: [] as string[] };
});
vi.mock('@/server/services/analysis/devsite', async original => {
  const real = await original<typeof import('@/server/services/analysis/devsite')>();
  return { ...real, devFetch: async (url: string) => { const path = new URL(url).pathname; M.fetched.push(path); const answer = M.rewrite.current ? await M.rewrite.current(path, () => real.devFetch(url), url) : undefined; return answer ?? real.devFetch(url); } };
});
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyse, F, type StubAnswer } from '../../safe-logo-decode/qa/e2e-shared';
import { crawlFailCopy } from '@/server/services/analysis/jobs';
import { readSitemap } from '@/server/services/analysis/pageReader';

const HAS_DB = !!process.env.DATABASE_URL;
const evidence: Record<string, unknown>[] = [];
const page = (body: string, url: string): StubAnswer => ({ status: 200, type: 'text/html; charset=utf-8', body: Buffer.from(body), url });
const STALLS = `<!doctype html><html><body>${'<div>'.repeat(64_000)}`;
const OUT_OF_MEMORY = `<!doctype html><html><body><p>${Array.from({ length: 3000 }, (_, i) => `<font size="${i}">`).join('')}${'<p>x'.repeat(30_000)}`;
const THROWS = `<!doctype html><html><head><title>x</title></head><body><main>${'<span>'.repeat(12_000)}text</main></body></html>`;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { M.fetched.length = 0; vi.spyOn(console, 'info').mockImplementation(() => {}); warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); return () => { warn.mockRestore(); }; });
afterAll(async () => { await F.cleanup(); fs.writeFileSync(path.join(__dirname, process.env.QA_E2E_EVIDENCE || 'evidence/e2e.json'), JSON.stringify(evidence, null, 1)); fs.rmSync(path.resolve('.data/bounded-page-parse-qa'), { recursive: true, force: true }); });
const note = (scenario: string, r: Awaited<ReturnType<typeof analyse>>, extra: Record<string, unknown> = {}) => evidence.push({ scenario, jobStatus: r.job.status, jobError: r.job.error ?? null, attempts: r.job.attempts, maxAttempts: r.job.maxAttempts, ms: r.ms, phase: r.progress?.phase, failed: r.progress?.failed ?? null, site: r.progress?.results?.site ?? null, brandLine: r.progress?.results?.brand ?? null, logo: r.profile.brand.logo, colours: [r.profile.brand.primary, r.profile.brand.secondary], result: r.job.result, fetched: M.fetched.length, warnings: warn.mock.calls.map(c => c.join(' ')), ...extra });

describe.skipIf(!HAS_DB)('analysis.site with documents the page reader cannot read (real queue, real database, stub site and stub AI)', () => {
  it('control: the stub site as it is', async () => {
    const r = await analyse(M.rewrite, null); note('control', r);
    expect(r.job.status).toBe('done'); expect(r.progress.phase).toBe('done'); expect(r.progress.results.site).toMatch(/^\d+ pages on /);
  });
  it.each([['stalls', STALLS, 'timed_out'], ['runs the reader out of memory', OUT_OF_MEMORY, 'crashed'], ['makes cheerio throw', THROWS, 'failed']])('a home page that %s: the job fails once, for good, with the designed "couldn’t reach" copy', async (name, body, reason) => {
    const r = await analyse(M.rewrite, (p, _real, url) => (p === '/' ? page(body, url) : undefined));
    note(`home page ${name}`, r);
    expect(r.job.status).toBe('failed'); // not put back in the queue, though one attempt of its two is left
    expect(r.job.attempts).toBeLessThan(r.job.maxAttempts);
    expect(r.job.error).toBe(crawlFailCopy(r.domain)); expect(r.job.error).toMatch(/^Radar couldn’t reach .*\. The site may be down or blocking crawlers\.$/);
    expect(r.progress.phase).toBe('site'); expect(r.progress.failed).toBe(crawlFailCopy(r.domain));
    expect(warn.mock.calls.map(c => c.join(' '))).toEqual([`[crawl] https://${r.domain}/ (the home page) could not be read (${reason})`]);
    expect(M.fetched.filter(p => p !== '/' && p !== '/robots.txt')).toEqual([]); // nothing else was asked of the site
    expect(r.ms).toBeLessThan(5000 + 3000);
    expect(r.profile.business.name).toBe(r.defaults ? r.profile.business.name : ''); // the profile is left as it was
  });
  it('another page that stalls: the job finishes, without that page', async () => {
    const control = await analyse(M.rewrite, null);
    const pages = Number(/^(\d+) pages/.exec(control.progress.results.site)![1]);
    const r = await analyse(M.rewrite, (p, _real, url) => (p === '/pricing' || p === '/about' ? page(STALLS, url) : undefined));
    note('a page other than the home page stalls', r, { controlPages: pages, replaced: M.fetched.filter(p => p === '/pricing' || p === '/about') });
    expect(r.job.status).toBe('done'); expect(r.progress.phase).toBe('done');
    const got = Number(/^(\d+) pages/.exec(r.progress.results.site)![1]);
    const replaced = new Set(M.fetched.filter(p => p === '/pricing' || p === '/about')).size;
    expect(replaced).toBeGreaterThan(0); expect(got).toBe(pages - replaced);
  });
  it('a home page the crawler reads and brand detection cannot (55,000 logo images): the job finishes with no logo and the default colours', async () => {
    const r = await analyse(M.rewrite, async (p, real, url) => {
      if (p !== '/') return undefined;
      const home = (await real()).body.toString('utf8').replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<link rel="stylesheet"[^>]*>/g, '').replace(/<meta name="theme-color"[^>]*>/g, '');
      return page(home.replace('</body>', `${Array.from({ length: 55_000 }, (_, i) => `<img class="logo" src="/l${i}.png">`).join('')}</body>`), url);
    });
    note('home page readable as a page, not for brand', r);
    expect(r.job.status).toBe('done'); expect(r.profile.brand.logo).toBeNull(); expect(r.progress.logoMissing).toBe(true); expect(r.progress.results.brand).toMatch(/Logo not found/);
    expect([r.profile.brand.primary, r.profile.brand.secondary]).toEqual([r.defaults.primary, r.defaults.secondary]);
    expect(warn.mock.calls.map(c => c.join(' '))).toEqual(['[brand] the home page could not be read (timed_out): no logo, colors or language from it']);
  });
  // Round 2 (D3): a site whose pages each take the reader about 3 s, 30 of them linked from the home page.
  it('a site of slow, readable pages: the crawl stops when it has had its 60 s of the reader, and the job finishes with the pages read by then', async () => {
    const slow = `<!doctype html><html><head><title>Slow</title></head><body><h1>Slow</h1>${'<a><table>'.repeat(80_000)}</body></html>`;
    const r = await analyse(M.rewrite, async (p, real, url) => {
      if (p.startsWith('/slow-')) return page(slow, url);
      if (p !== '/') return undefined;
      return page((await real()).body.toString('utf8').replace('<body>', `<body>${Array.from({ length: 30 }, (_, i) => `<a href="/slow-${i}">s</a>`).join('')}`), url);
    });
    note('30 slow pages (round 2, D3)', r);
    expect(r.job.status).toBe('done'); expect(r.progress.phase).toBe('done');
    const got = Number(/^(\d+) pages/.exec(r.progress.results.site)![1]);
    expect(got).toBeGreaterThan(5); expect(got).toBeLessThan(31); // not all 30 slow pages and the stub site's own
    expect(warn.mock.calls.map(c => c.join(' ')).filter(w => /has had its 60 s of the page reader/.test(w))).toHaveLength(1);
    expect(r.ms).toBeLessThan(60_000 + 5_000 + 30_000); // the allowance, one more document, and the rest of the job
  });
  it('the reader cannot run (started where cheerio is not found): the job is put back for its second attempt, not failed as an unreachable site', async () => {
    // No reader may be left from the test before: one that is already running was started where cheerio is found.
    await readSitemap('<urlset/>', 'https://site.example/sitemap.xml', 'site.example', { idleMs: 1 }); await new Promise(resolve => setTimeout(resolve, 500));
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(os.tmpdir());
    let r: Awaited<ReturnType<typeof analyse>>;
    try { r = await analyse(M.rewrite, null); } finally { cwd.mockRestore(); }
    note('the reader cannot run', r);
    expect(r.job.status).toBe('queued'); expect(r.job.error).toBe('Radar couldn’t finish this. Try again.'); expect(r.progress?.failed).toBeUndefined();
  });
});
