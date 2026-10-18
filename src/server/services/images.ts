// Image generation (02-system.md §7 Images). Server renders brand templates ("Branded graphic", "Infographic") with
// @napi-rs/canvas; "Photography" / "Illustration" use the OpenAI Images API when configured. Exact sizes per use.
// Without an image model configured, Photography/Illustration fall back to the brand template (DIVERGENCES).
import path from 'node:path';
import fs from 'node:fs';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { drawVisual } from '@/lib/visual';
import { env } from '../env';
import { objectKey, putObject } from './storage';

let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return; fontsReady = true;
  const dir = path.join(process.cwd(), 'node_modules/geist/dist/fonts');
  for (const [f, fam] of [['geist-sans/Geist-Regular.ttf', 'Geist'], ['geist-sans/Geist-Medium.ttf', 'Geist'], ['geist-sans/Geist-SemiBold.ttf', 'Geist'], ['geist-mono/GeistMono-Regular.ttf', 'Geist Mono']] as const) {
    const p = path.join(dir, f); if (fs.existsSync(p)) GlobalFonts.registerFromPath(p, fam);
  }
}

export interface ImageReq { bid: string; style: string; brand: { primary: string; secondary: string }; headline: string; name: string; seed: number; prompt?: string; w: number; h: number; kind?: string }

export function renderTemplatePng(r: Omit<ImageReq, 'bid'>): Buffer {
  ensureFonts();
  const c = createCanvas(r.w, r.h);
  drawVisual(c.getContext('2d') as any, { w: r.w, h: r.h, style: r.style, brand: r.brand, headline: r.headline, seed: r.seed, name: r.name, fontFamily: '"Geist", sans-serif' });
  return c.toBuffer('image/png');
}

export const imageModelConfigured = () => !!env.openaiKey && !env.devStubs;

async function generatePhoto(r: ImageReq): Promise<Buffer> {
  const style = r.style === 'photography' ? 'Editorial photograph, natural light, realistic, no text' : 'Flat editorial illustration, simple shapes, no text';
  const prompt = `${style}. Subject: ${r.prompt || r.headline}. For a business called ${r.name}. Use the brand colors ${r.brand.primary} and ${r.brand.secondary} as accents. Variation ${r.seed}. Do not include any words, letters or logos.`;
  const size = r.w / r.h > 1.2 ? '1536x1024' : r.w / r.h < 0.83 ? '1024x1536' : '1024x1024';
  const res = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { authorization: `Bearer ${env.openaiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1', prompt, size, n: 1 }) });
  if (!res.ok) throw new Error(`image ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const b64 = j.data?.[0]?.b64_json; if (!b64) throw new Error('image: empty');
  // Cover-crop to the exact aspect ratio
  const img = await loadImage(Buffer.from(b64, 'base64'));
  const c = createCanvas(r.w, r.h); const ctx = c.getContext('2d');
  const s = Math.max(r.w / img.width, r.h / img.height); const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, (r.w - dw) / 2, (r.h - dh) / 2, dw, dh);
  return c.toBuffer('image/png');
}

/** Render or generate a visual and store it. Returns a public URL. */
export async function renderImage(r: ImageReq): Promise<string> {
  let png: Buffer;
  if ((r.style === 'photography' || r.style === 'illustration') && imageModelConfigured()) {
    try { png = await generatePhoto(r); } catch (e: any) { console.error('[images] generation failed, using template', e.message); png = renderTemplatePng(r); }
  } else png = renderTemplatePng(r);
  return putObject(objectKey(r.bid, r.kind || 'images', 'png'), png, 'image/png');
}
