// Rasterize Radar's existing mark for email clients that do not support SVG.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile, writeFile } from 'node:fs/promises';
const source = new URL('../public/brand/radar-mark.svg', import.meta.url);
const size = 224; // 8× the displayed 28px mark.
const canvas = createCanvas(size, size);
const context = canvas.getContext('2d');
// An opaque white background keeps the dark mark legible when clients recolor email surfaces.
context.fillStyle = '#ffffff';
context.fillRect(0, 0, size, size);
// Give the SVG an explicit rasterization size before decoding. Without this,
// its 24px viewBox becomes a 24px bitmap that drawImage merely enlarges.
const svg = (await readFile(source, 'utf8')).replace('<svg ', `<svg width="${size}" height="${size}" `);
context.drawImage(await loadImage(Buffer.from(svg)), 0, 0, size, size);
await writeFile(new URL('../public/brand/radar-mark-email.png', import.meta.url), canvas.toBuffer('image/png'));
console.log('Rasterized the existing Radar mark for emails.');
