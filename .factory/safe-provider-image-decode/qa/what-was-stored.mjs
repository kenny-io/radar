// What picture a malformed file gives when the decoder accepts it (the base and the revision under test return the
// same bytes for these: see compare.mjs). Each file is decoded in its own process, with the base's crop, and the crop is
// described: how much of it is fully transparent, and how many distinct colours a 40×21 sample of it has.
//   node .factory/safe-provider-image-decode/qa/what-was-stored.mjs <corpus dir> <evidence/new.json> [limit]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const [corpus, newFile] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(newFile, 'utf8')).rows.filter(r => (r.group === 'bad' || r.group === 'limits') && r.out[0].ok && !r.name.startsWith('base-control'));
const CHILD = `const { createCanvas, loadImage } = require('@napi-rs/canvas'); const fs = require('fs');
(async () => { const img = await loadImage(fs.readFileSync(process.argv[1])); const w = 1200, h = 628; const c = createCanvas(w, h); const ctx = c.getContext('2d');
const s = Math.max(w / img.width, h / img.height); const dw = img.width * s, dh = img.height * s; ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
const d = ctx.getImageData(0, 0, w, h).data; let clear = 0; const colours = new Set();
for (let i = 3; i < d.length; i += 4) if (d[i] === 0) clear++;
for (let y = 15; y < h; y += 30) for (let x = 15; x < w; x += 30) { const i = (y * w + x) * 4; colours.add((d[i] >> 3) + ',' + (d[i + 1] >> 3) + ',' + (d[i + 2] >> 3) + ',' + (d[i + 3] >> 3)); }
console.log(JSON.stringify({ clear: clear / (w * h), colours: colours.size })); })();`;
const tally = { 'entirely transparent': 0, 'one flat colour': 0, 'partly transparent (over 10%)': 0, 'a picture (possibly garbled)': 0 }; const examples = {};
for (const r of rows) {
  const p = spawnSync(process.execPath, ['-e', CHILD, `${corpus}/${r.group}/${r.name}`], { encoding: 'utf8', timeout: 60000 });
  let a; try { a = JSON.parse(p.stdout.trim()); } catch { continue; }
  const k = a.clear > 0.999 ? 'entirely transparent' : a.colours === 1 ? 'one flat colour' : a.clear > 0.1 ? 'partly transparent (over 10%)' : 'a picture (possibly garbled)';
  tally[k]++; (examples[k] ??= []).length < 6 && examples[k].push(r.name);
}
console.log(JSON.stringify({ malformedFilesThatGiveACrop: rows.length, tally, examples }, null, 1));
