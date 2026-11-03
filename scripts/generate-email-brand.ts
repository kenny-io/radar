// Rasterize Radar's existing mark for email clients that do not support SVG.
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile, writeFile } from 'node:fs/promises';
const source = new URL('../public/brand/radar-mark.svg', import.meta.url);
const canvas = createCanvas(96, 96);
const context = canvas.getContext('2d');
// An opaque white background keeps the dark mark legible when clients recolor email surfaces.
context.fillStyle = '#ffffff';
context.fillRect(0, 0, 96, 96);
context.drawImage(await loadImage(await readFile(source)), 0, 0, 96, 96);
await writeFile(new URL('../public/brand/radar-mark-email.png', import.meta.url), canvas.toBuffer('image/png'));
console.log('Rasterized the existing Radar mark for emails.');
