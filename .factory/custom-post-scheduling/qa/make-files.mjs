// Synthetic upload files for the QA run (git-ignored output).
import fs from 'node:fs/promises'; import crypto from 'node:crypto'; import { createCanvas } from '@napi-rs/canvas';
const out = '.data/custom-post-qa/files'; await fs.mkdir(out, { recursive: true });
const draw = (w, h, label, bg = '#1F4D3A') => { const c = createCanvas(w, h), x = c.getContext('2d'); x.fillStyle = bg; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.font = `bold ${Math.round(Math.min(w, h) / 10)}px sans-serif`; x.fillText(label, 20, h / 2); return c; };
await fs.writeFile(out + '/landscape.jpg', draw(1200, 800, 'QA JPEG').toBuffer('image/jpeg'));
await fs.writeFile(out + '/second.png', draw(1000, 1000, 'QA PNG', '#7A1F3D').toBuffer('image/png'));
await fs.writeFile(out + '/third.webp', draw(900, 900, 'QA WEBP', '#22408A').toBuffer('image/webp'));
await fs.writeFile(out + '/tall.jpg', draw(400, 1600, 'TALL').toBuffer('image/jpeg'));          // 1:4, outside Instagram 4:5–1.91:1
await fs.writeFile(out + '/square.jpg', draw(1080, 1080, 'SQUARE').toBuffer('image/jpeg'));
// > 5 MB: noise PNG (incompressible)
{ const w = 1500, h = 1300, c = createCanvas(w, h), x = c.getContext('2d'), d = x.createImageData(w, h); crypto.randomFillSync(d.data); for (let i = 3; i < d.data.length; i += 4) d.data[i] = 255; x.putImageData(d, 0, 0); const b = c.toBuffer('image/png'); await fs.writeFile(out + '/big.png', b); console.log('big.png bytes', b.length); }
// GIF89a 1x1 (real GIF), plus the same bytes named .jpg
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
await fs.writeFile(out + '/anim.gif', gif); await fs.writeFile(out + '/gif-named.jpg', gif);
// Corrupt: valid JPEG start, truncated and overwritten body
{ const j = draw(800, 600, 'CORRUPT').toBuffer('image/jpeg'); const bad = Buffer.concat([j.subarray(0, 400), crypto.randomBytes(3000)]); await fs.writeFile(out + '/corrupt.jpg', bad); await fs.writeFile(out + '/truncated.jpg', j.subarray(0, Math.floor(j.length / 2))); }
await fs.writeFile(out + '/notes.txt', 'plain text, not an image'); await fs.writeFile(out + '/text-named.jpg', 'plain text, not an image');
await fs.writeFile(out + '/page.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
console.log((await fs.readdir(out)).join(' '));
