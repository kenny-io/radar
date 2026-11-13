// AC2, AC3, AC4, D7 with QA's own malformed files (fixtures.ts): each is served as the only logo candidate, then as
// the first of two. The decode is real (the child process brand.ts starts); only the crawler's fetch and storage are
// replaced. Starting a child is watched. A file that ends this test process, stalls it, or makes detectBrand reject
// is a defect. What happened to every file is written to evidence/hostile.json.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ spawns: [] as any[], active: 0, most: 0, fetchUrl: (..._a: any[]): any => null, puts: [] as any[] }));
vi.mock('node:child_process', async original => {
  const real = await original<typeof import('node:child_process')>();
  const spawn = (command: string, args: string[], options: any) => {
    const rec: any = { command, args, options, pid: undefined, startedAt: Date.now(), ended: null }; H.spawns.push(rec);
    const child = real.spawn(command, args, options); rec.pid = child.pid; H.most = Math.max(H.most, ++H.active);
    child.on('close', (status, signal) => { H.active--; rec.ended = { status, signal, at: Date.now() }; });
    return child;
  };
  return { ...real, default: { ...real, spawn }, spawn };
});
vi.mock('@/server/services/analysis/crawl', async original => ({ ...(await original<any>()), fetchUrl: (...a: any[]) => H.fetchUrl(...a) }));
vi.mock('@/server/services/storage', async original => ({ ...(await original<any>()), putObject: async (key: string, body: Buffer, type: string) => { H.puts.push({ key, body, type }); return '/api/files/' + key; } }));
import fs from 'node:fs';
import path from 'node:path';
import { detectBrand } from '@/server/services/analysis/brand';
import { probeImage } from '@/server/services/untrustedImage';
import { badFiles, good, QA_DIR, type Bad } from './fixtures';
import { CSS_PRIMARY, ORIGIN, page, sha, site } from './harness';

const BAD = badFiles();
const rows: any[] = [];
let longestGap = 0, last = 0; let beat: ReturnType<typeof setInterval>;
beforeEach(() => { H.spawns.length = 0; H.puts.length = 0; H.active = 0; H.most = 0; });
afterAll(() => {
  clearInterval(beat);
  fs.mkdirSync(path.join(QA_DIR, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(QA_DIR, 'evidence/hostile.json'), JSON.stringify({ revision: process.env.QA_REVISION || null, files: Object.keys(BAD).length, longestEventLoopGapMs: Math.round(longestGap), rows }, null, 1));
});

describe('a malformed or mislabelled file as the only logo candidate (AC2, AC4, D7)', () => {
  it('this process keeps answering while every file below is read (the longest gap between two 20 ms ticks is recorded)', () => { last = performance.now(); beat = setInterval(() => { const now = performance.now(); longestGap = Math.max(longestGap, now - last); last = now; }, 20); });

  it.each(Object.entries(BAD))('%s', async (name, bad: Bad) => {
    const s = site({ '/logo': { type: bad.type, body: bad.body } }); H.fetchUrl = s.fetchUrl;
    const t = performance.now();
    const r = await detectBrand('qa', page(['/logo']), ORIGIN); // a rejection fails the test: detectBrand must never reject (D7)
    const ms = Math.round(performance.now() - t);
    const kept = H.puts[0] ? { type: H.puts[0].type, ext: H.puts[0].key.split('.').pop(), same: sha(H.puts[0].body) === sha(bad.body) } : null;
    const children = H.spawns.map((c: any) => ({ status: c.ended?.status ?? null, signal: c.ended?.signal ?? null, ms: c.ended ? c.ended.at - c.startedAt : null }));
    rows.push({ pass: 'only', name, header: bad.type, bytes: bad.body.length, expectChild: bad.child, ms, children, logo: r.logo, kept, primary: r.primary, secondary: r.secondary, language: r.language });
    expect(s.asked).toEqual(['/logo']);
    // The rest of the page is still read.
    expect(r.primary).toBe(CSS_PRIMARY); expect(r.language).toBe('French'); expect(r.htmlLang).toBe('fr');
    // No stall: one decode of a small file is a fraction of a second; the limit is ten.
    expect(ms).toBeLessThan(5000);
    // Every child that started has ended by the time the answer is back.
    expect(H.active).toBe(0); expect(H.spawns.every((c: any) => c.ended)).toBe(true);
    if (bad.child === 'none') expect(H.spawns).toHaveLength(0); else expect(H.spawns.length).toBeLessThanOrEqual(1);
    if (bad.kept === null) { expect(r.logo).toBeNull(); expect(H.puts).toHaveLength(0); }
    if (typeof bad.kept === 'string') { expect(kept).toMatchObject({ type: bad.kept, same: true }); expect(r.logo).toBe('/api/files/' + H.puts[0].key); }
    // Whatever is kept is stored as what its bytes are, never as what the header said, and only after a child decoded it.
    if (kept) { const p = probeImage(bad.body)!; expect(kept.type).toBe(p.type); expect(kept.ext).toBe({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[p.type]); expect(H.spawns).toHaveLength(1); expect(children[0]).toMatchObject({ status: 0, signal: null }); }
  }, 30_000);

  it('after all of them, this process still reads a good logo, and it never stopped answering for long', async () => {
    const body = good('png-rgba.png'); H.fetchUrl = site({ '/logo': { type: 'image/png', body } }).fetchUrl;
    const r = await detectBrand('qa', page(['/logo'], { styled: false }), ORIGIN);
    expect(H.puts[0]).toMatchObject({ type: 'image/png' }); expect(r.logo).toMatch(/\.png$/); expect(r.primary).toBe('#187878'); // #0F766E rounded to multiples of 24
    expect(longestGap).toBeLessThan(1000);
  });
});

describe('a malformed first candidate does not stop a good second one (AC3)', () => {
  it.each(Object.entries(BAD))('%s, then a good PNG', async (name, bad: Bad) => {
    const second = good('png-rgba.png');
    const s = site({ '/first': { type: bad.type, body: bad.body }, '/second.png': { type: 'image/png', body: second } }); H.fetchUrl = s.fetchUrl;
    const t = performance.now();
    const r = await detectBrand('qa', page(['/first', '/second.png'], { styled: false }), ORIGIN);
    const ms = Math.round(performance.now() - t);
    const firstKept = H.puts.length === 1 && s.asked.length === 1 && sha(H.puts[0].body) === sha(bad.body); // the second was never asked for
    rows.push({ pass: 'first-of-two', name, ms, children: H.spawns.length, keptFirst: firstKept, keptType: H.puts[0]?.type ?? null, primary: r.primary });
    expect(ms).toBeLessThan(6000);
    expect(H.puts).toHaveLength(1); expect(r.logo).not.toBeNull();
    if (bad.kept === null) { expect(s.asked).toEqual(['/first', '/second.png']); expect(sha(H.puts[0].body)).toBe(sha(second)); expect(H.puts[0].type).toBe('image/png'); expect(r.primary).toBe('#187878'); }
    else if (!firstKept) { expect(sha(H.puts[0].body)).toBe(sha(second)); expect(r.primary).toBe('#187878'); }
    expect(H.most).toBeLessThanOrEqual(1); // never two decodes at once
  }, 30_000);
});
