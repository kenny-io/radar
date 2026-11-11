/** Rebuild the committed, dependency-free social PNGs: node --import tsx scripts/generate-social-cards.ts */
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SEO_PAGES } from '../src/lib/seo';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const [file, family] of [['Geist-Regular.ttf', 'Radar Regular'], ['Geist-SemiBold.ttf', 'Radar Semibold']]) {
  if (!GlobalFonts.registerFromPath(`${root}node_modules/geist/dist/fonts/geist-sans/${file}`, family)) throw new Error(`Cannot load ${file}`);
}
mkdirSync(`${root}public/social`, { recursive: true });
for (const page of SEO_PAGES) {
  const canvas = createCanvas(1200, 630), c = canvas.getContext('2d');
  c.fillStyle = '#111318'; c.fillRect(0, 0, 1200, 630);
  // Faint concentric rings keep the Radar identity present without obscuring any card text.
  c.strokeStyle = '#252830'; c.lineWidth = 1;
  for (const radius of [170, 280, 390, 500]) { c.beginPath(); c.arc(1110, 310, radius, 0, Math.PI * 2); c.stroke(); }
  c.save(); c.translate(88, 83); c.scale(2.1, 2.1);
  for (let i = 0; i < 7; i++) { c.save(); c.rotate(i * Math.PI / 4); c.fillStyle = i === 1 ? '#ed6018' : '#fbfbf9'; c.fillRect(-1.3, i % 2 ? -11.3 : -10.2, 2.6, i % 2 ? 4.8 : 7.6); c.restore(); }
  c.restore();
  c.fillStyle = '#fbfbf9'; c.font = '600 31px "Radar Semibold"'; c.fillText('Radar', 128, 94);
  c.fillStyle = '#a6a9b1'; c.font = '400 19px "Radar Regular"'; c.fillText('by Thally', 224, 93);
  c.fillStyle = '#f78a55'; c.font = '400 19px "Radar Regular"'; c.fillText(page.label, 66, 166);
  c.fillStyle = '#fbfbf9'; c.font = '600 67px "Radar Semibold"';
  page.cardTitle.forEach((line, i) => c.fillText(line, 64, 256 + i * 79));
  c.fillStyle = '#b9bcc4'; c.font = '400 25px "Radar Regular"';
  const words = page.cardDescription.split(' '), lines: string[] = []; let line = '';
  for (const word of words) { const next = line ? `${line} ${word}` : word; if (c.measureText(next).width > 940 && line) { lines.push(line); line = word; } else line = next; }
  if (line) lines.push(line);
  lines.forEach((text, i) => c.fillText(text, 67, 418 + i * 35));
  c.fillStyle = '#343740'; c.fillRect(66, 510, 1068, 1);
  c.fillStyle = '#e1e2e5'; c.font = '400 21px "Radar Regular"'; c.fillText('radar.thally.io', 66, 562);
  c.fillStyle = '#f27636'; c.fillRect(1104, 543, 30, 7);
  writeFileSync(`${root}public/social/${page.slug}.png`, canvas.toBuffer('image/png'));
}
console.log(`Generated ${SEO_PAGES.length} public 1200×630 social cards.`);
