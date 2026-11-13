// AC1, AC8, AC9 and the shared module: what the decoding child is given, that a time limit really ends it (looked up
// with `ps`), that too much output is refused, that a cover and a logo never decode at once, and what happens when the
// decoder cannot run. Real child processes throughout; the spawn is watched and, where a test says so, bent.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ spawns: [] as any[], active: 0, most: 0, bend: null as null | ((command: string, args: string[], options: any) => [string, string[], any] | 'throw'), fetchUrl: (..._a: any[]): any => null, puts: [] as any[] }));
vi.mock('node:child_process', async original => {
  const real = await original<typeof import('node:child_process')>();
  const spawn = (command: string, args: string[], options: any) => {
    const rec: any = { command, args, options, pid: undefined, startedAt: Date.now(), ended: null }; H.spawns.push(rec);
    const bent = H.bend ? H.bend(command, args, options) : null;
    if (bent === 'throw') throw Object.assign(new Error('spawn EAGAIN'), { code: 'EAGAIN' });
    const child = bent ? real.spawn(bent[0], bent[1], bent[2]) : real.spawn(command, args, options); rec.pid = child.pid; H.most = Math.max(H.most, ++H.active);
    child.on('error', () => {});
    child.on('close', (status, signal) => { H.active--; rec.ended = { status, signal, at: Date.now() }; });
    return child;
  };
  return { ...real, default: { ...real, spawn }, spawn };
});
vi.mock('@/server/services/analysis/crawl', async original => ({ ...(await original<any>()), fetchUrl: (...a: any[]) => H.fetchUrl(...a) }));
vi.mock('@/server/services/storage', async original => ({ ...(await original<any>()), putObject: async (key: string, body: Buffer, type: string) => { H.puts.push({ key, body, type }); return '/api/files/' + key; } }));
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectBrand, readLogo } from '@/server/services/analysis/brand';
import { ImageRefused, decodeInChild } from '@/server/services/untrustedImage';
import { readPicture } from '@/server/services/realCover/picture';
import { SitePictureError } from '@/server/services/realCover/fetch';
import { badFiles, bigFlatPng, good, pngChunks, pngFrom, QA_DIR } from './fixtures';
import { ORIGIN, page, site } from './harness';

const evidence: any = {};
afterAll(() => fs.writeFileSync(path.join(QA_DIR, 'evidence/child.json'), JSON.stringify(evidence, null, 1)));
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { H.spawns.length = 0; H.puts.length = 0; H.active = 0; H.most = 0; H.bend = null; warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { warn.mockRestore(); });
const LIMITS = { timeoutMs: 15_000, maxOutput: 1024 * 1024 };
/** Is a process with this id still there? Asked of the system, not of Node. */
const alive = (pid: number) => { try { return execFileSync('ps', ['-p', String(pid), '-o', 'pid=,stat=,command='], { encoding: 'utf8' }).trim().length > 0; } catch { return false; } };
const nodeChildrenOfMe = () => execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n').filter(l => { const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l); return m && +m[2] === process.pid && /node/.test(m[3]) && / -e /.test(m[3]); });
const P = good('png-rgba.png');

describe('AC1: nothing in brand.ts decodes', () => {
  it('brand.ts does not import the canvas library, and neither does anything else under analysis/ at load time', () => {
    const src = fs.readFileSync(path.resolve('src/server/services/analysis/brand.ts'), 'utf8');
    expect(src).not.toMatch(/@napi-rs\/canvas/); expect(src).not.toMatch(/\bloadImage\b/); // createCanvas appears only inside the text the child runs
    for (const f of fs.readdirSync(path.resolve('src/server/services/analysis')).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const s = fs.readFileSync(path.resolve('src/server/services/analysis', f), 'utf8');
      expect(/^import .*@napi-rs\/canvas/m.test(s), f).toBe(false); // devsite.ts imports it lazily, for the development stub pictures only
    }
  });
});

describe('AC9: what the child is given', () => {
  it('its environment is PATH and NODE_ENV and nothing else of this process (macOS adds one name of its own)', async () => {
    process.env.QA_SECRET_FOR_TEST = 'qa-secret-value'; process.env.DATABASE_URL_QA_COPY = 'postgres://user:pw@host/db';
    const { head } = await decodeInChild(P, `reply({ env: process.env, argv: process.argv.slice(1), execArgv: process.execArgv, cwd: process.cwd() });`, { side: 48 }, LIMITS);
    delete process.env.QA_SECRET_FOR_TEST; delete process.env.DATABASE_URL_QA_COPY;
    evidence.childSees = { envNames: Object.keys(head.env), argv: head.argv, execArgvKinds: head.execArgv.map((a: string) => a.slice(0, 12)), cwdIsWorktree: head.cwd === process.cwd() };
    expect(Object.keys(H.spawns[0].options.env).sort()).toEqual(['NODE_ENV', 'PATH']);
    expect(Object.keys(head.env).filter(k => k !== '__CF_USER_TEXT_ENCODING').sort()).toEqual(['NODE_ENV', 'PATH']);
    expect(JSON.stringify(head.env)).not.toContain('qa-secret-value'); expect(JSON.stringify(head.env)).not.toContain('postgres://');
    expect(head.env.PATH).toBe(process.env.PATH); expect(head.env.NODE_ENV).toBe(process.env.NODE_ENV);
    expect(H.spawns[0].options.stdio).toEqual(['pipe', 'pipe', 'ignore']);
  });
  it('with NODE_ENV not set in this process, the child has no NODE_ENV (not the text "undefined")', async () => {
    const was = process.env.NODE_ENV; delete (process.env as any).NODE_ENV;
    try { const { head } = await decodeInChild(P, `reply({ has: 'NODE_ENV' in process.env, value: String(process.env.NODE_ENV) });`, {}, LIMITS); evidence.nodeEnvUnset = head; expect(head.has).toBe(false); }
    finally { (process.env as any).NODE_ENV = was; }
  });
  it('its arguments are the same for two different logos, and hold nothing from either (a marker planted in each is looked for)', async () => {
    const marked = (marker: string) => { const cs = pngChunks(P); return pngFrom([cs[0], { type: 'tEXt', data: Buffer.from('Comment\0' + marker, 'latin1') }, ...cs.slice(1)]); };
    const a = marked('QA-MARKER-ALPHA-7781'), b = marked('QA-MARKER-BRAVO-9920');
    for (const [body, name] of [[a, '/a.png'], [b, '/b.png']] as const) { H.fetchUrl = site({ [name]: { type: 'image/png', body } }).fetchUrl; const r = await detectBrand('qa', page([name]), ORIGIN); expect(r.logo).not.toBeNull(); }
    expect(H.spawns).toHaveLength(2);
    const [x, y] = H.spawns;
    expect(x.args).toEqual(y.args); expect(x.args).toHaveLength(3); expect(x.args[0]).toBe('-e'); expect(JSON.parse(x.args[2])).toEqual({ side: 48 });
    for (const s of [x, y]) for (const needle of ['QA-MARKER', Buffer.from('QA-MARKER').toString('base64').slice(0, 10), Buffer.from('QA-MARKER').toString('hex'), '/a.png', '/b.png', ORIGIN, 'logo-qa.example', P.subarray(0, 8).toString('latin1'), P.toString('base64').slice(0, 24)]) expect(JSON.stringify([s.command, s.args, s.options.cwd, s.options.env]).includes(needle), needle).toBe(false);
    expect(x.command).toBe(process.execPath);
    evidence.args = { count: x.args.length, first: x.args[0], scriptBytes: x.args[1].length, options: x.args[2] };
  });
});

describe('AC9: a child that does not answer in time is really stopped', () => {
  it.each([
    ['one that waits for ever', `setInterval(() => {}, 1000);`],
    ['one that spins without yielding', `while (true) {}`],
    ['one that ignores polite signals and closes its output', `process.on('SIGTERM', () => {}); process.on('SIGINT', () => {}); process.stdout.end(); setInterval(() => {}, 1000);`],
  ])('%s: refused as timed_out at the limit, and no process is left', async (_name, work) => {
    const t = Date.now();
    const error = await decodeInChild(P, work, {}, { timeoutMs: 800, maxOutput: 1024 }).then(() => null, e => e);
    const ms = Date.now() - t;
    expect(error).toBeInstanceOf(ImageRefused); expect(error.reason).toBe('timed_out');
    expect(ms).toBeGreaterThanOrEqual(780); expect(ms).toBeLessThan(2500);
    const pid = H.spawns[0].pid; expect(pid).toBeGreaterThan(0);
    expect(H.spawns[0].ended).toMatchObject({ signal: 'SIGKILL' });
    expect(alive(pid)).toBe(false);
    expect(nodeChildrenOfMe()).toEqual([]);
    (evidence.timeouts ??= []).push({ work: _name, ms, ended: H.spawns[0].ended.signal, stillThere: alive(pid) });
  });
  it('through detectBrand: a decode that never answers costs ten seconds, is stopped, and the next candidate is used', async () => {
    H.bend = (command, _args, options) => (H.spawns.length === 1 ? [command, ['-e', 'setInterval(() => {}, 1000)'], options] : [command, _args, options]); // the first child started is one that never reads or answers
    H.fetchUrl = site({ '/stuck.png': { type: 'image/png', body: P }, '/ok.jpg': { type: 'image/jpeg', body: good('jpg-baseline.jpg') } }).fetchUrl;
    let ticks = 0; const beat = setInterval(() => { ticks++; }, 100);
    const t = Date.now(); const r = await detectBrand('qa', page(['/stuck.png', '/ok.jpg']), ORIGIN); const ms = Date.now() - t; clearInterval(beat);
    expect(ms).toBeGreaterThanOrEqual(9_900); expect(ms).toBeLessThan(12_500);
    expect(H.spawns).toHaveLength(2); expect(H.spawns[0].ended).toMatchObject({ signal: 'SIGKILL' }); expect(alive(H.spawns[0].pid)).toBe(false);
    expect(H.puts).toHaveLength(1); expect(H.puts[0].type).toBe('image/jpeg'); expect(r.logo).toMatch(/\.jpg$/);
    expect(ticks).toBeGreaterThan(90); // this process kept running its own timers while it waited
    expect(nodeChildrenOfMe()).toEqual([]);
    evidence.stuckDecode = { ms, ticksOf100ms: ticks, firstEndedBy: H.spawns[0].ended.signal, kept: H.puts[0].type };
  }, 30_000);
});

describe('the answer is bounded', () => {
  it('more output than the limit is refused and the child is stopped, also when it would write for ever', async () => {
    const once = await decodeInChild(P, `reply({}, Buffer.alloc(o.n, 1));`, { n: 200_000 }, { timeoutMs: 15_000, maxOutput: 100_000 }).then(() => null, e => e);
    expect(once).toBeInstanceOf(ImageRefused); expect(once.reason).toBe('too_much_output');
    const t = Date.now();
    const flood = await decodeInChild(P, `const b = Buffer.alloc(65536, 1); const more = () => { while (process.stdout.write(b)); process.stdout.once('drain', more); }; more();`, {}, { timeoutMs: 15_000, maxOutput: 1_000_000 }).then(() => null, e => e);
    expect(flood).toBeInstanceOf(ImageRefused); expect(flood.reason).toBe('too_much_output'); expect(Date.now() - t).toBeLessThan(5000);
    for (const s of H.spawns) expect(alive(s.pid)).toBe(false);
    const fits = await decodeInChild(P, `reply({ ok: true }, Buffer.alloc(o.n, 1));`, { n: 90_000 }, { timeoutMs: 15_000, maxOutput: 100_000 });
    expect(fits.data.length).toBe(90_000);
  });
  it('an answer that is not the agreed shape is refused: nothing, rubbish, a wrong length, a head that is not an object', async () => {
    const cases: Record<string, string> = {
      'exits without answering': `process.exit(0);`,
      'writes rubbish': `process.stdout.write('hello', () => process.exit(0));`,
      'a length longer than the answer': `const b = Buffer.alloc(4); b.writeUInt32BE(999999); process.stdout.write(Buffer.concat([b, Buffer.from('{}')]), () => process.exit(0));`,
      'a head that is a string': `answer({ head: 'x' });`,
      'a head that is null': `answer({ head: null });`,
      'exits with status 3': `process.exit(3);`,
      'ends itself with a signal': `process.kill(process.pid, 'SIGSEGV');`,
      'throws': `throw new Error('no');`,
      'throws later, outside the work': `setTimeout(() => { throw new Error('later'); }, 10);`,
    };
    const got: Record<string, string> = {};
    for (const [name, work] of Object.entries(cases)) { const e = await decodeInChild(P, work, {}, LIMITS).then(() => null, x => x); expect(e, name).toBeInstanceOf(ImageRefused); got[name] = e.reason; }
    evidence.badAnswers = got;
    expect(got).toMatchObject({ 'exits without answering': 'no_answer', 'writes rubbish': 'no_answer', 'exits with status 3': 'crashed', 'ends itself with a signal': 'crashed', 'throws': 'work_failed' });
  });
  it('a logo whose sample is not exactly 48×48 pixels of RGBA is not kept (the child is bent to answer with less)', async () => {
    H.bend = (command, args, options) => [command, [args[0], args[1].replace('o.side, o.side).data', '24, 24).data'), args[2]], options];
    expect(await readLogo(P, 'image/png')).toBeNull();
    H.bend = (command, args, options) => [command, [args[0], args[1].replace('w: img.width, h: img.height', 'w: 10, h: 10'), args[2]], options];
    expect(await readLogo(P, 'image/png')).toBeNull(); // the decoder saw a smaller picture than the bytes declared
    H.bend = null; expect((await readLogo(P, 'image/png'))?.colors[0]).toBe('#187878');
  });
});

describe('the pipe to the child', () => {
  it('a child that ends, or closes its input, before it has read a 3 MB picture is one refused picture and no error in this process', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 7); const seen: any[] = []; const onError = (e: any) => seen.push(e);
    process.on('uncaughtException', onError); process.on('unhandledRejection', onError);
    try {
      for (const script of ['process.exit(0)', 'process.stdin.destroy(); setTimeout(() => process.exit(0), 200)', 'process.exit(7)', 'process.kill(process.pid, "SIGKILL")']) {
        H.bend = (command, _args, options) => [command, ['-e', script], options];
        const e = await decodeInChild(big, 'reply({})', {}, LIMITS).then(() => null, x => x);
        expect(e, script).toBeInstanceOf(ImageRefused);
      }
      await new Promise(r => setTimeout(r, 200));
      expect(seen).toEqual([]);
    } finally { process.off('uncaughtException', onError); process.off('unhandledRejection', onError); }
    H.bend = null; expect(await readLogo(P, 'image/png')).not.toBeNull();
  });
});

describe('a real picture at the size limit', () => {
  it.each([[5000, 5000, true], [10000, 2500, true], [5001, 5000, false], [10001, 100, false]])('a valid flat PNG of %i×%i: %s', async (w, h, kept) => {
    const body = bigFlatPng(w, h); expect(body.length).toBeLessThan(2 * 1024 * 1024);
    H.fetchUrl = site({ '/big.png': { type: 'image/png', body } }).fetchUrl;
    const t = Date.now(); const r = await detectBrand('qa', page(['/big.png'], { styled: false }), ORIGIN); const ms = Date.now() - t;
    (evidence.atTheLimit ??= []).push({ size: `${w}x${h}`, fileBytes: body.length, ms, kept: !!r.logo, children: H.spawns.length, primary: r.primary });
    if (kept) { expect(r.logo).toMatch(/\.png$/); expect(r.primary).toBe('#187878'); expect(H.spawns).toHaveLength(1); expect(ms).toBeLessThan(10_000); }
    else { expect(r.logo).toBeNull(); expect(H.spawns).toHaveLength(0); }
  }, 60_000);
});

describe('AC9: a cover and a logo are never decoded at the same moment', () => {
  it('three covers and five logos asked for together: one child at a time, in the order asked, each with its own answer; a crash in the middle holds nothing up', async () => {
    const photo = good('og-1200x630.png'); const crash = badFiles()['png-no-idat'].body;
    const order: string[] = []; const tag = <T,>(name: string, p: Promise<T>) => p.then(v => { order.push(name); return v; }, e => { order.push(name + '!'); throw e; });
    const jobs = [
      tag('cover1', readPicture({ url: 'https://x.example/a.png', type: 'image/png', body: photo })),
      tag('logo1', readLogo(P, 'image/png')),
      tag('crash', readLogo(crash, 'image/png')),
      tag('cover2', readPicture({ url: 'https://x.example/b.png', type: 'image/png', body: photo })),
      tag('logo2', readLogo(good('jpg-baseline.jpg'), 'image/jpeg')),
      tag('smallcover', readPicture({ url: 'https://x.example/c.png', type: 'image/png', body: P }).catch(e => e)),
      tag('logo3', readLogo(good('webp-lossy.webp'), 'image/webp')),
      tag('logo4', readLogo(good('png-512.png'), 'image/png')),
    ];
    const [c1, l1, cr, c2, l2, sc, l3, l4] = await Promise.all(jobs) as any[];
    expect(H.most).toBe(1); expect(H.spawns).toHaveLength(8);
    // No two children overlapped in time, by their own start and end stamps.
    for (let i = 1; i < H.spawns.length; i++) expect(H.spawns[i].startedAt).toBeGreaterThanOrEqual(H.spawns[i - 1].ended.at);
    expect(order).toEqual(['cover1', 'logo1', 'crash', 'cover2', 'logo2', 'smallcover', 'logo3', 'logo4']);
    expect(c1.png.length).toBeGreaterThan(1000); expect([c1.w, c1.h]).toEqual([1200, 630]); expect(c2.fit).toBe(c1.fit);
    expect(l1).toMatchObject({ type: 'image/png', ext: 'png' }); expect(l1.colors[0]).toBe('#187878');
    expect(cr).toBeNull(); expect(H.spawns[2].ended.signal).toBe('SIGSEGV');
    expect(l2).toMatchObject({ type: 'image/jpeg', ext: 'jpg' }); expect(l3).toMatchObject({ type: 'image/webp', ext: 'webp' }); expect(l4.colors[0]).toBe('#187878');
    expect(sc).toBeInstanceOf(SitePictureError); expect(sc.code).toBe('too_small');
    evidence.together = { children: H.spawns.length, mostAtOnce: H.most, order, endings: H.spawns.map((s: any) => s.ended.signal || 'exit ' + s.ended.status) };
  }, 60_000);
  it('a cover still refuses what it refused before the move: a crashing file is not_a_picture, a huge declared size is too_large, and no child for the second', async () => {
    const e1 = await readPicture({ url: 'u', type: 'image/png', body: badFiles()['png-ihdr-crc-wrong'].body }).catch(e => e);
    expect(e1).toBeInstanceOf(SitePictureError); expect(e1.code).toBe('not_a_picture'); expect(H.spawns).toHaveLength(1);
    const e2 = await readPicture({ url: 'u', type: 'image/png', body: badFiles()['png-declares-10000x2501'].body }).catch(e => e);
    expect(e2.code).toBe('too_large'); expect(H.spawns).toHaveLength(1);
    const e3 = await readPicture({ url: 'u', type: 'image/svg+xml', body: P }).catch(e => e); expect(e3.code).toBe('not_a_picture'); expect(H.spawns).toHaveLength(1);
  });
});

describe('AC6: an SVG logo never starts a child', () => {
  it('SVG under an SVG header is stored as SVG with the colours its text declares; an inline header SVG too; SVG under a raster header and other bytes under an SVG header are skipped; no child in any case', async () => {
    const svg = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 9"><rect fill="#0F766E" width="9" height="9"/><path stroke="rgb(192, 38, 211)" d="M0 0h9"/><image href="https://elsewhere.example/a.png"/></svg>';
    const cases: [string, Record<string, any>, string[], string | null, string | null][] = [
      ['SVG as image/svg+xml', { '/l.svg': { type: 'image/svg+xml', body: svg } }, ['/l.svg'], 'image/svg+xml', '#0F766E'],
      ['SVG as image/svg+xml; charset=utf-8', { '/l.svg': { type: 'image/svg+xml; charset=utf-8', body: svg } }, ['/l.svg'], 'image/svg+xml', '#0F766E'],
      ['SVG as image/png', { '/l.png': { type: 'image/png', body: svg } }, ['/l.png'], null, null],
      ['SVG as image/webp', { '/l.webp': { type: 'image/webp', body: svg } }, ['/l.webp'], null, null],
      ['PNG as image/svg+xml', { '/l.svg': { type: 'image/svg+xml', body: P } }, ['/l.svg'], null, null],
      ['GIF as image/svg+xml', { '/l.svg': { type: 'image/svg+xml', body: good('gif-still.gif') } }, ['/l.svg'], null, null],
    ];
    for (const [name, files, candidates, type, primary] of cases) {
      H.puts.length = 0; H.spawns.length = 0; H.fetchUrl = site(files).fetchUrl;
      const r = await detectBrand('qa', page(candidates, { styled: false }), ORIGIN);
      expect(H.spawns, name).toHaveLength(0); expect(H.puts[0]?.type ?? null, name).toBe(type); expect(r.primary, name).toBe(primary);
      if (type) { expect(H.puts[0].key).toMatch(/\.svg$/); expect(H.puts[0].body.toString('utf8')).toBe(svg); expect(r.secondary).toBe('#C026D3'); }
    }
    H.puts.length = 0; H.fetchUrl = site({}).fetchUrl;
    const inline = await detectBrand('qa', page([], { styled: false, body: '<header><svg viewBox="0 0 9 9"><rect fill="#7C3AED" width="9" height="9"/></svg></header>' }), ORIGIN);
    expect(H.spawns).toHaveLength(0); expect(H.puts[0].type).toBe('image/svg+xml'); expect(inline.primary).toBe('#7C3AED');
  });
});

describe('AC8: a decoder that cannot run does not cost the site its logo', () => {
  const run = async (files: Record<string, any>, candidates: string[]) => { H.fetchUrl = site(files).fetchUrl; return detectBrand('qa', page(candidates, { styled: false }), ORIGIN); };
  it.each([
    ['starting a child throws', () => { H.bend = () => 'throw'; }],
    ['the program to start does not exist', () => { H.bend = (_c, args, options) => ['/nonexistent/qa/node', args, options]; }],
    ['the child starts where the canvas library cannot be found', () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-nocanvas-')); H.bend = (c, args, options) => [c, args, { ...options, cwd: dir }]; }],
  ])('%s: the logo is kept under what its bytes are, with no logo colours, one warning; the next call works', async (name, breakIt) => {
    breakIt();
    const r = await run({ '/a.webp': { type: 'image/png', body: good('webp-lossy.webp') }, '/b.png': { type: 'image/png', body: P } }, ['/a.webp', '/b.png']);
    expect(H.puts).toHaveLength(1); expect(H.puts[0].type).toBe('image/webp'); expect(H.puts[0].key).toMatch(/\.webp$/); expect(r.logo).not.toBeNull();
    expect(r.primary).toBeNull(); expect(r.secondary).toBeNull(); // no colours from the logo, none in the page
    expect(warn).toHaveBeenCalledTimes(1);
    const said = warn.mock.calls[0].join(' '); expect(said).toMatch(/logo kept without its colors/); expect(said).not.toContain('RIFF');
    (evidence.unavailable ??= []).push({ how: name, warning: said });
    H.bend = null; H.puts.length = 0; warn.mockClear();
    const again = await run({ '/b.png': { type: 'image/png', body: P } }, ['/b.png']);
    expect(again.primary).toBe('#187878'); expect(warn).not.toHaveBeenCalled();
  });
  it('colours still come from the page when the decoder is down, and one warning covers the whole detection', async () => {
    H.bend = () => 'throw';
    H.fetchUrl = site({ '/a.png': { type: 'image/png', body: P } }).fetchUrl;
    const r = await detectBrand('qa', page(['/a.png']), ORIGIN);
    expect(r.primary).toBe('#2563EB'); expect(r.logo).not.toBeNull(); expect(warn).toHaveBeenCalledTimes(1);
  });
  it('while the decoder is down: what the bytes refuse is still refused, an SVG still gives its colours, and a file that would crash the decoder is kept unseen (D6, recorded)', async () => {
    H.bend = () => 'throw';
    const cut = await run({ '/cut.png': { type: 'image/png', body: badFiles()['png-cut-50pct'].body } }, ['/cut.png']); expect(cut.logo).toBeNull();
    H.puts.length = 0;
    const svg = await run({ '/l.svg': { type: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#0F766E"/></svg>'.padEnd(120, ' ') } }, ['/l.svg']); expect(svg.primary).toBe('#0F766E');
    H.puts.length = 0;
    const crasher = await run({ '/x.png': { type: 'image/png', body: badFiles()['png-no-idat'].body } }, ['/x.png']);
    evidence.decoderDownKeepsUndecodable = { logo: crasher.logo, stored: H.puts[0]?.type ?? null };
    expect(crasher.logo).not.toBeNull(); // D6: the bytes passed the checks; nothing could look further
  });
});
