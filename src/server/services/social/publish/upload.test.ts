// The user's image upload: type from the bytes, limits before any decode, decode and re-encode in the real child process.
// Fixtures are drawn here with @napi-rs/canvas (trusted bytes), so the test needs no files on disk.
import { describe, expect, it, vi } from 'vitest';
const D = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../untrustedImage', async original => {
  const m = await original<typeof import('../../untrustedImage')>();
  return { ...m, decodeInChild: (...a: Parameters<typeof m.decodeInChild>) => { D.calls++; return m.decodeInChild(...a); } };
});
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { probeImage } from '../../untrustedImage';
import { MAX_IMAGE_BYTES } from '@/lib/socialPublish';
import { UPLOAD_COPY, recodeUpload } from './upload';

const draw = (w: number, h: number, type: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/png', paint?: (c: ReturnType<ReturnType<typeof createCanvas>['getContext']>) => void) => {
  const c = createCanvas(w, h); const x = c.getContext('2d');
  x.fillStyle = '#3366cc'; x.fillRect(0, 0, w, h); paint?.(x);
  return type === 'image/png' ? c.toBuffer('image/png') : c.toBuffer(type as 'image/jpeg', 90);
};
const refused = (p: Promise<unknown>, msg: string, status = 400) => expect(p).rejects.toMatchObject({ userMessage: msg, status });
/** A JPEG with an EXIF APP1 segment that says "rotate 90° clockwise to display" (Orientation = 6). */
function withOrientation6(jpg: Buffer) {
  const tiff = Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255]), payload]);
  return Buffer.concat([jpg.subarray(0, 2), app1, jpg.subarray(2)]);
}
async function pixel(bytes: Buffer, x: number, y: number) {
  const img = await loadImage(bytes); const c = createCanvas(img.width, img.height); const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0); return [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
}

describe('custom post image upload (child decode)', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'] as const)('accepts a %s still and stores the type the output bytes are', async type => {
    const r = await recodeUpload('x', draw(400, 300, type));
    expect(r).toMatchObject({ type, width: 400, height: 300 });
    expect(probeImage(r.bytes)).toMatchObject({ type, width: 400, height: 300, complete: true });
  });
  it('refuses GIF, SVG, HEIC, text and an HTML file named like a PNG, by their bytes', async () => {
    const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic\0\0\0\0mif1heic', 'latin1')]);
    const txt = Buffer.from('just some notes saved as photo.jpg');
    const html = Buffer.from('<!doctype html><script>alert(1)</script>');
    for (const b of [gif, svg, heic, txt, html]) await refused(recodeUpload('x', b), UPLOAD_COPY.type);
  });
  it('refuses a truncated PNG and an animated WebP before decoding', async () => {
    const before = D.calls;
    const png = draw(200, 200);
    await refused(recodeUpload('linkedin', png.subarray(0, png.length - 20)), UPLOAD_COPY.incomplete);
    const vp8x = Buffer.alloc(30); vp8x.write('RIFF', 0, 'latin1'); vp8x.writeUInt32LE(22, 4); vp8x.write('WEBPVP8X', 8, 'latin1'); vp8x.writeUInt32LE(10, 16);
    vp8x[20] = 0x02; vp8x.writeUIntLE(99, 24, 3); vp8x.writeUIntLE(99, 27, 3);
    await refused(recodeUpload('x', vp8x), UPLOAD_COPY.animated);
    expect(D.calls).toBe(before);
  });
  it('refuses over 5 MB with 413, and a 20,000 × 20,000 header without decoding', async () => {
    const before = D.calls;
    const big = Buffer.concat([draw(10, 10), Buffer.alloc(MAX_IMAGE_BYTES)]);
    await refused(recodeUpload('x', big), UPLOAD_COPY.tooLarge, 413);
    const huge = Buffer.from(draw(10, 10)); huge.writeUInt32BE(20_000, 16); huge.writeUInt32BE(20_000, 20);
    await refused(recodeUpload('x', huge), UPLOAD_COPY.pixels);
    expect(D.calls).toBe(before);
  });
  it('refuses a corrupt body with a valid header in the child, with user copy', async () => {
    const png = Buffer.from(draw(50, 50)); png.fill(0x41, 40, png.length - 12);
    await refused(recodeUpload('x', png), UPLOAD_COPY.unreadable);
  });
  it('refuses a 9:16 Instagram image and stores an Instagram PNG as JPEG', async () => {
    await refused(recodeUpload('instagram', draw(900, 1600)), UPLOAD_COPY.ratio);
    const r = await recodeUpload('instagram', draw(2000, 2000, 'image/png'));
    expect(r).toMatchObject({ type: 'image/jpeg', width: 1440, height: 1440 });
    expect(probeImage(r.bytes)?.type).toBe('image/jpeg');
  });
  it('fits a 3000 × 4000 TikTok photo within 1080 px on the short side, PNG becoming JPEG', async () => {
    const r = await recodeUpload('tiktok', draw(3000, 4000, 'image/png'));
    expect(r).toMatchObject({ type: 'image/jpeg', width: 1080, height: 1440 });
    const landscape = await recodeUpload('tiktok', draw(4000, 3000, 'image/webp'));
    expect(landscape).toMatchObject({ type: 'image/webp', width: 1440, height: 1080 });
  });
  it('stores a LinkedIn WebP as JPEG (LinkedIn does not take WebP)', async () => {
    expect((await recodeUpload('linkedin', draw(300, 200, 'image/webp'))).type).toBe('image/jpeg');
  });
  it('stores a camera photo with EXIF orientation 6 upright, without the EXIF data', async () => {
    // 40 × 20, red on the left half: displayed upright it is 20 × 40 with red on top.
    const jpg = withOrientation6(draw(40, 20, 'image/jpeg', x => { x.fillStyle = '#ff0000'; x.fillRect(0, 0, 20, 20); }));
    const r = await recodeUpload('x', jpg);
    expect(r).toMatchObject({ type: 'image/jpeg', width: 20, height: 40 });
    expect(r.bytes.includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(false);
    const [tr, , tb] = await pixel(r.bytes, 10, 5); const [br, , bb] = await pixel(r.bytes, 10, 35);
    expect(tr).toBeGreaterThan(200); expect(tb).toBeLessThan(60);
    expect(br).toBeLessThan(100); expect(bb).toBeGreaterThan(150);
  });
  it('refuses YouTube (it takes a video)', async () => {
    await refused(recodeUpload('youtube', draw(10, 10)), UPLOAD_COPY.youtube);
  });
});
