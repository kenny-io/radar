// What coverCrop did before this change (main b3ad2d50: loadImage and the draw inside the calling process), for every
// file of the corpus. Each file gets its own Node process, started here with the worktree as its working directory, so
// a crash ends that process and is recorded as a signal.
//   node .factory/safe-provider-image-decode/qa/old-decode.mjs <corpus dir> <out.json> [group,group]
// The function in CHILD is the base's coverCrop, copied from `git show b3ad2d50:src/server/services/images.ts`.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { cropsFor } from './crops.mjs';

const [dir, outFile, only] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(dir + '/manifest.json', 'utf8')).filter(f => !only || only.split(',').includes(f.group));
const CHILD = `
const { createCanvas, loadImage } = require('@napi-rs/canvas'); const fs = require('fs'); const crypto = require('crypto');
async function coverCrop(raw, w, h) {
  const img = await loadImage(raw);
  const c = createCanvas(w, h); const ctx = c.getContext('2d');
  const s = Math.max(w / img.width, h / img.height); const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return c.toBuffer('image/png');
}
const raw = fs.readFileSync(process.argv[1]); const out = [];
(async () => {
  for (const size of JSON.parse(process.argv[2])) {
    const [w, h] = size; const t = Date.now();
    try { const png = await coverCrop(raw, w, h); out.push({ size: w + 'x' + h, ok: true, sha: crypto.createHash('sha256').update(png).digest('hex'), bytes: png.length, ms: Date.now() - t }); }
    catch (e) { out.push({ size: w + 'x' + h, threw: String(e && e.message || e).slice(0, 160), errorClass: e && e.constructor && e.constructor.name, code: e && e.code, status: e && e.status }); }
  }
  let natural = null; try { const i = await loadImage(raw); natural = [i.width, i.height]; } catch {}
  console.log(JSON.stringify({ out, natural, maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024) }));
})();`;

function one(f) {
  return new Promise(resolve => {
    const sizes = cropsFor(f); const t = Date.now(); let stdout = '';
    const p = spawn(process.execPath, ['-e', CHILD, f.file, JSON.stringify(sizes)], { cwd: process.cwd(), env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'ignore'] });
    const timer = setTimeout(() => p.kill('SIGKILL'), 120_000);
    p.stdout.on('data', d => { stdout += d; });
    p.on('close', (status, signal) => {
      clearTimeout(timer);
      let answer = null; try { answer = JSON.parse(stdout.trim().split('\n').pop()); } catch { /* none */ }
      resolve({ group: f.group, name: f.name, bytes: f.bytes, note: f.note, status, signal, ms: Date.now() - t, ...(answer || {}) });
    });
  });
}
const rows = []; let next = 0;
await Promise.all(Array.from({ length: Math.max(2, Math.min(6, os.cpus().length - 2)) }, async () => { while (next < manifest.length) { const f = manifest[next++]; rows.push(await one(f)); } }));
rows.sort((a, b) => (a.group + a.name < b.group + b.name ? -1 : 1));
fs.writeFileSync(outFile, JSON.stringify(rows, null, 1));
const sig = rows.filter(r => r.signal); const by = {};
for (const r of rows) { const k = r.signal ? 'ended the process (' + r.signal + ')' : r.out?.[0]?.ok ? 'cropped' : r.out?.[0]?.threw ? 'threw: ' + r.out[0].threw : 'status ' + r.status; by[r.group] ??= {}; by[r.group][k] = (by[r.group][k] || 0) + 1; }
console.log(`${rows.length} files; ${sig.length} ended the decoding process with a signal`);
console.log(JSON.stringify(by, null, 1));
