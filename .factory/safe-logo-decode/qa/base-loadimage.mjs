// What the decoder the base handed logo bytes to (loadImage, @napi-rs/canvas, in the worker process) does with each
// fixture. Each file is decoded in its own Node process started here with its working directory at the base checkout,
// so a crash ends that process and not this one.
//   node .factory/safe-logo-decode/qa/base-loadimage.mjs <fixture dir> <base checkout> <out.json>
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const [dir, base, outFile] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(dir + '/manifest.json', 'utf8'));
const CHILD = `const { loadImage, createCanvas } = require('@napi-rs/canvas'); const fs = require('fs');
loadImage(fs.readFileSync(process.argv[1])).then(img => { const c = createCanvas(48, 48); const g = c.getContext('2d'); g.drawImage(img, 0, 0, 48, 48); g.getImageData(0, 0, 48, 48); console.log(JSON.stringify({ decoded: [img.width, img.height] })); }, e => { console.log(JSON.stringify({ threw: String(e && e.message || e).slice(0, 120) })); });`;
const rows = [];
for (const f of manifest) {
  if (f.bytes > 3 * 1024 * 1024) continue;
  const t = Date.now();
  const r = spawnSync(process.execPath, ['-e', CHILD, f.file], { cwd: base, encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH } });
  let answer = null; try { answer = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* none */ }
  rows.push({ kind: f.kind, name: f.name, bytes: f.bytes, status: r.status, signal: r.signal, ms: Date.now() - t, ...(answer || {}) });
}
fs.writeFileSync(outFile, JSON.stringify(rows, null, 1));
const crashed = rows.filter(r => r.signal);
console.log(`${rows.length} files: ${crashed.length} ended the process with a signal, ${rows.filter(r => r.decoded).length} decoded, ${rows.filter(r => r.threw).length} threw`);
for (const r of rows) console.log([r.kind, r.name, r.signal || (r.decoded ? 'decoded ' + r.decoded.join('x') : r.threw ? 'threw: ' + r.threw : 'status ' + r.status), r.ms + 'ms'].join(' | '));
