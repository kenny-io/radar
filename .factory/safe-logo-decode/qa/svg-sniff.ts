// Does the decoder render SVG out of a file that the byte probe accepts as a complete PNG, JPEG or WebP?
// Each candidate is checked with probeImage (the code under test) and then decoded in a separate Node process.
//   node --import tsx .factory/safe-logo-decode/qa/svg-sniff.ts
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probeImage, overPixelLimits } from '../../../src/server/services/untrustedImage';
import { good, pngChunks, pngFrom, PNG_SIG, ihdr, pngChunk, IEND } from './fixtures';
// A red 300×90 SVG: if the decoder renders it, the decoded size is 300×90 and the sample is red.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="90" viewBox="0 0 300 90"><rect width="300" height="90" fill="#ff0000"/></svg>`;
const XML = `<?xml version="1.0" encoding="ISO-8859-1"?>` + SVG;
const P = good('png-rgba.png'), J = good('jpg-baseline.jpg'), WL = good('webp-lossy.webp'), WLL = good('webp-lossless.webp');
const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const pc = pngChunks(P);
const cases: Record<string, Buffer> = {
  'whole webp (lossy), then SVG after the RIFF end': Buffer.concat([WL, Buffer.from(SVG)]),
  'whole webp (lossless), then SVG after the RIFF end': Buffer.concat([WLL, Buffer.from(SVG)]),
  'whole webp (lossy), then newline and XML declaration and SVG': Buffer.concat([WL, Buffer.from('\n' + XML)]),
  'whole JPEG, then SVG after the end marker': Buffer.concat([J, Buffer.from(SVG)]),
  'whole JPEG with the SVG in a comment segment': Buffer.concat([J.subarray(0, 2), Buffer.from([0xff, 0xfe]), (() => { const b = Buffer.alloc(2); b.writeUInt16BE(SVG.length + 2); return b; })(), Buffer.from(SVG), J.subarray(2)]),
  'whole PNG with the SVG in a text chunk': pngFrom([pc[0], { type: 'tEXt', data: Buffer.from('Comment\0' + SVG, 'latin1') }, ...pc.slice(1)]),
  'whole PNG with the SVG in a text chunk after the picture data': pngFrom([...pc.slice(0, -1), { type: 'tEXt', data: Buffer.from('Comment\0' + SVG, 'latin1') }, pc[pc.length - 1]]),
  'PNG header, SVG, end chunk': Buffer.concat([PNG_SIG, ihdr(128, 128), Buffer.from(SVG), IEND]),
  'whole PNG with the word <svg alone in a text chunk': pngFrom([pc[0], { type: 'tEXt', data: Buffer.from('Comment\0made from <svg> source', 'latin1') }, ...pc.slice(1)]),
  'whole JPEG with the word <svg alone in a comment segment': Buffer.concat([J.subarray(0, 2), Buffer.from([0xff, 0xfe, 0x00, 0x08]), Buffer.from('<svg> '), J.subarray(2)]),
  'whole webp with the word <svg after the RIFF end': Buffer.concat([WL, Buffer.from('<svg>')]),
  'RIFF/WEBP/VP8L header of 256x128 with no picture, then SVG': Buffer.concat([Buffer.from('RIFF'), u32le(4 + 8 + 6), Buffer.from('WEBP'), Buffer.from('VP8L'), u32le(6), Buffer.from([0x2f, 0xff, 0xc0, 0x1f, 0x00, 0x00]), Buffer.from(SVG)]),
  'whole PNG with <SVG upper case in a text chunk': pngFrom([pc[0], { type: 'tEXt', data: Buffer.from('Comment\0' + SVG.replace('<svg', '<SVG'), 'latin1') }, ...pc.slice(1)]),
};
const CHILD = `const { loadImage, createCanvas } = require('@napi-rs/canvas'); const fs = require('fs');
loadImage(fs.readFileSync(process.argv[1])).then(img => { const c = createCanvas(48, 48); const g = c.getContext('2d'); g.drawImage(img, 0, 0, 48, 48); const d = g.getImageData(24, 24, 1, 1).data; console.log(JSON.stringify({ decoded: [img.width, img.height], centre: [...d] })); }, e => { console.log(JSON.stringify({ threw: String(e && e.message || e).slice(0, 120) })); });`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-sniff-'));
const rows = Object.entries(cases).map(([name, body], i) => {
  const p = probeImage(body); const passes = !!p && p.complete && !p.animated && p.width > 0 && p.height > 0 && !overPixelLimits(p) && Math.min(p.width, p.height) >= 48;
  const file = path.join(dir, 'f' + i); fs.writeFileSync(file, body);
  const r = spawnSync(process.execPath, ['-e', CHILD, file], { encoding: 'utf8', timeout: 30000 });
  let a: any = {}; try { a = JSON.parse(r.stdout.trim()); } catch { /* */ }
  return { name, probe: p ? `${p.type} ${p.width}x${p.height} complete=${p.complete}` : 'null', reachesDecoder: passes, signal: r.signal, ...a, renderedAsSvg: !!a.decoded && a.decoded[0] === 300 && a.decoded[1] === 90 };
});
fs.rmSync(dir, { recursive: true, force: true });
fs.writeFileSync(path.resolve('.factory/safe-logo-decode/qa/evidence/svg-sniff.json'), JSON.stringify(rows, null, 1));
for (const r of rows) console.log(`${r.name}\n    probe: ${r.probe}; reaches decoder: ${r.reachesDecoder}; decoder: ${r.signal || (r.decoded ? 'decoded ' + r.decoded.join('x') + ' centre ' + r.centre : 'threw ' + r.threw)}${r.renderedAsSvg ? '   <== RENDERED AS SVG' : ''}`);
