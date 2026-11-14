// The caller paths (AC3, AC4, AC5), the decoder being unavailable (AC6), the queue, and the limits of one child.
// images.ts, social/generate.ts and the child process are real. Replaced: the provider's HTTP answer, storage, the
// database, the text model, the failure reports. loadImage inside this process is counted and must stay at 0: every
// comparison is against the brand template (drawn here, never decoded) or against evidence/old.json (checksums made by
// old-decode.mjs in other processes). Needs QA_CORPUS. Writes evidence/paths.json and evidence/child-program.js.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({
  spawn: null as any, real: null as any, calls: [] as { command: string; args: string[]; options: any }[], active: 0, most: 0, loads: 0,
  stored: [] as { key: string; body: Buffer }[], reports: [] as any[], rows: [] as any[], packs: [] as any[],
}));
vi.mock('node:child_process', async original => {
  const real = await original<typeof import('node:child_process')>();
  H.real = (...a: any[]) => { H.most = Math.max(H.most, ++H.active); const child = (real.spawn as any)(...a); let done = false; const end = () => { if (!done) { done = true; H.active--; } }; child.on('close', end); child.on('error', end); return child; };
  const spawn = (...a: any[]) => { H.calls.push({ command: a[0], args: a[1], options: a[2] }); return (H.spawn || H.real)(...a); };
  return { ...real, default: { ...real, spawn }, spawn };
});
vi.mock('@napi-rs/canvas', async original => {
  const real = await original<typeof import('@napi-rs/canvas')>();
  const loadImage = (...a: any[]) => { H.loads++; return (real.loadImage as any)(...a); };
  return { ...real, default: { ...(real as any).default, loadImage }, loadImage };
});
vi.mock('@/server/db', () => {
  const tx = { insert: () => ({ values: (v: any) => ({ onConflictDoNothing: () => ({ returning: async () => { H.packs.push(v.data); return [{ id: v.id }]; } }) }) }) };
  return { db: { insert: () => ({ values: (row: any) => { H.rows.push(row); return Promise.resolve(); } }), transaction: async (fn: any) => fn(tx) }, schema: { aiCalls: {}, socialPacks: { id: 'id', businessId: 'business_id' } } };
});
vi.mock('@/server/ai', () => ({ ai: { run: async (_task: string, input: any) => ({ json: { text: `A post about keeping documentation current, for ${input.stubContext.platform}.` } }) }, profileContext: () => 'BUSINESS PROFILE\nName: Fieldnote' }));
vi.mock('@/server/workspace', () => ({ getBiz: async () => ({ domain: 'fieldnote.test', profile: { business: { name: 'Fieldnote', description: 'Documentation tools' }, brand: { voice: 'Clear', language: 'English (US)', primary: '#112233', secondary: '#445566' }, audience: { competitors: [] } } }), bizToday: () => '2026-11-14' }));
vi.mock('@/server/observability/failures', () => ({ reportFailure: async (e: any, context: any) => { H.reports.push({ ...context, message: String(e?.message) }); } }));
vi.mock('@/server/services/storage', () => ({ objectKey: (bid: string, kind: string, ext: string) => `${bid}/${kind}/${H.stored.length}.${ext}`, putObject: async (key: string, body: Buffer) => { H.stored.push({ key, body }); return `mem://${key}`; } }));
vi.mock('@/server/services/lifecycle/engagement', () => ({ recordEngagement: async () => {}, resolveEngagement: async () => {} }));
vi.mock('@/server/services/social/source', () => ({ readArticle: async () => { throw new Error('unused'); }, readUrl: async () => { throw new Error('unused'); } }));
vi.mock('@/server/services/social/stubs', () => ({}));
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IMG_SIZES } from '@/lib/constants';
import { RadarError } from '@/server/errors';
import { env } from '@/server/env';
import * as images from '@/server/services/images';
import { createPack } from '@/server/services/social/generate';

const CORPUS = process.env.QA_CORPUS || '';
const EVIDENCE = path.resolve('.factory/safe-provider-image-decode/qa/evidence');
const manifest: { group: string; name: string; file: string; note: string }[] = CORPUS ? JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8')) : [];
const old: any[] = fs.existsSync(path.join(EVIDENCE, 'old.json')) ? JSON.parse(fs.readFileSync(path.join(EVIDENCE, 'old.json'), 'utf8')) : [];
const oldOf = new Map(old.map(r => [r.group + '/' + r.name, r]));
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const file = (name: string) => fs.readFileSync(manifest.find(m => m.name === name)!.file);
const baseSha = (name: string, size = '1200x628') => oldOf.get(manifest.find(m => m.name === name)!.group + '/' + name).out.find((x: any) => x.size === size).sha as string;
const BRAND = { primary: '#112233', secondary: '#445566' };
const req = (over: Record<string, any> = {}) => ({ bid: 'biz-1', style: 'illustration', brand: BRAND, headline: 'Keeping docs current', name: 'Fieldnote', seed: 3, w: 1200, h: 628, kind: 'hero', ...over });
const caught = (p: Promise<any>) => p.then(v => { throw new Error('expected a rejection, got ' + typeof v); }, (e: any) => e);
const plain = (e: any) => e instanceof Error && !(e instanceof RadarError) && Object.getPrototypeOf(e) === Error.prototype && e.code === undefined && (e as any).status === undefined;
let asked = 0;
const provider = (bytes: Buffer) => { asked = 0; vi.stubGlobal('fetch', vi.fn(async () => { asked++; return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64'), media_type: 'image/png' }], usage: { cost: 0.039 } }), { status: 200, headers: { 'content-type': 'application/json' } }); })); };
const out: Record<string, any> = {};
const was = { devStubs: env.devStubs, openrouterKey: env.openrouterKey, openaiKey: env.openaiKey, xaiKey: env.xaiKey };

beforeEach(() => {
  Object.assign(env, { devStubs: false, openrouterKey: 'sk-or-v1-qa0123456789', openaiKey: '', xaiKey: '' });
  delete process.env.RADAR_SOCIAL_PACK_IMAGE;
  H.spawn = null; H.calls.length = 0; H.stored.length = 0; H.reports.length = 0; H.rows.length = 0; H.packs.length = 0; H.most = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); Object.assign(env, was); });
afterAll(() => { fs.writeFileSync(path.join(EVIDENCE, 'paths.json'), JSON.stringify({ node: process.version, platform: `${process.platform} ${process.arch}`, ...out }, null, 1)); });

// Every file of the brief, every 9th file the base's process died on, and named files of each other kind.
const NAMED = ['png-1-byte-after-iend.png', 'jpeg-8kb-after-eoi.jpg', 'jpeg-no-eoi.jpg', 'gif-640x400.gif', 'tiff-640x400.tiff', 'tiff-sips-640x400.tiff', 'bmp-640x400.bmp', 'ico-64.ico', 'avif-640x400.avif', 'heic-640x400.heic', 'svg-plain.svg', 'webp-animated.webp', 'apng-2-frames.png',
  'real-5001x5000.png', 'png-declares-100000x100000-crc-ok.png', 'jpeg-declares-65535x65535.jpg', 'webp-vp8x-canvas-8x8-inner-12000x9000.webp', 'webp-animated-frames-flag-clear.webp', 'png-declares-0x48-crc-ok.png',
  'poly-png-header-then-svg-then-iend.png', 'poly-jpeg-header-then-html-then-eoi.jpg', 'poly-html.html', 'poly-json-error.json', 'short-00-zero-bytes.bin', 'png-idat-zlib-bomb.png', 'png-two-ihdr.png', 'jpeg-two-sof-second-60000.jpg', 'webp-vp8-zero-length.webp', 'png-idat-empty.png', 'jpeg-dqt-length-2.jpg', 'png-crc-wrong-chunk0-IHDR.png'];
const died = old.filter(r => r.signal && r.group === 'bad').map(r => r.name);
const SAMPLE = [...new Set([...manifest.filter(m => m.name.startsWith('brief-')).map(m => m.name), ...died.filter((_, i) => i % 9 === 0), ...NAMED])].filter(n => manifest.some(m => m.name === n));

describe.skipIf(!CORPUS)('each caller path, for a sample of the corpus', () => {
  it(`${SAMPLE.length} files as the provider’s picture: a cover (not strict), a strict request, a pack’s shared image`, async () => {
    const problems: string[] = []; const tally: Record<string, number> = {}; const perFile: any[] = [];
    const template = { cover: images.renderTemplatePng(req() as any), post: images.renderTemplatePng(req({ kind: 'social' }) as any) };
    for (const name of SAMPLE) {
      const m = manifest.find(x => x.name === name)!; const raw = fs.readFileSync(m.file); const o = oldOf.get(m.group + '/' + name);
      const crop = o.out?.[0]?.ok ? o.out[0].sha : null; // what the base stored, when it survived and decoded
      // An empty answer never reaches coverCrop: the provider step itself says "empty" (unchanged code), so its reports and message are its own.
      const empty = raw.length === 0;
      provider(raw); H.stored.length = 0; H.reports.length = 0; const loads = H.loads; const children = H.calls.length;
      // (a) not strict: resolves, and stores the template marked 'failed' or the crop unmarked.
      const cover: any = await images.renderImageFile(req() as any).catch(e => ({ threw: e }));
      const a = cover.threw ? 'threw' : H.stored[0]?.body.equals(template.cover) && cover.placeholder === 'failed' ? 'template, marked failed' : !cover.placeholder && crop && sha(H.stored[0].body) === crop ? 'the crop' : 'something else';
      if (!empty && a === 'template, marked failed' && !(H.reports.length === 1 && H.reports[0].degraded === true && H.reports[0].operation === 'image.generate')) problems.push(`${name}: fallback not reported as degraded once`);
      // (b) strict: rejects with a plain Error and stores nothing, or stores the crop.
      const n = H.stored.length; H.reports.length = 0;
      const strict: any = await images.renderImageFile(req({ modelRequired: true, prompt: 'A desk' }) as any).then(v => ({ value: v }), e => ({ threw: e }));
      const b = strict.threw ? (plain(strict.threw) && H.stored.length === n ? 'rejected, nothing stored' : 'rejected oddly') : crop && sha(H.stored[n].body) === crop && !strict.value.placeholder ? 'the crop' : 'something else';
      if (strict.threw && !(empty ? /^openrouter image: empty$/ : /^The image model.s picture was refused: /).test(strict.threw.message)) problems.push(`${name}: strict message: ${strict.threw.message}`);
      if (!empty && strict.threw && !(H.reports.length === 1 && !H.reports[0].degraded)) problems.push(`${name}: strict failure not reported once as a failure`);
      // (c) a pack's shared image: no model is asked; the template with no mark, or the crop.
      const k = H.stored.length; const before = asked;
      const post: any = await images.renderImageFile(req({ kind: 'social' }) as any, { raw }).catch(e => ({ threw: e }));
      const c = post.threw ? 'threw' : 'placeholder' in post ? 'marked' : H.stored[k].body.equals(template.post) ? 'template, no mark' : crop && sha(H.stored[k].body) === crop ? 'the crop' : 'something else';
      if (asked !== before) problems.push(`${name}: the shared-image path asked the model`);
      const key = `${a} | ${b} | ${c}`; tally[key] = (tally[key] || 0) + 1;
      perFile.push({ name, base: o.signal || (crop ? 'cropped' : 'threw'), a, b, c, children: H.calls.length - children });
      const refused = a === 'template, marked failed' && b === 'rejected, nothing stored' && c === 'template, no mark';
      const accepted = a === 'the crop' && b === 'the crop' && c === 'the crop';
      if (!refused && !accepted) problems.push(`${name}: ${key}`);
      if (accepted && o.signal) problems.push(`${name}: stored a picture from a file that ended the base's process`);
      if (H.loads !== loads) problems.push(`${name}: loadImage ran in this process`);
      if (H.active !== 0) problems.push(`${name}: a child outlived the request`);
    }
    out.callerPaths = { files: SAMPLE.length, tally, perFile };
    expect(problems).toEqual([]);
    // Afterwards, in the same process: a good picture is stored as the base's crop on all three paths.
    provider(file('canvas-1536x1024.png')); H.stored.length = 0;
    await images.renderImageFile(req() as any); await images.renderImageFile(req({ modelRequired: true, prompt: 'A desk' }) as any); await images.renderImageFile(req({ kind: 'social' }) as any, { raw: file('canvas-1536x1024.jpg') });
    expect(H.stored.map(s => sha(s.body))).toEqual([baseSha('canvas-1536x1024.png'), baseSha('canvas-1536x1024.png'), baseSha('canvas-1536x1024.jpg')]);
    expect(H.loads).toBe(0);
  });

  it('createPack: one refused picture for the pack gives every platform its own template; a good one gives every platform its crop', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // seed0 = 25: the posts' seeds are 175, 176, …
    const platforms = ['linkedin', 'x', 'reddit', 'facebook', 'quora'] as const; const rows: any[] = [];
    for (const name of ['brief-png-no-idat.png', 'brief-ffd8ffd9.jpg', 'brief-png-ihdr-crc.png', 'brief-jpeg-no-scan.jpg', 'png-1-byte-after-iend.png', 'tiff-640x400.tiff', 'gif-640x400.gif', 'svg-plain.svg', 'webp-animated.webp', 'real-5001x5000.png', 'cutclosed-webp-at-00024.webp', 'webp-vp8x-canvas-8x8-inner-12000x9000.webp']) {
      if (!manifest.some(m => m.name === name)) continue;
      provider(file(name)); H.stored.length = 0; H.packs.length = 0; H.reports.length = 0; const children = H.calls.length;
      await createPack('biz-1', { source: { kind: 'idea', label: 'Keeping docs current' }, platforms: [...platforms], style: 'illustration' } as any);
      expect(asked).toBe(1); expect(H.stored).toHaveLength(platforms.length);
      const posts = H.packs[0].posts;
      for (const [i, k] of platforms.entries()) {
        const [w, h] = IMG_SIZES[k];
        expect(H.stored[i].body.equals(images.renderTemplatePng({ style: 'illustration', brand: BRAND, headline: 'Keeping docs current', name: 'Fieldnote', seed: 175 + i, w, h } as any)), `${name} ${k}`).toBe(true);
        expect(posts[k]).toMatchObject({ imageUrl: `mem://${H.stored[i].key}`, imageMeta: { bytes: H.stored[i].body.length, type: 'image/png' } });
      }
      rows.push({ name, children: H.calls.length - children, degradedReports: H.reports.filter(r => r.degraded).length, photoFlags: platforms.map(k => posts[k].photo) });
    }
    out.createPack = rows;
    // A good 3:2 picture: five crops, each the base's bytes for that size, one child at a time.
    provider(file('canvas-1536x1024.png')); H.stored.length = 0; H.packs.length = 0; H.most = 0;
    await createPack('biz-1', { source: { kind: 'idea', label: 'Keeping docs current' }, platforms: [...platforms], style: 'illustration' } as any);
    expect(H.stored.map(s => sha(s.body))).toEqual(platforms.map(k => baseSha('canvas-1536x1024.png', IMG_SIZES[k].join('x'))));
    expect(H.most).toBe(1); expect(H.loads).toBe(0);
  });
});

describe.skipIf(!CORPUS)('many crops asked for together', () => {
  it('60 crops of good, refused and crashing files at once: all settle, in order, one child at a time, good ones are the base’s bytes', async () => {
    const names = ['canvas-1536x1024.png', 'brief-png-no-idat.png', 'canvas-1024x1536.jpg', 'svg-plain.svg', 'brief-jpeg-no-scan.jpg', 'canvas-1024x1024.webp', 'png-1-byte-after-iend.png', 'webp-vp8x-canvas-8x8-inner-64x48.webp', 'transparent-900x700.png', 'brief-png-ihdr-crc.png'];
    const jobs = Array.from({ length: 60 }, (_, i) => names[i % names.length]);
    const t = Date.now();
    const settled = await Promise.allSettled(jobs.map(n => images.coverCrop(file(n), 1200, 628)));
    const ms = Date.now() - t;
    const good = new Set(['canvas-1536x1024.png', 'canvas-1024x1536.jpg', 'canvas-1024x1024.webp', 'transparent-900x700.png']);
    settled.forEach((s, i) => {
      if (good.has(jobs[i])) { expect(s.status, jobs[i]).toBe('fulfilled'); expect(sha((s as any).value)).toBe(baseSha(jobs[i])); }
      else { expect(s.status, jobs[i]).toBe('rejected'); expect(plain((s as any).reason)).toBe(true); }
    });
    expect(H.most).toBe(1); expect(H.active).toBe(0); expect(H.loads).toBe(0);
    out.together = { crops: 60, children: H.calls.length, mostAtOnce: H.most, totalMs: ms };
  });
});

describe.skipIf(!CORPUS)('the decoder cannot run (AC6)', () => {
  const GOOD = () => file('canvas-1536x1024.png');
  const cases: [string, () => void, RegExp][] = [
    ['spawn throws EAGAIN', () => { H.spawn = () => { throw Object.assign(new Error('spawn EAGAIN'), { code: 'EAGAIN' }); }; }, /could not run: spawn EAGAIN/],
    ['spawn throws ENOMEM', () => { H.spawn = () => { throw Object.assign(new Error('spawn ENOMEM'), { code: 'ENOMEM' }); }; }, /could not run: spawn ENOMEM/],
    ['spawn throws something that is not an Error', () => { H.spawn = () => { throw 'EMFILE'; }; }, /could not run: spawn failed/],
    ['the Node binary is gone (the child reports ENOENT after spawn returns)', () => { H.spawn = (_c: string, args: string[], o: any) => H.real('/nonexistent/qa/node', args, o); }, /could not run: spawn \/nonexistent\/qa\/node ENOENT/],
    ['the child starts in a folder with no node_modules (the canvas library does not load)', () => { const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-empty-')); H.spawn = (c: string, args: string[], o: any) => H.real(c, args, { ...o, cwd: empty }); }, /could not run: the canvas library did not load/],
  ];
  it.each(cases)('%s: a plain Error; the cover gets the template marked failed; strict rejects; shared image gets the template; nothing is decoded here; then it works again', async (_n, arrange, message) => {
    provider(GOOD()); arrange();
    const e = await caught(images.coverCrop(GOOD(), 1200, 628));
    expect(plain(e)).toBe(true); expect(e.message).toMatch(message); expect(e.message).not.toMatch(/picture was refused/);
    const cover: any = await images.renderImageFile(req() as any);
    expect(cover.placeholder).toBe('failed'); expect(H.stored[0].body.equals(images.renderTemplatePng(req() as any))).toBe(true);
    expect(H.reports).toMatchObject([{ operation: 'image.generate', degraded: true }]);
    const strict = await caught(images.renderImageFile(req({ modelRequired: true, prompt: 'A desk' }) as any));
    expect(plain(strict)).toBe(true); expect(H.stored).toHaveLength(1);
    const post: any = await images.renderImageFile(req({ kind: 'social' }) as any, { raw: GOOD() });
    expect('placeholder' in post).toBe(false); expect(H.stored[1].body.equals(images.renderTemplatePng(req({ kind: 'social' }) as any))).toBe(true);
    expect(H.loads).toBe(0); expect(H.active).toBe(0);
    H.spawn = null;
    expect(sha(await images.coverCrop(GOOD(), 1200, 628))).toBe(baseSha('canvas-1536x1024.png'));
  });

  it('a child killed from outside (as the kernel does when memory runs out) is one refused picture, reported as the picture’s fault', async () => {
    H.spawn = (c: string, args: string[], o: any) => { const child = H.real(c, args, o); child.kill('SIGKILL'); return child; };
    const e = await caught(images.coverCrop(GOOD(), 1200, 628));
    expect(plain(e)).toBe(true);
    out.killedFromOutside = e.message;
    expect(e.message).toMatch(/picture was refused: the decoder could not read it \(crashed\)/);
    H.spawn = null;
    expect(sha(await images.coverCrop(GOOD(), 1200, 628))).toBe(baseSha('canvas-1536x1024.png'));
  });

  it('a child that answers with far too much is stopped; one that answers nothing, or nonsense, is refused', async () => {
    const run = (program: string) => { H.spawn = (c: string, _a: string[], o: any) => H.real(c, ['-e', program], o); };
    run(`process.stdin.resume(); process.stdin.on('end', () => { const b = Buffer.alloc(1024 * 1024, 65); let n = 0; const w = () => { while (n++ < 40) if (!process.stdout.write(b)) return process.stdout.once('drain', w); process.exit(0); }; w(); });`);
    expect((await caught(images.coverCrop(GOOD(), 1200, 628))).message).toMatch(/\(too_much_output\)/);
    run(`process.stdin.resume(); process.stdin.on('end', () => process.exit(0));`);
    expect((await caught(images.coverCrop(GOOD(), 1200, 628))).message).toMatch(/\(no_answer\)/);
    run(`process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('<svg xmlns="http://www.w3.org/2000/svg"/> not an answer at all', () => process.exit(0)));`);
    expect((await caught(images.coverCrop(GOOD(), 1200, 628))).message).toMatch(/\(no_answer\)/);
    run(`process.stdin.resume(); process.stdin.on('end', () => process.exit(3));`);
    expect((await caught(images.coverCrop(GOOD(), 1200, 628))).message).toMatch(/\(crashed\)/);
    run(`process.exit(0)`); // exits before it reads the picture: the parent's write must not throw
    expect((await caught(images.coverCrop(file('noise-1024x1024.png'), 1200, 628))).message).toMatch(/\(no_answer\)/);
    expect(H.active).toBe(0); expect(H.loads).toBe(0);
    H.spawn = null;
    expect(sha(await images.coverCrop(GOOD(), 1200, 628))).toBe(baseSha('canvas-1536x1024.png'));
  });

  it('a child that never answers is stopped after 20 s, and a crop waiting behind it waits that long, then is right', async () => {
    H.spawn = (c: string, _a: string[], o: any) => { H.spawn = null; return H.real(c, ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'], o); };
    const t = Date.now();
    const stuck = caught(images.coverCrop(GOOD(), 1200, 628)).then(e => ({ e, ms: Date.now() - t }));
    const behind = images.coverCrop(GOOD(), 1200, 628).then(png => ({ png, ms: Date.now() - t }));
    const [s, b] = await Promise.all([stuck, behind]);
    expect(s.e.message).toMatch(/\(timed_out\)/); expect(s.ms).toBeGreaterThanOrEqual(19_500); expect(s.ms).toBeLessThan(23_000);
    expect(sha(b.png)).toBe(baseSha('canvas-1536x1024.png')); expect(b.ms).toBeGreaterThanOrEqual(s.ms);
    out.timeout = { stuckMs: s.ms, cropBehindItMs: b.ms };
    expect(H.active).toBe(0);
  }, 60_000);
});

describe.skipIf(!CORPUS)('what the child is given, and what one crop costs', () => {
  it('arguments: a constant program and {w,h}; environment: PATH and NODE_ENV; the picture only on stdin; no secret anywhere', async () => {
    process.env.QA_SECRET_PROBE = 'qa-secret-7c41'; process.env.DATABASE_URL_QA_PROBE = 'postgres://qa-secret-7c41@db/x';
    const marker = Buffer.from('qa-marker-in-the-picture-91f2');
    const png = file('canvas-1536x1024.png'); const chunks = [png.subarray(0, 33), (() => { const data = Buffer.concat([Buffer.from('Comment\0'), marker]); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const type = Buffer.from('tEXt'); const crc = Buffer.alloc(4); crc.writeUInt32BE(require('node:zlib').crc32(Buffer.concat([type, data]))); return Buffer.concat([len, type, data, crc]); })(), png.subarray(33)];
    const marked = Buffer.concat(chunks);
    await images.coverCrop(marked, 1200, 628); await images.coverCrop(file('canvas-1024x1536.jpg'), 1200, 900);
    await caught(images.coverCrop(file('brief-png-no-idat.png'), 1200, 675));
    delete process.env.QA_SECRET_PROBE; delete process.env.DATABASE_URL_QA_PROBE;
    expect(H.calls).toHaveLength(3);
    const programs = new Set(H.calls.map(c => c.args[1]));
    expect(programs.size).toBe(1);
    for (const [i, c] of H.calls.entries()) {
      expect(c.command).toBe(process.execPath); expect(c.args).toHaveLength(3); expect(c.args[0]).toBe('-e');
      expect(c.args[2]).toBe(JSON.stringify([{ w: 1200, h: 628 }, { w: 1200, h: 900 }, { w: 1200, h: 675 }][i]));
      expect(Object.keys(c.options.env).sort()).toEqual(['NODE_ENV', 'PATH']);
      expect(c.options.stdio).toEqual(['pipe', 'pipe', 'ignore']); expect(c.options.shell).toBeUndefined();
      const everything = JSON.stringify([c.args, c.options.env, c.options.cwd]);
      expect(everything).not.toContain('qa-secret-7c41'); expect(everything).not.toContain('qa-marker-in-the-picture'); expect(everything).not.toContain('sk-or-v1');
    }
    fs.writeFileSync(path.join(EVIDENCE, 'child-program.js'), H.calls[0].args[1]);
    out.child = { programBytes: H.calls[0].args[1].length, envKeys: Object.keys(H.calls[0].options.env), stdio: H.calls[0].options.stdio };
  });

  it('time for one crop through the child (1536×1024 → 1200×628), 30 runs each of PNG, JPEG and WebP', async () => {
    const timings: Record<string, any> = {};
    for (const name of ['canvas-1536x1024.png', 'canvas-1536x1024.jpg', 'canvas-1536x1024.webp', 'canvas-2048x2048.png', 'real-5000x5000.png']) {
      const raw = file(name); const ms: number[] = [];
      for (let i = 0; i < (name.startsWith('real') ? 8 : 30); i++) { const t = performance.now(); await images.coverCrop(raw, 1200, 628); ms.push(performance.now() - t); }
      ms.sort((a, b) => a - b);
      timings[name] = { runs: ms.length, medianMs: Math.round(ms[ms.length >> 1]), minMs: Math.round(ms[0]), maxMs: Math.round(ms.at(-1)!) };
    }
    const refused: number[] = []; const svg = file('svg-plain.svg');
    for (let i = 0; i < 200; i++) { const t = performance.now(); await caught(images.coverCrop(svg, 1200, 628)); refused.push(performance.now() - t); }
    timings.refusedByItsBytes = { runs: 200, medianMs: +refused.sort((a, b) => a - b)[100].toFixed(3) };
    const crash: number[] = []; const bad = file('brief-png-no-idat.png');
    for (let i = 0; i < 10; i++) { const t = performance.now(); await caught(images.coverCrop(bad, 1200, 628)); crash.push(performance.now() - t); }
    timings.crashingFile = { runs: 10, medianMs: Math.round(crash.sort((a, b) => a - b)[5]) };
    out.timings = timings;
    expect(H.loads).toBe(0);
  }, 300_000);
});
