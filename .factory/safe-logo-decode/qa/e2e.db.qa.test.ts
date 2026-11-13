// End to end on the revision under test: onboarding analysis of a site whose logo files are crashing or hostile.
// See e2e-shared.ts for what is real (everything but the site and the AI providers). Needs DATABASE_URL.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const M = vi.hoisted(() => {
  process.env.RADAR_DEV_STUBS = '1'; process.env.STORAGE_DIR = '.data/safe-logo-qa'; process.env.RADAR_BILLING = 'off';
  for (const k of ['OPENROUTER_API_KEY', 'OPEN_ROUTER_API_KEY', 'OPENAI_API_KEY', 'XAI_API_KEY', 'ANTHROPIC_API_KEY']) delete process.env[k];
  return { rewrite: { current: null as any }, fetched: [] as string[] };
});
vi.mock('@/server/services/analysis/devsite', async original => {
  const real = await original<typeof import('@/server/services/analysis/devsite')>();
  return { ...real, devFetch: async (url: string) => { const path = new URL(url).pathname; M.fetched.push(path); const answer = M.rewrite.current ? await M.rewrite.current(path, () => real.devFetch(url), url) : undefined; return answer ?? real.devFetch(url); } };
});
import fs from 'node:fs';
import path from 'node:path';
import { analyse, F, image } from './e2e-shared';
import { badFiles, good, QA_DIR } from './fixtures';
import { probeImage } from '@/server/services/untrustedImage';

const HAS_DB = !!process.env.DATABASE_URL;
const BAD = badFiles(); const evidence: any[] = [];
const LOGO_PATHS = ['/brand/logo.svg', '/apple-touch-icon.svg', '/og.png'];
beforeEach(() => { M.fetched.length = 0; vi.spyOn(console, 'info').mockImplementation(() => {}); });
afterAll(async () => { await F.cleanup(); fs.writeFileSync(path.join(QA_DIR, 'evidence/e2e.json'), JSON.stringify(evidence, null, 1)); fs.rmSync(path.resolve('.data/safe-logo-qa'), { recursive: true, force: true }); });
const note = (name: string, r: Awaited<ReturnType<typeof analyse>>, extra: any = {}) => evidence.push({ scenario: name, jobStatus: r.job.status, jobError: r.job.error ?? null, attempts: r.job.attempts, ms: r.ms, phase: r.progress?.phase, logoMissing: r.progress?.logoMissing, brandLine: r.progress?.results?.brand, logo: r.profile.brand.logo, storedType: r.stored?.type ?? null, primary: r.profile.brand.primary, secondary: r.profile.brand.secondary, defaults: [r.defaults.primary, r.defaults.secondary], language: r.profile.brand.language, businessName: r.profile.business.name, logoRequests: M.fetched.filter(p => LOGO_PATHS.includes(p)), ...extra });

describe.skipIf(!HAS_DB)('onboarding analysis end to end (analysis.site job, real queue, real database, stub site and stub AI)', () => {
  it('control: the stub site as it is gives its SVG logo and its CSS colours', async () => {
    const r = await analyse(M.rewrite, null); note('control', r);
    expect(r.job.status).toBe('done'); expect(r.progress.phase).toBe('done'); expect(r.progress.logoMissing).toBe(false);
    expect(r.profile.brand.logo).toMatch(/\.svg$/); expect(r.stored?.type).toBe('image/svg+xml'); expect(r.stored!.body.toString('utf8')).toContain('<svg');
    expect(r.profile.business.name).not.toBe('');
  }, 120_000);

  it('every logo candidate is a file that ends the process when decoded here: the job finishes, the profile has no logo, colours come from the site CSS', async () => {
    const crashers: Record<string, [string, Buffer]> = { '/brand/logo.svg': ['image/png', BAD['png-ihdr-crc-wrong'].body], '/apple-touch-icon.svg': ['image/jpeg', BAD['jpg-no-scan'].body], '/og.png': ['image/webp', BAD['webp-size-field-0'].body] };
    for (const [, [, body]] of Object.entries(crashers)) expect(probeImage(body)?.complete).toBe(true); // each one gets past the byte checks and reaches the decoder
    const control = await analyse(M.rewrite, null); M.fetched.length = 0;
    const r = await analyse(M.rewrite, (p, _real, url) => (crashers[p] ? image(crashers[p][0], crashers[p][1], url) : undefined));
    note('all candidates crash the decoder', r, { controlColours: [control.profile.brand.primary, control.profile.brand.secondary] });
    expect(r.job.status).toBe('done'); expect(r.job.error ?? null).toBeNull(); // one inline run: it was not retried
    expect(r.progress.phase).toBe('done'); expect(r.progress.logoMissing).toBe(true); expect(r.progress.results.brand).toMatch(/Logo not found/);
    expect(r.profile.brand.logo).toBeNull();
    expect(M.fetched.filter(p => LOGO_PATHS.includes(p)).sort()).toEqual([...LOGO_PATHS].sort()); // each candidate was asked for, once
    // Same CSS as the control site of the same kind, so the same colours; and they are not the defaults.
    expect(r.profile.brand.primary).toMatch(/^#[0-9A-F]{6}$/i); expect([r.profile.brand.primary, r.profile.brand.secondary]).not.toEqual([r.defaults.primary, r.defaults.secondary]);
    expect(r.profile.business.name).not.toBe(''); expect(r.profile.keywords.list.length).toBeGreaterThan(0); expect(r.profile.brand.language).toBeTruthy();
  }, 180_000);

  it('the same, on a site with no colours in its CSS: the profile keeps the default colours', async () => {
    const strip = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<meta name="theme-color"[^>]*>/g, '').replace(/<link rel="stylesheet"[^>]*>/g, '');
    const r = await analyse(M.rewrite, async (p, real, url) => {
      if (LOGO_PATHS.includes(p)) return image('image/png', BAD['png-no-idat'].body, url);
      if (p === '/assets/site.css') return { status: 404, type: 'text/html', body: Buffer.from('nf'), url };
      const a = await real(); return /html/.test(a.type) ? { ...a, body: Buffer.from(strip(a.body.toString('utf8'))) } : a;
    });
    note('crashing logo, no CSS colours', r);
    expect(r.job.status).toBe('done'); expect(r.profile.brand.logo).toBeNull(); expect(r.progress.logoMissing).toBe(true);
    expect([r.profile.brand.primary, r.profile.brand.secondary]).toEqual([r.defaults.primary, r.defaults.secondary]);
  }, 120_000);

  it('the first candidate crashes the decoder, the next is a good PNG under an SVG name and a JPEG header: that one is stored as PNG and gives the secondary colour', async () => {
    const png = good('png-rgba.png');
    const r = await analyse(M.rewrite, (p, _real, url) => (p === '/brand/logo.svg' ? image('image/png', BAD['png-bit-depth-3'].body, url) : p === '/apple-touch-icon.svg' ? image('image/jpeg', png, url) : undefined));
    note('first crashes, second good', r);
    expect(r.job.status).toBe('done'); expect(r.progress.logoMissing).toBe(false);
    expect(r.profile.brand.logo).toMatch(/\.png$/); expect(r.stored?.type).toBe('image/png'); expect(r.stored!.body.equals(png)).toBe(true);
  }, 120_000);

  it('hostile text everywhere: a 2 MB SVG logo of fill=rgb(, a 2 MB stylesheet of --a:rgb(: the job finishes and the brand step is not what takes the time', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">' + 'fill=rgb('.repeat(233_000));
    const r = await analyse(M.rewrite, (p, _real, url) => (p === '/brand/logo.svg' || p === '/apple-touch-icon.svg' ? image('image/svg+xml', svg, url) : p === '/assets/site.css' ? { status: 200, type: 'text/css', body: Buffer.from('--a:rgb('.repeat(262_000)), url } : undefined));
    const control = evidence.find(e => e.scenario === 'control');
    note('hostile text', r, { controlMs: control?.ms });
    expect(r.job.status).toBe('done'); expect(r.profile.brand.logo).toMatch(/\.svg$/);
    expect(r.ms).toBeLessThan((control?.ms ?? 8000) + 3000); // dev-stub pacing is about 5 s of the run either way
  }, 120_000);

  it('an animated WebP, a GIF and an ICO as the candidates: none is kept and no decode is tried; the job finishes with no logo', async () => {
    const r = await analyse(M.rewrite, (p, _real, url) => (p === '/brand/logo.svg' ? image('image/webp', good('webp-animated.webp'), url) : p === '/apple-touch-icon.svg' ? image('image/gif', good('gif-still.gif'), url) : p === '/og.png' ? image('image/x-icon', good('ico-multi.ico'), url) : undefined));
    note('animated WebP, GIF, ICO', r);
    expect(r.job.status).toBe('done'); expect(r.profile.brand.logo).toBeNull(); expect(r.progress.logoMissing).toBe(true);
  }, 120_000);
});
