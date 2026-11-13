// The child process every untrusted picture is decoded in. The children here are real; starting one is watched, so
// what each is given, how each ended and how many ran at once can be shown. What a cover or a logo makes of an answer
// is tested with them (realCover/picture.test.ts, analysis/brand.test.ts), and so is probeImage.
import { beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ spawn: vi.fn(), active: 0, most: 0, ended: [] as { status: number | null; signal: string | null }[] }));
vi.mock('node:child_process', async original => {
  const real = await original<typeof import('node:child_process')>();
  H.spawn.mockImplementation((...args: Parameters<typeof real.spawn>) => {
    H.most = Math.max(H.most, ++H.active);
    const child = real.spawn(...args); child.on('close', (status, signal) => { H.active--; H.ended.push({ status, signal }); });
    return child;
  });
  return { ...real, default: { ...real, spawn: H.spawn }, spawn: H.spawn };
});
import os from 'node:os';
import { createCanvas } from '@napi-rs/canvas';
import { IMAGE_MAX_PIXELS, IMAGE_MAX_SIDE, ImageRefused, decodeInChild, overPixelLimits, probeImage } from './untrustedImage';
import * as picture from './realCover/picture';

beforeEach(() => { H.spawn.mockClear(); H.active = 0; H.most = 0; H.ended.length = 0; });

function png(w: number, h: number, colour = '#1d4ed8'): Buffer {
  const canvas = createCanvas(w, h); const ctx = canvas.getContext('2d'); ctx.fillStyle = colour; ctx.fillRect(0, 0, w, h);
  return canvas.toBuffer('image/png');
}
const LIMITS = { timeoutMs: 10_000, maxOutput: 64 * 1024 };
const SIZE = 'reply({ w: img.width, h: img.height });';
/** The reason a decode was refused, or 'answered', or 'fault: …' for an error that does not blame the picture. */
const outcome = (p: Promise<unknown>) => p.then(() => 'answered', e => (e instanceof ImageRefused ? e.reason : 'fault: ' + e?.message));

describe('decodeInChild runs the work on the decoded picture and hands back its answer', () => {
  it('the head and the bytes the work replied with, with the options and a canvas in reach', async () => {
    const work = `const c = createCanvas(o.side, o.side); const g = c.getContext('2d'); g.drawImage(img, 0, 0, o.side, o.side);
      const d = g.getImageData(0, 0, o.side, o.side).data; reply({ w: img.width, h: img.height, label: o.label }, Buffer.from(d.buffer, d.byteOffset, d.byteLength));`;
    const { head, data } = await decodeInChild(png(120, 80, '#ff0000'), work, { side: 2, label: 'two' }, LIMITS);
    expect(head).toEqual({ w: 120, h: 80, label: 'two' });
    expect([...data]).toEqual([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]);
  });
  it('a head alone, an empty head, work that waits before it answers, and only the first of two answers', async () => {
    expect(await decodeInChild(png(64, 64), SIZE, {}, LIMITS)).toEqual({ head: { w: 64, h: 64 }, data: Buffer.alloc(0) });
    expect((await decodeInChild(png(64, 64), 'reply({});', undefined, LIMITS)).head).toEqual({});
    expect((await decodeInChild(png(64, 64), 'await new Promise(r => setTimeout(r, 50)); reply({ waited: true });', {}, LIMITS)).head).toEqual({ waited: true });
    expect(await decodeInChild(png(64, 64), 'reply({ n: 1 }, Buffer.from([1])); reply({ n: 2 }, Buffer.from([2, 2]));', {}, LIMITS)).toEqual({ head: { n: 1 }, data: Buffer.from([1]) });
  });
});

describe('decodeInChild refuses the picture (ImageRefused) for every way the picture can make the child fail', () => {
  it.each([
    ['the work throws', 'throw new Error("cannot draw this");', 'work_failed'],
    ['the work rejects', 'await Promise.reject(new Error("no"));', 'work_failed'],
    ['the child exits with an error status', 'process.exit(3);', 'crashed'],
    ['the child is ended by a signal, as a decoder crash ends it', 'process.kill(process.pid, "SIGSEGV");', 'crashed'],
    ['the child ends without answering', '', 'no_answer'],
    ['the answer is not in the agreed form', 'process.stdout.write("this is not an answer", () => process.exit(0));', 'no_answer'],
    ['the answer is cut off inside its head', 'const b = Buffer.alloc(4); b.writeUInt32BE(5000); process.stdout.write(Buffer.concat([b, Buffer.from("{")]), () => process.exit(0));', 'no_answer'],
    ['the head is not an object', 'reply(null);', 'no_answer'],
    ['the head is a bare string', 'reply("fine");', 'no_answer'],
    ['the answer is larger than allowed', 'reply({}, Buffer.alloc(200 * 1024));', 'too_much_output'],
    ['the child floods its output and never ends', 'setInterval(() => process.stdout.write(Buffer.alloc(64 * 1024)), 1);', 'too_much_output'],
  ])('%s', async (_name, work, reason) => {
    expect(await outcome(decodeInChild(png(64, 64), work, {}, LIMITS))).toBe(reason);
    expect(H.active).toBe(0); // the child is gone
    expect(await outcome(decodeInChild(png(64, 64), SIZE, {}, LIMITS))).toBe('answered'); // and the next picture is read normally
  });
  it('the decoder does not take the file: the work never runs', async () => {
    const notAPicture = Buffer.from('this is text, not a picture, and it is long enough to be more than a header'.repeat(4));
    expect(await outcome(decodeInChild(notAPicture, 'reply({ ran: true });', {}, LIMITS))).not.toBe('answered');
    expect(await outcome(decodeInChild(Buffer.alloc(0), 'reply({ ran: true });', {}, LIMITS))).not.toBe('answered');
  });
  it('a child that does not answer in time is stopped, not waited for', async () => {
    const started = Date.now();
    const refused = await decodeInChild(png(64, 64), 'setInterval(() => {}, 1000);', {}, { timeoutMs: 300, maxOutput: 1024 }).catch(e => e);
    const waited = Date.now() - started;
    expect(refused).toBeInstanceOf(ImageRefused); expect(refused.reason).toBe('timed_out');
    expect(waited).toBeGreaterThanOrEqual(290); expect(waited).toBeLessThan(5000);
    expect(H.ended).toEqual([{ status: null, signal: 'SIGKILL' }]);
  });
  it('a child that answers in time is not stopped by a limit that passes afterwards', async () => {
    expect((await decodeInChild(png(64, 64), SIZE, {}, { timeoutMs: 5000, maxOutput: 1024 })).head).toEqual({ w: 64, h: 64 });
    await new Promise(r => setTimeout(r, 50));
    expect(H.ended).toEqual([{ status: 0, signal: null }]);
  });
});

describe('a decoder that cannot run is a fault, not a refused picture', () => {
  it('the child cannot be started', async () => {
    H.spawn.mockImplementationOnce(() => { throw new Error('spawn ENOENT'); });
    const fault = await decodeInChild(png(64, 64), SIZE, {}, LIMITS).catch(e => e);
    expect(fault).toBeInstanceOf(Error); expect(fault).not.toBeInstanceOf(ImageRefused);
    expect(fault.message).toContain('spawn ENOENT');
    expect(await outcome(decodeInChild(png(64, 64), SIZE, {}, LIMITS))).toBe('answered');
  });
  it('the child starts where the canvas library cannot be found', async () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(os.tmpdir());
    try {
      const fault = await decodeInChild(png(64, 64), SIZE, {}, LIMITS).catch(e => e);
      expect(fault).toBeInstanceOf(Error); expect(fault).not.toBeInstanceOf(ImageRefused);
      expect(fault.message).toContain('canvas library');
    } finally { cwd.mockRestore(); }
    expect(await outcome(decodeInChild(png(64, 64), SIZE, {}, LIMITS))).toBe('answered');
  });
});

describe('what the child is given', () => {
  it('the picture on its input, and nothing of this process: two environment names, three arguments, none from the picture', async () => {
    process.env.UNTRUSTED_IMAGE_TEST_SECRET = 'do-not-leak';
    try {
      const seen = await decodeInChild(png(64, 64, '#123456'), 'reply({ env: Object.keys(process.env), argv: process.argv.length });', { a: 1 }, LIMITS);
      await decodeInChild(png(90, 70, '#654321'), 'reply({ env: Object.keys(process.env), argv: process.argv.length });', { a: 1 }, LIMITS);
      // macOS adds __CF_USER_TEXT_ENCODING to every process it starts; nothing else may appear.
      expect(seen.head.env.filter((k: string) => k !== '__CF_USER_TEXT_ENCODING').sort()).toEqual(['NODE_ENV', 'PATH']);
      expect(seen.head.argv).toBe(2); // node itself and the options
    } finally { delete process.env.UNTRUSTED_IMAGE_TEST_SECRET; }
    const [command, args, options] = H.spawn.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args).toHaveLength(3); expect(args[0]).toBe('-e'); expect(JSON.parse(args[2])).toEqual({ a: 1 });
    expect(H.spawn.mock.calls[1][1]).toEqual(args); // a different picture, the very same arguments
    expect(Object.keys(options.env).sort()).toEqual(['NODE_ENV', 'PATH']);
    expect(options.stdio).toEqual(['pipe', 'pipe', 'ignore']);
    expect(options.cwd).toBe(process.cwd()); expect(options.shell).toBeFalsy(); expect(options.detached).toBeFalsy();
  });
});

describe('one picture is decoded at a time', () => {
  it('calls made together run one after the other, in order, and a refused or faulty one does not hold up the rest', async () => {
    const slow = 'await new Promise(r => setTimeout(r, 120)); reply({ at: Date.now() });';
    const results = await Promise.allSettled([
      decodeInChild(png(64, 64), slow, {}, LIMITS), decodeInChild(png(64, 64), 'process.exit(1);', {}, LIMITS), decodeInChild(png(64, 64), slow, {}, LIMITS),
      decodeInChild(png(64, 64), 'throw 1;', {}, LIMITS), decodeInChild(png(64, 64), slow, {}, LIMITS),
    ]);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'rejected', 'fulfilled']);
    expect(H.spawn).toHaveBeenCalledTimes(5);
    expect(H.most).toBe(1);
    const at = results.flatMap(r => (r.status === 'fulfilled' ? [r.value.head.at] : []));
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });
  it('the time limit starts when the child does, not while a call waits its turn', async () => {
    const first = decodeInChild(png(64, 64), 'await new Promise(r => setTimeout(r, 700)); reply({});', {}, LIMITS);
    const second = decodeInChild(png(64, 64), SIZE, {}, { timeoutMs: 600, maxOutput: 1024 }); // waits longer than its own limit
    expect(await outcome(first)).toBe('answered'); expect(await outcome(second)).toBe('answered');
  });
});

describe('the limits and the probe are the ones covers use', () => {
  it('a declared size over either limit is over, and one on the limit is not', () => {
    expect([IMAGE_MAX_SIDE, IMAGE_MAX_PIXELS]).toEqual([10_000, 25_000_000]);
    expect(overPixelLimits({ width: 5000, height: 5000 })).toBe(false);
    expect(overPixelLimits({ width: 10_000, height: 2500 })).toBe(false);
    expect(overPixelLimits({ width: 5001, height: 5000 })).toBe(true);
    expect(overPixelLimits({ width: 10_001, height: 1 })).toBe(true);
    expect(overPixelLimits({ width: 1, height: 10_001 })).toBe(true);
  });
  it('picture.ts still exports the probe and the limits it always did', () => {
    expect(picture.probeImage).toBe(probeImage);
    expect([picture.PICTURE_MAX_SIDE, picture.PICTURE_MAX_PIXELS]).toEqual([IMAGE_MAX_SIDE, IMAGE_MAX_PIXELS]);
    expect(probeImage(png(120, 80))).toEqual({ type: 'image/png', width: 120, height: 80, complete: true });
  });
});
