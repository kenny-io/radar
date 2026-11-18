import { describe, expect, it } from 'vitest';
import { videoMeta, videoDuration } from './media';
import { videoForm } from './video';

const box = (type: string, data: Buffer) => { const b = Buffer.alloc(data.length + 8); b.writeUInt32BE(b.length); b.write(type, 4); data.copy(b, 8); return b; };
function mp4(duration: number) {
  const mvhd = Buffer.alloc(20); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(duration * 1000, 16);
  const handler = Buffer.alloc(12); handler.write('vide', 8);
  return Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('moov', Buffer.concat([box('mvhd', mvhd), box('trak', box('mdia', box('hdlr', handler)))])), box('mdat', Buffer.from([1]))]);
}
describe('video upload inspection', () => {
  it('ignores filenames and derives video formats and durations from container bytes', () => {
    expect(videoMeta(Buffer.from('a fake .mp4 file'))).toBeNull();
    const bytes = mp4(123);
    expect(videoMeta(bytes)).toEqual({ bytes: bytes.length, type: 'video/mp4' });
    expect(videoDuration(bytes)).toBe(123);
    expect(videoDuration(Buffer.from('broken'))).toBeUndefined();
    expect(videoDuration(box('moov', Buffer.from('truncated')))).toBeUndefined();
  });
  it('parses version-one MP4 durations and safely rejects malformed atom sizes', () => {
    const mvhd = Buffer.alloc(32); mvhd[0] = 1; mvhd.writeUInt32BE(100, 20); mvhd.writeBigUInt64BE(1000n, 24);
    expect(videoDuration(Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('moov', box('mvhd', mvhd))]))).toBe(10);
    const invalid = Buffer.alloc(20); invalid.writeUInt32BE(0xffffffff); invalid.write('moov', 4);
    expect(videoDuration(invalid)).toBeUndefined();
  });
  it('parses WebM Info duration and timecode scale', () => {
    const duration = Buffer.alloc(8); duration.writeDoubleBE(60000);
    const info = Buffer.concat([Buffer.from([0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]), Buffer.from([0x44, 0x89, 0x88]), duration]);
    const bytes = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x18, 0x53, 0x80, 0x67, 0xff, 0x15, 0x49, 0xa9, 0x66, 0x80 | info.length]), info]);
    // Duration parsing is independent of full video validation. This minimal Info-only container has no video track.
    expect(videoMeta(bytes)).toBeNull();
    expect(videoDuration(bytes)).toBe(60);
  });
  it('rejects image containers and magic bytes without video tracks', () => {
    expect(videoMeta(box('ftyp', Buffer.from('avif0000isom')))).toBeNull();
    expect(videoMeta(box('ftyp', Buffer.from('heic0000')))).toBeNull();
    expect(videoMeta(box('ftyp', Buffer.from('isom0000')))).toBeNull();
    expect(videoMeta(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80]))).toBeNull();
  });
  it('accepts valid bounded multipart and rejects invalid or declared oversized bodies', async () => {
    const form = new FormData(); form.set('packId', 'p1'); form.set('file', new Blob([new Uint8Array(mp4(5))], { type: 'video/mp4' }), 'movie.mp4');
    expect((await videoForm(new Request('http://localhost/upload', { method: 'POST', body: form }))).get('packId')).toBe('p1');
    await expect(videoForm(new Request('http://localhost/upload', { method: 'POST', headers: { 'content-length': String(1024 * 1024 * 101) }, body: 'a' }))).rejects.toMatchObject({ status: 413 });
    await expect(videoForm(new Request('http://localhost/upload', { method: 'POST', body: 'not multipart' }))).rejects.toMatchObject({ code: 'invalid_video' });
  });
});
