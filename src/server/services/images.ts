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

export const imageModelConfigured = () => !env.devStubs && !!(env.openaiKey || env.xaiKey);
/** New articles get a real brand-colored illustration when an image model is available, else the branded graphic. */
export const defaultArticleImageStyle = (): 'illustration' | 'branded' => (imageModelConfigured() ? 'illustration' : 'branded');

/** Image providers in order; one that fails on its account (no credit, bad key) is skipped for 10 minutes. */
const imgDown = new Map<string, number>();
const accountFail = (status: number, body: string) => status === 401 || status === 402 || status === 403 || (status === 429 && /quota|credit|billing|insufficient/i.test(body));

async function openaiImage(prompt: string, w: number, h: number): Promise<Buffer> {
  const size = w / h > 1.2 ? '1536x1024' : w / h < 0.83 ? '1024x1536' : '1024x1024';
  const res = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { authorization: `Bearer ${env.openaiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1', prompt, size, n: 1 }) });
  if (!res.ok) { const t = await res.text(); throw Object.assign(new Error(`openai image ${res.status}: ${t.slice(0, 200)}`), { account: accountFail(res.status, t) }); }
  const b64 = (await res.json()).data?.[0]?.b64_json; if (!b64) throw new Error('openai image: empty');
  return Buffer.from(b64, 'base64');
}
async function xaiImage(prompt: string, w: number, h: number): Promise<Buffer> {
  const ratio = w / h > 1.6 ? '2:1' : w / h > 1.2 ? '16:9' : w / h < 0.7 ? '9:16' : w / h < 0.9 ? '3:4' : '1:1';
  const res = await fetch('https://api.x.ai/v1/images/generations', { method: 'POST', headers: { authorization: `Bearer ${env.xaiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: process.env.XAI_IMAGE_MODEL || 'grok-imagine-image', prompt, n: 1, aspect_ratio: ratio, response_format: 'b64_json' }) });
  if (!res.ok) { const t = await res.text(); throw Object.assign(new Error(`xai image ${res.status}: ${t.slice(0, 200)}`), { account: accountFail(res.status, t) }); }
  const b64 = (await res.json()).data?.[0]?.b64_json; if (!b64) throw new Error('xai image: empty');
  return Buffer.from(b64, 'base64');
}

/** The prompt sent to image models: the subject plus the brand's colors and style, never any text in the image. */
export function imagePrompt(r: Pick<ImageReq, 'style' | 'prompt' | 'headline' | 'name' | 'brand' | 'seed'>): string {
  const style = r.style === 'photography'
    ? 'Editorial photograph, natural light, realistic, shallow depth of field'
    : 'Modern flat editorial illustration, clean geometric shapes, generous negative space, calm and professional';
  return `${style}. Subject: ${r.prompt || r.headline}. Made for ${r.name}'s blog. Color palette built around the brand colors ${r.brand.primary} and ${r.brand.secondary}, with neutral tones. Variation ${r.seed}. No words, letters, numbers, logos or watermarks anywhere in the image.`;
}

async function generatePhoto(r: ImageReq): Promise<Buffer> {
  const prompt = imagePrompt(r);
  const providers: [string, () => Promise<Buffer>][] = [];
  if (env.openaiKey) providers.push(['openai', () => openaiImage(prompt, r.w, r.h)]);
  if (env.xaiKey) providers.push(['xai', () => xaiImage(prompt, r.w, r.h)]);
  let raw: Buffer | null = null; let last: any = null;
  for (const [name, run] of providers) {
    if ((imgDown.get(name) || 0) > Date.now()) continue;
    try { raw = await run(); break; } catch (e: any) { last = e; if (e?.account) imgDown.set(name, Date.now() + 10 * 60e3); console.warn('[images]', e?.message); }
  }
  if (!raw) throw last || new Error('no image provider available');
  // Cover-crop to the exact aspect ratio
  const img = await loadImage(raw);
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
