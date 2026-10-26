import { afterEach, describe, expect, it, vi } from 'vitest';
import { visualBlob } from './Visual';

const OPTS = { style: 'editorial', brand: { primary: '#000', secondary: '#fff' }, headline: 'H', seed: 1, name: 'N' };
const BID = '11111111-2222-3333-4444-555555555555';
afterEach(() => vi.unstubAllGlobals());

describe('visualBlob: Download gets the stored image', () => {
  it('reads a bucket image through the business’s same-origin media route', async () => {
    const f = vi.fn(async () => new Response(new Uint8Array([7, 7]), { headers: { 'content-type': 'image/png' } })); vi.stubGlobal('fetch', f);
    const url = `https://pub-abc.r2.dev/${BID}/brief/1-a.png`;
    const b = await visualBlob(url, OPTS, 1200, 628, BID);
    expect((f.mock.calls[0] as any[])[0]).toBe(`/api/b/${BID}/media?url=${encodeURIComponent(url)}`);
    expect(b && [...new Uint8Array(await b.arrayBuffer())]).toEqual([7, 7]);
  });
  it('reads a local image directly', async () => {
    const f = vi.fn(async () => new Response(new Uint8Array([1]))); vi.stubGlobal('fetch', f);
    await visualBlob(`/api/files/${BID}/brief/1-a.png`, OPTS, 1200, 628, BID);
    expect((f.mock.calls[0] as any[])[0]).toBe(`/api/files/${BID}/brief/1-a.png`);
  });
  it('returns null instead of the template when the stored image can’t be read', async () => {
    // No `document` here: drawing the template would throw, so null proves it wasn't attempted.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await visualBlob(`https://pub-abc.r2.dev/${BID}/a.png`, OPTS, 1200, 628, BID)).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })));
    expect(await visualBlob(`https://pub-abc.r2.dev/${BID}/a.png`, OPTS, 1200, 628, BID)).toBeNull();
  });
});
