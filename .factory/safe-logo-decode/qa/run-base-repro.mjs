// Reproduces the defect on a checkout: detectBrand itself (not just the decoder) given a site whose logo is a
// crashing file, or whose logo or stylesheet is slow text. Each run is a child process with a time limit.
//   node .factory/safe-logo-decode/qa/run-base-repro.mjs <checkout> <fixture dir> <work dir> <out.json> [limit seconds]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const [checkout, fx, work, outFile, limitArg] = process.argv.slice(2); const limit = (+limitArg || 40) * 1000;
fs.mkdirSync(work, { recursive: true });
const script = path.join(path.dirname(new URL(import.meta.url).pathname), 'detect-once.ts');
const page = (links, extra = '') => `<!doctype html><html lang="fr"><head><title>Site</title><style>:root{--brand-primary:#2563eb}</style>${links}${extra}</head><body><p>Hello</p></body></html>`;
const one = (file, type) => ({ html: page('<link rel="apple-touch-icon" href="/logo">'), files: { '/logo': { type, file: path.join(fx, file) } } });
const cases = {
  'control: good PNG logo': one('good--png-rgba.png', 'image/png'),
  'crash: PNG with header and end, no picture data': one('bad--png-no-idat', 'image/png'),
  'crash: PNG whose header checksum is wrong': one('bad--png-ihdr-crc-wrong', 'image/png'),
  'crash: JPEG with no scan': one('bad--jpg-no-scan', 'image/jpeg'),
  'crash: JPEG start and end marker padded': one('bad--jpg-start-and-end-padded-4k', 'image/jpeg'),
  'crash: WebP with its size field 0': one('bad--webp-size-field-0', 'image/webp'),
  'crash: WebP cut in half with its size corrected': one('bad--webp-lossy-cut-with-size-corrected', 'image/webp'),
  'crash: an ordinary TIFF file': one('good--tiff-still.tiff', 'image/tiff'),
  'crash: PNG declaring 65536x65536': one('bad--png-declares-65536x65536', 'image/png'),
  'slow: SVG logo, 100 KB of fill=rgb(': { html: page('<link rel="apple-touch-icon" href="/logo.svg">'), files: { '/logo.svg': { type: 'image/svg+xml', repeat: ['fill=rgb(', Math.ceil(100_000 / 9)] } } },
  'slow: SVG logo, 300 KB of fill=rgb(': { html: page('<link rel="apple-touch-icon" href="/logo.svg">'), files: { '/logo.svg': { type: 'image/svg+xml', repeat: ['fill=rgb(', Math.ceil(300_000 / 9)] } } },
  'slow: stylesheet, 100 KB of --a:rgb(': { html: page('', '<link rel="stylesheet" href="/site.css">'), files: { '/site.css': { type: 'text/css', repeat: ['--a:rgb(', Math.ceil(100_000 / 8)] } } },
  'slow: stylesheet, 300 KB of --a:rgb(': { html: page('', '<link rel="stylesheet" href="/site.css">'), files: { '/site.css': { type: 'text/css', repeat: ['--a:rgb(', Math.ceil(300_000 / 8)] } } },
  'slow: stylesheet, 300 KB of dashes': { html: page('', '<link rel="stylesheet" href="/site.css">'), files: { '/site.css': { type: 'text/css', repeat: ['-', 300_000] } } },
  'slow: inline style, 300 KB of --a:rgb(': { html: page('', '<style>{{repeat|--a:rgb(|37500}}</style>'), files: {} },
};
const rows = [];
for (const [name, c] of Object.entries(cases)) {
  const caseFile = path.join(work, 'case.json'); fs.writeFileSync(caseFile, JSON.stringify(c));
  const t = Date.now();
  const r = spawnSync(process.execPath, ['--import', 'tsx', script, checkout, caseFile], { cwd: checkout, encoding: 'utf8', timeout: limit, killSignal: 'SIGKILL', env: { PATH: process.env.PATH, STORAGE_DIR: path.relative(checkout, path.join(work, 'storage')) } });
  const wall = Date.now() - t; const timedOut = r.error?.code === 'ETIMEDOUT';
  let answer = null; try { answer = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* the process ended before it could answer */ }
  const row = { name, status: r.status, signal: timedOut ? null : r.signal, stoppedByLimit: timedOut ? `still running after ${limit / 1000}s, stopped by this script` : undefined, wallMs: wall, answer, stderr: answer ? undefined : r.stderr.trim().split('\n').slice(-3).join(' | ').slice(0, 300) };
  rows.push(row);
  console.log(`${name}\n    ${timedOut ? row.stoppedByLimit : r.signal ? 'process ended by ' + r.signal : 'exit ' + r.status}; ${answer ? JSON.stringify(answer) : 'no answer'} (${wall} ms)${row.stderr ? '\n    stderr: ' + row.stderr : ''}`);
}
fs.writeFileSync(outFile, JSON.stringify({ checkout, rows }, null, 1));
