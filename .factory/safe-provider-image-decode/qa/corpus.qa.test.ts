// Every corpus file through the real coverCrop (src/server/services/images.ts) and the real child process.
// Watched while it runs: each child that is started (its arguments and environment), and every call to the canvas
// library's loadImage inside this process (there must be none: this process never decodes anything here, not even
// its own output; results are compared by checksum with evidence/old.json, which old-decode.mjs made in other processes).
// Writes evidence/new.json. Needs QA_CORPUS (the directory make-corpus.mjs wrote).
import { afterAll, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ spawns: [] as { args: string[]; env: Record<string, unknown>; stdio: unknown; cwd: unknown }[], active: 0, most: 0, loads: 0 }));
vi.mock('node:child_process', async original => {
  const real = await original<typeof import('node:child_process')>();
  const spawn = (...a: any[]) => {
    H.spawns.push({ args: a[1], env: a[2]?.env, stdio: a[2]?.stdio, cwd: a[2]?.cwd });
    H.most = Math.max(H.most, ++H.active);
    const child = (real.spawn as any)(...a); child.on('close', () => { H.active--; });
    return child;
  };
  return { ...real, default: { ...real, spawn }, spawn };
});
vi.mock('@napi-rs/canvas', async original => {
  const real = await original<typeof import('@napi-rs/canvas')>();
  const loadImage = (...a: any[]) => { H.loads++; return (real.loadImage as any)(...a); };
  return { ...real, default: { ...(real as any).default, loadImage }, loadImage };
});
vi.mock('@/server/db', () => ({ db: { insert: () => ({ values: () => Promise.resolve() }) }, schema: { aiCalls: {} } }));
vi.mock('@/server/observability/failures', () => ({ reportFailure: async () => {} }));
vi.mock('@/server/services/storage', () => ({ objectKey: () => 'k', putObject: async () => 'mem://k' }));
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { coverCrop } from '@/server/services/images';
import { RadarError } from '@/server/errors';
import { probeImage } from '@/server/services/untrustedImage';
// @ts-expect-error plain JavaScript shared with old-decode.mjs
import { cropsFor } from './crops.mjs';

const CORPUS = process.env.QA_CORPUS || '';
const EVIDENCE = path.resolve('.factory/safe-provider-image-decode/qa/evidence');
const manifest: { group: string; name: string; file: string; bytes: number; note: string }[] = CORPUS ? JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8')) : [];
const old: any[] = fs.existsSync(path.join(EVIDENCE, 'old.json')) ? JSON.parse(fs.readFileSync(path.join(EVIDENCE, 'old.json'), 'utf8')) : [];
const oldOf = new Map(old.map(r => [r.group + '/' + r.name, r]));
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const rows: any[] = [];
const scripts = new Set<string>();

async function run(group: string) {
  const problems: string[] = [];
  for (const f of manifest.filter(m => m.group === group)) {
    const raw = fs.readFileSync(f.file); const was = oldOf.get(f.group + '/' + f.name);
    const out: any[] = [];
    for (const [w, h] of cropsFor(f) as [number, number][]) {
      const id = `${f.group}/${f.name}@${w}x${h}`;
      const before = H.spawns.length; const loads = H.loads; const t = Date.now();
      let r: any;
      try {
        const png = await coverCrop(raw, w, h);
        const made = probeImage(png);
        r = { size: `${w}x${h}`, ok: true, sha: sha(png), bytes: png.length };
        if (!made || made.type !== 'image/png' || !made.complete || made.width !== w || made.height !== h) problems.push(`${id}: resolved with something that is not a complete ${w}×${h} PNG`);
      } catch (e: any) {
        r = { size: `${w}x${h}`, refused: String(e?.message), errorClass: e?.constructor?.name };
        if (!(e instanceof Error) || e instanceof RadarError || Object.getPrototypeOf(e) !== Error.prototype) problems.push(`${id}: rejected with ${e?.constructor?.name}, not a plain Error`);
        if (e?.code !== undefined || e?.status !== undefined || e?.userMessage !== undefined) problems.push(`${id}: the rejection carries code/status/userMessage`);
        if (!/^The image model’s picture was refused: |^The image model's picture was refused: /.test(String(e?.message))) problems.push(`${id}: unexpected message: ${String(e?.message).slice(0, 120)}`);
        if (String(e?.message).length > 160) problems.push(`${id}: message of ${String(e?.message).length} characters`);
      }
      r.ms = Date.now() - t; r.children = H.spawns.length - before;
      if (H.loads !== loads) problems.push(`${id}: loadImage ran in this process`);
      if (H.active !== 0) problems.push(`${id}: a child was still running after coverCrop settled`);
      if (r.children > 1) problems.push(`${id}: ${r.children} children for one crop`);
      for (const s of H.spawns.slice(before)) {
        scripts.add(sha(Buffer.from(s.args[1])));
        if (s.args.length !== 3 || s.args[0] !== '-e' || s.args[2] !== JSON.stringify({ w, h })) problems.push(`${id}: child arguments are not [-e, script, {w,h}]`);
        if (Object.keys(s.env || {}).sort().join() !== 'NODE_ENV,PATH') problems.push(`${id}: child environment has ${Object.keys(s.env || {}).join()}`);
      }
      // Against the base: the same file and size must give the same bytes whenever both give a picture.
      const o = was?.out?.find((x: any) => x.size === r.size);
      if (r.ok && o?.ok && o.sha !== r.sha) problems.push(`${id}: cropped, but the bytes differ from the base's crop`);
      if (r.ok && !o?.ok) problems.push(`${id}: cropped here, but the base ${was?.signal ? 'ended its process (' + was.signal + ')' : 'threw'} on it`);
      out.push(r);
    }
    rows.push({ group: f.group, name: f.name, bytes: f.bytes, note: f.note, out });
  }
  return problems;
}

describe.skipIf(!CORPUS)('the corpus through coverCrop', () => {
  for (const group of ['good', 'unusual', 'limits', 'bad']) {
    it(`${group}: this process survives, never decodes, and every crop is either a refusal or the base's bytes`, async () => {
      const problems = await run(group);
      expect(problems).toEqual([]);
    });
  }
  it('a good picture still crops to the base’s bytes after all of that, and the queue ran one child at a time', async () => {
    const f = manifest.find(m => m.name === 'canvas-1536x1024.png')!;
    const png = await coverCrop(fs.readFileSync(f.file), 1200, 628);
    expect(sha(png)).toBe(oldOf.get('good/canvas-1536x1024.png').out.find((x: any) => x.size === '1200x628').sha);
    expect(H.most).toBe(1); expect(H.loads).toBe(0);
    expect(scripts.size).toBe(1); // the child's program is one constant text, whatever the picture
  });
  afterAll(() => {
    fs.writeFileSync(path.join(EVIDENCE, 'new.json'), JSON.stringify({ node: process.version, platform: `${process.platform} ${process.arch}`, inProcessLoadImageCalls: H.loads, children: H.spawns.length, mostChildrenAtOnce: H.most, distinctChildPrograms: scripts.size, rows }, null, 1));
  });
});
