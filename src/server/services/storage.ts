// Object storage for logos, generated images and downloads. S3-compatible when S3_BUCKET is set, else local disk served by /api/files.
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env';
import { randomToken } from '../crypto';

/** The bucket's public base URL (no trailing slash), or null when files are on local disk. */
const publicBase = () => (env.s3Bucket ? (env.s3PublicUrl || `https://${env.s3Bucket}.s3.${env.s3Region}.amazonaws.com`).replace(/\/$/, '') : null);

export async function putObject(key: string, body: Buffer, contentType: string): Promise<string> {
  if (env.s3Bucket) {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({ region: env.s3Region, ...(env.s3Endpoint ? { endpoint: env.s3Endpoint, forcePathStyle: true } : {}) });
    await s3.send(new PutObjectCommand({ Bucket: env.s3Bucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }));
    return `${publicBase()}/${key}`;
  }
  const full = path.join(process.cwd(), env.storageDir, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body);
  await fs.writeFile(full + '.type', contentType);
  return `/api/files/${key}`;
}
export async function readLocal(key: string): Promise<{ body: Buffer; type: string } | null> {
  const safe = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = path.join(process.cwd(), env.storageDir, safe);
  try { return { body: await fs.readFile(full), type: await fs.readFile(full + '.type', 'utf8').catch(() => 'application/octet-stream') }; } catch { return null; }
}
/** The bytes behind a URL Radar stored (local `/api/files/…` or the bucket's public URL). Social posting reads images back to
 *  check and upload them. null when the file can't be read. */
export async function readObjectBytes(url: string, timeoutMs = 30_000): Promise<{ body: Buffer; type: string } | null> {
  if (url.startsWith('/api/files/')) return readLocal(decodeURIComponent(url.slice('/api/files/'.length)));
  if (!/^https?:\/\//i.test(url)) return null;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return null;
    return { body: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || 'application/octet-stream' };
  } catch { return null; } finally { clearTimeout(t); }
}
/** The key behind a URL Radar stored for business `bid` (local `/api/files/…` or the bucket's public URL). null for any
 *  other host, another business's file, or a path that leaves the business's folder. */
export function storedKey(bid: string, url: string): string | null {
  const base = publicBase();
  const rest = url.startsWith('/api/files/') ? url.slice('/api/files/'.length) : base && url.startsWith(base + '/') ? url.slice(base.length + 1) : null;
  if (rest == null) return null;
  let key: string; try { key = path.posix.normalize(decodeURIComponent(rest.split(/[?#]/)[0])); } catch { return null; }
  return bid && key.startsWith(bid + '/') ? key : null;
}
/** A file Radar stored for business `bid`, read on the server (downloads: the page can't fetch the bucket, it sends no CORS
 *  headers). null when the URL isn't one of the business's files or can't be read. */
export async function readStored(bid: string, url: string): Promise<{ body: Buffer; type: string } | null> {
  const key = storedKey(bid, url); if (!key) return null;
  return url.startsWith('/api/files/') ? readLocal(key) : readObjectBytes(`${publicBase()}/${key}`);
}
export const objectKey = (bid: string, kind: string, ext: string) => `${bid}/${kind}/${Date.now()}-${randomToken(6)}.${ext}`;

/** Accepts a data: URL (logo upload) and stores it. */
export async function putDataUrl(bid: string, kind: string, dataUrl: string): Promise<string> {
  const m = /^data:([a-z0-9.+/-]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new Error('Invalid data URL');
  const type = m[1]; const ext = type.includes('svg') ? 'svg' : type.split('/')[1] || 'bin';
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 5 * 1024 * 1024) throw new Error('File too large');
  return putObject(objectKey(bid, kind, ext), buf, type);
}
