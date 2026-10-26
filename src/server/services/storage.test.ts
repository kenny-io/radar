import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../env';
import { readStored, storedKey } from './storage';

const BID = '11111111-2222-3333-4444-555555555555'; const OTHER = '99999999-2222-3333-4444-555555555555';
const BASE = 'https://pub-abc.r2.dev';
const bucket = () => Object.assign(env, { s3Bucket: 'radar', s3PublicUrl: BASE + '/' });
afterEach(() => { Object.assign(env, { s3Bucket: '', s3PublicUrl: '' }); vi.unstubAllGlobals(); });

describe('storedKey: only the business’s own stored files', () => {
  it('accepts its bucket and local files', () => {
    bucket();
    expect(storedKey(BID, `${BASE}/${BID}/brief/1-a.png`)).toBe(`${BID}/brief/1-a.png`);
    expect(storedKey(BID, `/api/files/${BID}/brief/1-a.png`)).toBe(`${BID}/brief/1-a.png`);
  });
  it('rejects another business, traversal and other hosts', () => {
    bucket();
    expect(storedKey(BID, `${BASE}/${OTHER}/brief/1-a.png`)).toBeNull();
    expect(storedKey(BID, `${BASE}/${BID}/../${OTHER}/brief/1-a.png`)).toBeNull();
    expect(storedKey(BID, `${BASE}/${BID}/%2e%2e/${OTHER}/1-a.png`)).toBeNull();
    // Double-encoded and backslashed `..`: fetch's URL parser would resolve these outside the business's folder.
    expect(storedKey(BID, `${BASE}/${BID}/%252e%252e/${OTHER}/brief/1-a.png`)).toBeNull();
    expect(storedKey(BID, `${BASE}/${BID}/..\\${OTHER}/brief/1-a.png`)).toBeNull();
    expect(storedKey(BID, `${BASE}/${BID}/..%5C${OTHER}/brief/1-a.png`)).toBeNull();
    expect(storedKey(BID, `${BASE}/${BID}/%252e%252e/rootfile.txt`)).toBeNull();
    expect(storedKey(BID, `${BASE}/${BID}/./brief/1-a.png`)).toBeNull();
    expect(storedKey(BID, `${BASE}/${BID}//brief/1-a.png`)).toBeNull();
    expect(storedKey(BID, `${BASE}/${BID}`)).toBeNull();
    expect(storedKey(BID, `/api/files/${BID}/../${OTHER}/1-a.png`)).toBeNull();
    expect(storedKey(BID, `https://evil.example/${BID}/brief/1-a.png`)).toBeNull();
    expect(storedKey(BID, `${BASE}.evil.example/${BID}/brief/1-a.png`)).toBeNull();
    expect(storedKey(BID, `http://169.254.169.254/${BID}/x`)).toBeNull();
    expect(storedKey('', `/api/files//x.png`)).toBeNull();
  });
  it('rejects bucket URLs when files are on local disk', () => {
    expect(storedKey(BID, `${BASE}/${BID}/brief/1-a.png`)).toBeNull();
  });
});

describe('readStored', () => {
  it('reads a bucket image from the bucket’s own URL, rebuilt from the key', async () => {
    bucket();
    const f = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', f);
    const r = await readStored(BID, `${BASE}/${BID}/brief/1-a.png?x=1`);
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as any[])[0]).toBe(`${BASE}/${BID}/brief/1-a.png`);
    expect(r && [...r.body]).toEqual([1, 2, 3]); expect(r?.type).toBe('image/png');
  });
  it('never fetches a URL it doesn’t own', async () => {
    bucket(); const f = vi.fn(); vi.stubGlobal('fetch', f);
    expect(await readStored(BID, `https://evil.example/${BID}/a.png`)).toBeNull();
    expect(await readStored(BID, `${BASE}/${OTHER}/a.png`)).toBeNull();
    expect(await readStored(BID, `${BASE}/${BID}/%252e%252e/${OTHER}/brief/1-a.png`)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
