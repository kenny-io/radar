// Object storage for logos, generated images and downloads. S3-compatible when S3_BUCKET is set, else local disk served by /api/files.
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env';
import { randomToken } from '../crypto';

/** The bucket's public base URL (no trailing slash), or null when files are on local disk. */
const publicBase = () => (env.s3Bucket ? (env.s3PublicUrl || `https://${env.s3Bucket}.s3.${env.s3Region}.amazonaws.com`).replace(/\/$/, '') : null);

/** The bucket client, built the same way for every call (uploads, and the wipe's list and delete). */
async function bucket() {
  const sdk = await import('@aws-sdk/client-s3');
  return { sdk, s3: new sdk.S3Client({ region: env.s3Region, ...(env.s3Endpoint ? { endpoint: env.s3Endpoint, forcePathStyle: true } : {}) }) };
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<string> {
  if (env.s3Bucket) {
    const { sdk: { PutObjectCommand }, s3 } = await bucket();
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
const KEY_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._+-]*$/;
const BUSINESS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function storedKey(bid: string, url: string): string | null {
  const base = publicBase();
  const rest = url.startsWith('/api/files/') ? url.slice('/api/files/'.length) : base && url.startsWith(base + '/') ? url.slice(base.length + 1) : null;
  if (rest == null) return null;
  // Keys are objectKey()'s `<bid>/<kind>/<time>-<token>.<ext>`: plain segments only, never decoded, so no encoded or
  // backslashed `..` can leave the business's folder when the URL is rebuilt and fetched.
  const key = rest.split(/[?#]/)[0]; const seg = key.split('/');
  return bid && seg.length > 1 && seg[0] === bid && seg.every(x => KEY_SEGMENT.test(x)) ? key : null;
}
/** The key of a file the wipe must keep, from the address a published article holds (delete-business architecture
 *  §4.5). Like storedKey, and also a file stored under an earlier public base (the bucket's public URL changed, or local
 *  disk moved to a bucket): the key is then the path from the business's id on. null for anything else, and a null adds
 *  nothing to a keep set. Every key returned starts with `bid + '/'`. */
export function keptKey(bid: string, url: string): string | null {
  if (typeof bid !== 'string' || !BUSINESS_ID.test(bid) || typeof url !== 'string') return null;
  const direct = storedKey(bid, url);
  if (direct) return direct;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const seg = parsed.pathname.split('/'); const at = seg.indexOf(bid);   // never decoded: an encoded `..` is not a plain segment
  const rest = at < 0 ? [] : seg.slice(at);
  return rest.length > 1 && rest.every(x => KEY_SEGMENT.test(x)) ? rest.join('/') : null;
}

/** Delete what is stored for one business (`<bid>/…`) except the keys in `keep`. Counts only. Throws on any failure.
 *  The candidates are the objects found by listing `<bid>/` and nothing else, and `keep` is only ever used to take keys
 *  out of that list: no value of `keep` can make this delete or spare anything outside the prefix, and with an empty set
 *  the whole prefix goes. `kept` counts objects that were listed and left in place. Running it again after a failure
 *  removes what is left and keeps the same files. */
export async function deletePrefix(bid: string, keep: ReadonlySet<string>): Promise<{ deleted: number; kept: number }> {
  if (typeof bid !== 'string' || !BUSINESS_ID.test(bid)) throw new Error('deletePrefix needs a business id');
  const prefix = bid + '/';
  let deleted = 0, kept = 0;
  if (env.s3Bucket) {
    const { sdk: { ListObjectsV2Command, DeleteObjectsCommand }, s3 } = await bucket();
    let token: string | undefined;
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: env.s3Bucket, Prefix: prefix, ContinuationToken: token }));
      const candidates = (page.Contents || []).map(o => o.Key);
      if (candidates.some(k => typeof k !== 'string' || !k.startsWith(prefix))) throw new Error('Storage listed an object outside the business prefix');
      const doomed = (candidates as string[]).filter(k => !keep.has(k));
      kept += candidates.length - doomed.length;
      for (let i = 0; i < doomed.length; i += 1000) {
        const batch = doomed.slice(i, i + 1000);
        const out = await s3.send(new DeleteObjectsCommand({ Bucket: env.s3Bucket, Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true } }));
        if (out.Errors?.length) throw new Error(`Storage refused to delete ${out.Errors.length} object(s)`);
        deleted += batch.length;
      }
      if (page.IsTruncated && !page.NextContinuationToken) throw new Error('Storage listing was cut short');
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return { deleted, kept };
  }
  const root = path.resolve(process.cwd(), env.storageDir);
  const dir = path.join(root, bid);
  if (path.dirname(dir) !== root) throw new Error('deletePrefix left the storage folder');
  const missing = (e: any) => e?.code === 'ENOENT';
  const top = await fs.lstat(dir).catch(e => { if (missing(e)) return null; throw e; });
  if (!top) return { deleted, kept };
  if (!top.isDirectory()) throw new Error('The business folder is not a folder');   // a link here is never followed
  const walk = async (d: string): Promise<void> => {
    const entries = await fs.readdir(d, { withFileTypes: true });
    const names = new Set(entries.filter(e => !e.isDirectory()).map(e => e.name));
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { await walk(full); await fs.rmdir(full).catch(err => { if (err?.code !== 'ENOTEMPTY' && !missing(err)) throw err; }); continue; }
      // `<file>.type` holds the file's content type (putObject): it goes or stays with its file and is not counted.
      // One whose file is already gone (an earlier run that failed half way) is removed.
      if (e.name.endsWith('.type')) { if (!names.has(e.name.slice(0, -5))) await fs.unlink(full).catch(err => { if (!missing(err)) throw err; }); continue; }
      const key = path.relative(root, full).split(path.sep).join('/');
      if (keep.has(key)) { kept++; continue; }
      await fs.unlink(full);                                   // a symbolic link is removed itself; its target is never touched
      await fs.unlink(full + '.type').catch(err => { if (!missing(err)) throw err; });
      deleted++;
    }
  };
  await walk(dir);
  await fs.rmdir(dir).catch(err => { if (err?.code !== 'ENOTEMPTY' && !missing(err)) throw err; });
  return { deleted, kept };
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
