// AC7 and D7, with hostile text of the sizes the crawler's fetch allows (2 MB a response; brand.ts reads a logo of up
// to 3 MB and the first 300,000 characters of each of three stylesheets, and all of the home page's inline style).
// Through detectBrand, with the fetch and storage replaced. Writes evidence/timing.json.
// (Expensive page structures, which can stall a process, are run by structures-run.ts in child processes.)
import { afterAll, describe, expect, it, vi } from 'vitest';
const H = vi.hoisted(() => ({ fetchUrl: (..._a: any[]): any => null, puts: [] as any[] }));
vi.mock('@/server/services/analysis/crawl', async original => ({ ...(await original<any>()), fetchUrl: (...a: any[]) => H.fetchUrl(...a) }));
vi.mock('@/server/services/storage', async original => ({ ...(await original<any>()), putObject: async (key: string, body: Buffer, type: string) => { H.puts.push({ key, body, type }); return '/api/files/' + key; } }));
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { detectBrand, svgColors } from '@/server/services/analysis/brand';
import { QA_DIR } from './fixtures';
import { CSS_PRIMARY, ORIGIN, page, site } from './harness';

const evidence: any = { svg: [], css: [] };
afterAll(() => fs.writeFileSync(path.join(QA_DIR, 'evidence/timing.json'), JSON.stringify(evidence, null, 1)));
const fill = (unit: string, bytes: number) => unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes);
const MB = 1024 * 1024;

const SVG_UNITS: Record<string, string> = {
  'fill=rgb(': 'fill=rgb(',
  'fill, 64 spaces, =, 64 spaces': 'fill' + ' '.repeat(64) + '=' + ' '.repeat(64),
  'fill, 65 spaces (one too many), =': 'fill' + ' '.repeat(65) + '=',
  'stroke:rgb( and 100 characters, never closed': 'stroke:rgb(' + 'x'.repeat(100),
  'stroke:rgb( and 99 characters and a bracket (a match every time, no colour)': 'stroke:rgb(' + 'x'.repeat(99) + ')',
  'the word color': 'color',
  'stop-color and new lines': 'stop-color' + '\n'.repeat(64),
  'fill="#': 'fill="#',
  'fill:\'': "fill:'",
  'a real declaration (one colour, many times)': 'fill="#0f766e" ',
  'spaces only': ' ',
  'fillfillfill': 'fill',
  'rgb( only': 'rgb(',
  '= only': '=',
};
describe('an SVG logo of hostile text is read in under 2 seconds (AC7)', () => {
  it.each(Object.entries(SVG_UNITS).flatMap(([n, u]) => [[n, u, 2 * MB] as const, [n, u, 3 * MB] as const]))('%s, to %i bytes', async (name, unit, bytes) => {
    const head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">';
    const body = head + fill(unit, bytes - head.length);
    expect(body.length).toBe(bytes);
    H.puts.length = 0; H.fetchUrl = site({ '/logo.svg': { type: 'image/svg+xml', body } }).fetchUrl;
    const t = performance.now(); const r = await detectBrand('qa', page(['/logo.svg']), ORIGIN); const ms = Math.round(performance.now() - t);
    evidence.svg.push({ name, bytes, ms, kept: H.puts.length === 1, primary: r.primary });
    expect(H.puts).toHaveLength(1); expect(H.puts[0].type).toBe('image/svg+xml'); // it was read as an SVG logo, so the pattern ran over all of it
    expect(r.primary).toBe(CSS_PRIMARY);
    expect(ms).toBeLessThan(2000);
  });
  it('an SVG that declares 150,000 different colours', async () => {
    const body = '<svg xmlns="http://www.w3.org/2000/svg">' + Array.from({ length: 150_000 }, (_, i) => `<a fill="#${(0x200000 + i * 97).toString(16).padStart(6, '0')}"/>`).join('') + '</svg>';
    H.puts.length = 0; H.fetchUrl = site({ '/logo.svg': { type: 'image/svg+xml', body } }).fetchUrl;
    const t = performance.now(); const r = await detectBrand('qa', page(['/logo.svg'], { styled: false }), ORIGIN); const ms = Math.round(performance.now() - t);
    evidence.svg.push({ name: '150,000 different colours', bytes: body.length, ms, colours: svgColors(body).length, primary: r.primary });
    expect(r.primary).not.toBeNull(); expect(ms).toBeLessThan(2000);
  });
});

const CSS_UNITS: Record<string, string> = {
  '--a:rgb(': '--a:rgb(',
  'dashes': '-',
  '--a--a': '--a',
  '--a, 64 spaces, colon, 64 spaces': '--a' + ' '.repeat(64) + ':' + ' '.repeat(64),
  'one name of the whole length': 'a',
  '--a:#': '--a:#',
  ';--a:rgb( and 100 characters, never closed': ';--a:rgb(' + 'x'.repeat(100),
  'the worst unit: 128-character name, 64 spaces, colon, 64 spaces, rgb( and 100 characters': ';--' + 'a'.repeat(128) + ' '.repeat(64) + ':' + ' '.repeat(64) + 'rgb(' + 'x'.repeat(100),
  'names of 129 characters': ';--' + 'a'.repeat(129) + ':#fff',
  'a real declaration, many times': '--brand-x:#0f766e;',
  'underscore then --a:#fff (never a name start)': '_--a:#fff',
  'space and two dashes': ' --',
  'new lines only': '\n',
  '--a then new lines': '--a\n\n\n\n',
  '--a:rgb(1,2,3 and 97 spaces (just inside the limit, closed)': '--a:rgb(1,2,3' + ' '.repeat(95) + ');',
};
describe('stylesheets and inline style of hostile text are read in under 2 seconds (AC7)', () => {
  it.each(Object.entries(CSS_UNITS))('%s: three stylesheets of 2 MB (300,000 characters of each are read) and 1.9 MB inline', async (name, unit) => {
    const sheet = (unit === 'a' ? '--' : '') + fill(unit, 2 * MB - 2);
    const inline = (unit === 'a' ? '--' : '') + fill(unit, 1.9 * MB);
    const st = site({ '/1.css': { type: 'text/css', body: sheet }, '/2.css': { type: 'text/css', body: sheet }, '/3.css': { type: 'text/css', body: sheet } }); H.fetchUrl = st.fetchUrl;
    const html = page([], { styled: false, head: `<meta name="theme-color" content="#2563eb"><link rel="stylesheet" href="/1.css"><link rel="stylesheet" href="/2.css"><link rel="stylesheet" href="/3.css"><style>${inline}</style>` });
    const t0 = performance.now(); cheerio.load(html); const parseMs = Math.round(performance.now() - t0);
    const t = performance.now(); const r = await detectBrand('qa', html, ORIGIN); const ms = Math.round(performance.now() - t);
    evidence.css.push({ name, htmlBytes: html.length, ms, parseAloneMs: parseMs, primary: r.primary, secondary: r.secondary });
    expect(st.asked).toEqual(['/1.css', '/2.css', '/3.css']);
    expect(r.language).toBe('French');
    expect(ms).toBeLessThan(2000);
  });
});
