// deletePrefix and keptKey: what the wipe of a business may remove from storage, on local disk and on a bucket (a fake
// S3 client). The property that matters most: no keep set can make it delete or spare anything outside `<bid>/`.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const S3 = vi.hoisted(() => ({ objects: new Set<string>(), calls: [] as { op: string; input: any }[], pageSize: 1000, errors: [] as string[], strayKey: null as string | null, cutShort: false }));
vi.mock('@aws-sdk/client-s3', () => {
  class Cmd { constructor(public input: any) {} }
  class ListObjectsV2Command extends Cmd {} class DeleteObjectsCommand extends Cmd {} class PutObjectCommand extends Cmd {}
  class S3Client {
    async send(cmd: Cmd) {
      if (cmd instanceof ListObjectsV2Command) {
        S3.calls.push({ op: 'list', input: cmd.input });
        const all = [...S3.objects].filter(k => k.startsWith(cmd.input.Prefix)).sort();
        const from = cmd.input.ContinuationToken ? all.findIndex(k => k > cmd.input.ContinuationToken) : 0;
        const page = from < 0 ? [] : all.slice(from, from + S3.pageSize);
        const more = from >= 0 && from + S3.pageSize < all.length;
        return { Contents: [...page, ...(S3.strayKey ? [S3.strayKey] : [])].map(Key => ({ Key })), IsTruncated: more, NextContinuationToken: more && !S3.cutShort ? page[page.length - 1] : undefined };
      }
      if (cmd instanceof DeleteObjectsCommand) {
        S3.calls.push({ op: 'delete', input: cmd.input });
        const keys: string[] = cmd.input.Delete.Objects.map((o: any) => o.Key);
        const refused = keys.filter(k => S3.errors.includes(k));
        for (const k of keys) if (!refused.includes(k)) S3.objects.delete(k);
        return { Errors: refused.map(Key => ({ Key, Code: 'AccessDenied' })) };
      }
      throw new Error('unexpected command');
    }
  }
  return { S3Client, ListObjectsV2Command, DeleteObjectsCommand, PutObjectCommand };
});

import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env';
import { deletePrefix, keptKey, putObject, readLocal, storedKey } from './storage';

const BID = 'aaaaaaaa-1111-4222-8333-444444444444';
const NEAR = 'aaaaaaaa-1111-4222-8333-444444444445';       // differs in the last character only
const DIR = `.data/test-delete-prefix-${process.pid}`;
const prior = { dir: env.storageDir, bucket: env.s3Bucket, pub: env.s3PublicUrl };
const root = () => path.resolve(process.cwd(), DIR);
const exists = (key: string) => fs.stat(path.join(root(), key)).then(() => true, () => false);
const put = (key: string) => putObject(key, Buffer.from(key), 'image/png');
beforeEach(() => { env.storageDir = DIR; env.s3Bucket = ''; env.s3PublicUrl = ''; S3.objects.clear(); S3.calls.length = 0; S3.pageSize = 1000; S3.errors = []; S3.strayKey = null; S3.cutShort = false; });
afterEach(async () => { env.storageDir = prior.dir; env.s3Bucket = prior.bucket; env.s3PublicUrl = prior.pub; await fs.rm(root(), { recursive: true, force: true }); });
afterAll(() => fs.rm(root(), { recursive: true, force: true }));

describe('keptKey: from an address in a published article to a storage key', () => {
  it('reads a local address and the current public base, dropping a query or fragment', () => {
    expect(keptKey(BID, `/api/files/${BID}/articles/1-a.png`)).toBe(`${BID}/articles/1-a.png`);
    expect(keptKey(BID, `/api/files/${BID}/articles/1-a.png?v=2#x`)).toBe(`${BID}/articles/1-a.png`);
    env.s3Bucket = 'radar'; env.s3PublicUrl = 'https://cdn.radar.test/';
    expect(keptKey(BID, `https://cdn.radar.test/${BID}/articles/1-a.png`)).toBe(`${BID}/articles/1-a.png`);
  });
  it('recognises a file stored under an earlier public base, which storedKey does not', () => {
    env.s3Bucket = 'radar'; env.s3PublicUrl = 'https://cdn.radar.test';
    for (const url of [`https://old-bucket.s3.us-east-1.amazonaws.com/${BID}/articles/1-a.png`, `https://old.cdn.test/media/${BID}/articles/1-a.png?x=1`, `http://localhost:3000/api/files/${BID}/articles/1-a.png`]) {
      expect(storedKey(BID, url)).toBeNull();
      expect(keptKey(BID, url)).toBe(`${BID}/articles/1-a.png`);
    }
  });
  it('is null for another business’s file, an external address, a bare or malformed value, and anything that tries to leave the folder', () => {
    for (const url of [`/api/files/${NEAR}/articles/1-a.png`, `https://cdn.test/${NEAR}/a.png`, 'https://images.example.com/a.png', `https://cdn.test/${BID}`, `https://cdn.test/${BID}/`, `/api/files/${BID}`,
      `${BID}/articles/1-a.png`, 'not a url', '', `ftp://cdn.test/${BID}/a.png`, `data:image/png;base64,${BID}/a`, `https://cdn.test/${BID}/a/..%2fb.png`, `https://cdn.test/${BID}/a b.png`,
      `https://cdn.test/${BID}/.hidden/a.png`, `/api/files/${BID}/a/../../${NEAR}/b.png`, `https://cdn.test/x/..%2f${BID}/a.png`]) expect([url, keptKey(BID, url)]).toEqual([url, null]);
    // `..`, plain or percent-encoded, is resolved by URL parsing exactly as a browser resolves it before it asks for
    // the file, and before the id is looked for: what is left is under the prefix or nothing.
    for (const dots of ['..', '%2e%2e', '%2E.']) {
      expect(keptKey(BID, `https://cdn.test/${BID}/a/${dots}/b.png`)).toBe(`${BID}/b.png`);
      expect(keptKey(BID, `https://cdn.test/${BID}/${dots}/${NEAR}/b.png`)).toBeNull();
      expect(keptKey(BID, `https://cdn.test/${BID}/a/${dots}/${dots}/${NEAR}/b.png`)).toBeNull();
    }
    expect(keptKey('not-an-id', '/api/files/not-an-id/a.png')).toBeNull();
    expect(keptKey(BID, null as never)).toBeNull();
  });
});

describe('deletePrefix on local disk', () => {
  it('refuses anything but a business id, and deletes nothing', async () => {
    await put(`${BID}/logo/1-a.png`);
    for (const bad of ['', '.', '..', '/', BID + '/', `${BID}/../${NEAR}`, BID.slice(0, 35), BID.toUpperCase() + 'x', '*', undefined, null, 42])
      await expect(deletePrefix(bad as never, new Set())).rejects.toThrow('deletePrefix needs a business id');
    expect(await exists(`${BID}/logo/1-a.png`)).toBe(true);
  });
  it('deletes the whole prefix with an empty keep set, sidecars and folders included, and no file of a business whose id starts with the same characters', async () => {
    for (const k of [`${BID}/logo/1-a.png`, `${BID}/articles/2-b.png`, `${BID}/articles/3-c.jpg`, `${BID}/social/deep/4-d.png`, `${NEAR}/logo/1-a.png`]) await put(k);
    expect(await deletePrefix(BID, new Set())).toEqual({ deleted: 4, kept: 0 });
    expect(await exists(BID)).toBe(false);
    expect(await readLocal(`${NEAR}/logo/1-a.png`)).toMatchObject({ type: 'image/png' });
    expect(await deletePrefix(BID, new Set())).toEqual({ deleted: 0, kept: 0 });        // again: nothing left, no error
  });
  it('keeps a kept file with its content type, removes the rest and the folders left empty, and counts files only', async () => {
    for (const k of [`${BID}/articles/1-cover.png`, `${BID}/articles/2-body.png`, `${BID}/articles/3-draft.png`, `${BID}/logo/4-logo.png`, `${BID}/social/5-post.png`]) await put(k);
    const keep = new Set([`${BID}/articles/1-cover.png`, `${BID}/articles/2-body.png`, `${BID}/articles/never-stored.png`]);
    expect(await deletePrefix(BID, keep)).toEqual({ deleted: 3, kept: 2 });               // a keep entry with no file behind it is not counted
    expect(await readLocal(`${BID}/articles/1-cover.png`)).toEqual({ body: Buffer.from(`${BID}/articles/1-cover.png`), type: 'image/png' });
    expect((await fs.readdir(path.join(root(), BID, 'articles'))).sort()).toEqual(['1-cover.png', '1-cover.png.type', '2-body.png', '2-body.png.type']);
    expect((await fs.readdir(path.join(root(), BID))).sort()).toEqual(['articles']);
    expect(await deletePrefix(BID, keep)).toEqual({ deleted: 0, kept: 2 });               // the same files stay on every run
  });
  it('cannot be made to delete or spare a key outside the prefix by any keep set', async () => {
    for (const k of [`${BID}/articles/1-a.png`, `${NEAR}/articles/1-a.png`, `${NEAR}/logo/2-b.png`]) await put(k);
    await fs.writeFile(path.join(root(), 'loose.txt'), 'not under any business');
    const hostile = new Set([`${NEAR}/articles/1-a.png`, NEAR, `${NEAR}/`, BID, `${BID}/`, '', '.', '..', `../${NEAR}/logo/2-b.png`, `${BID}/../${NEAR}/logo/2-b.png`, `${BID}/articles/../articles/1-a.png`, `/${BID}/articles/1-a.png`, 'loose.txt', '*', `${BID}/*`]);
    expect(await deletePrefix(BID, hostile)).toEqual({ deleted: 1, kept: 0 });           // nothing in it names the one real file exactly
    expect(await exists(BID)).toBe(false);
    for (const k of [`${NEAR}/articles/1-a.png`, `${NEAR}/logo/2-b.png`, 'loose.txt']) expect(await exists(k)).toBe(true);
  });
  it('does not follow a link out of the folder, and finishes what an earlier run left half done', async () => {
    await put(`${NEAR}/logo/1-theirs.png`); await put(`${BID}/articles/1-a.png`);
    await fs.symlink(path.join(root(), NEAR), path.join(root(), BID, 'link'));          // a link to another business's folder
    await fs.writeFile(path.join(root(), BID, 'articles', 'gone.png.type'), 'image/png');   // its file was deleted by a run that then failed
    expect(await deletePrefix(BID, new Set())).toEqual({ deleted: 2, kept: 0 });         // the file and the link itself
    expect(await exists(BID)).toBe(false);
    expect(await readLocal(`${NEAR}/logo/1-theirs.png`)).not.toBeNull();
    // The business folder itself being a link is never followed either.
    await fs.symlink(path.join(root(), NEAR), path.join(root(), BID));
    await expect(deletePrefix(BID, new Set())).rejects.toThrow('not a folder');
    expect(await readLocal(`${NEAR}/logo/1-theirs.png`)).not.toBeNull();
  });
});

describe('deletePrefix on a bucket', () => {
  const fill = (n: number, bid = BID) => { for (let i = 0; i < n; i++) S3.objects.add(`${bid}/articles/${String(i).padStart(5, '0')}.png`); };
  beforeEach(() => { env.s3Bucket = 'radar-test'; });
  it('lists only `<bid>/`, pages through it, and deletes in batches of at most 1000', async () => {
    fill(2500); fill(3, NEAR); S3.pageSize = 1200;
    expect(await deletePrefix(BID, new Set())).toEqual({ deleted: 2500, kept: 0 });
    const lists = S3.calls.filter(c => c.op === 'list'), deletes = S3.calls.filter(c => c.op === 'delete');
    expect(lists).toHaveLength(3);
    for (const l of lists) expect(l.input).toMatchObject({ Bucket: 'radar-test', Prefix: BID + '/' });
    expect(deletes.map(d => d.input.Delete.Objects.length)).toEqual([1000, 200, 1000, 200, 100]);
    for (const d of deletes) { expect(d.input.Delete.Quiet).toBe(true); for (const o of d.input.Delete.Objects) expect(o.Key.startsWith(BID + '/')).toBe(true); }
    expect([...S3.objects].sort()).toEqual([0, 1, 2].map(i => `${NEAR}/articles/0000${i}.png`));
  });
  it('keeps exactly the listed keys that are in the keep set, across pages', async () => {
    fill(30); S3.pageSize = 7;
    const keep = new Set([`${BID}/articles/00003.png`, `${BID}/articles/00017.png`, `${BID}/articles/00029.png`, `${BID}/articles/missing.png`, `${NEAR}/articles/00001.png`]);
    expect(await deletePrefix(BID, keep)).toEqual({ deleted: 27, kept: 3 });
    expect([...S3.objects].sort()).toEqual([`${BID}/articles/00003.png`, `${BID}/articles/00017.png`, `${BID}/articles/00029.png`]);
    expect(await deletePrefix(BID, keep)).toEqual({ deleted: 0, kept: 3 });
  });
  it('cannot be made to delete or spare a key outside the prefix by any keep set', async () => {
    fill(2); fill(2, NEAR);
    expect(await deletePrefix(BID, new Set([`${NEAR}/articles/00000.png`, BID, `${BID}/`, '', `../${NEAR}/articles/00001.png`, `${BID}/../${NEAR}/articles/00001.png`]))).toEqual({ deleted: 2, kept: 0 });
    expect([...S3.objects].sort()).toEqual([`${NEAR}/articles/00000.png`, `${NEAR}/articles/00001.png`]);
    expect(S3.calls.filter(c => c.op === 'delete').flatMap(d => d.input.Delete.Objects.map((o: any) => o.Key)).every((k: string) => k.startsWith(BID + '/'))).toBe(true);
  });
  it('throws when the bucket refuses any key, lists a key outside the prefix, or cuts the listing short', async () => {
    fill(3); S3.errors = [`${BID}/articles/00001.png`];
    await expect(deletePrefix(BID, new Set())).rejects.toThrow('Storage refused to delete 1 object(s)');
    S3.errors = []; S3.strayKey = `${NEAR}/articles/00000.png`; S3.objects.add(S3.strayKey);
    await expect(deletePrefix(BID, new Set())).rejects.toThrow('outside the business prefix');
    expect(S3.objects.has(`${NEAR}/articles/00000.png`)).toBe(true);
    S3.strayKey = null; S3.objects.delete(`${NEAR}/articles/00000.png`); fill(5); S3.pageSize = 2; S3.cutShort = true;
    await expect(deletePrefix(BID, new Set())).rejects.toThrow('cut short');
    S3.cutShort = false;
    await deletePrefix(BID, new Set());                         // a later run finishes it
    expect(S3.objects.size).toBe(0);
  });
});
