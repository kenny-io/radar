// Image generation (02-system.md §7 Images). Server renders brand templates ("Branded graphic", "Infographic") with
// @napi-rs/canvas; "Photography" / "Illustration" use an image model when configured: OpenRouter (if OPENROUTER_API_KEY),
// then the OpenAI Images API, then xAI. Exact sizes per use (cover-cropped).
// Without an image model configured, Photography/Illustration fall back to the brand template (DIVERGENCES).
import path from 'node:path';
import fs from 'node:fs';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { drawVisual } from '@/lib/visual';
import { env } from '../env';
import { OPENROUTER_BASE, openrouterHeaders, openrouterImageModel, openrouterDown, markOpenrouterDown, openrouterTripped, isOpenrouterAccountError, noteOpenrouterOutcome } from '../ai/adapters/openrouter';
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

export const imageModelConfigured = () => !env.devStubs && !!(env.openrouterKey || env.openaiKey || env.xaiKey);
/** New articles get a real brand-colored illustration when an image model is available, else the branded graphic. */
export const defaultArticleImageStyle = (): 'illustration' | 'branded' => (imageModelConfigured() ? 'illustration' : 'branded');

/** Image providers in order; one that fails on its account (no credit, bad key) is skipped for 10 minutes. */
const imgDown = new Map<string, number>();
const accountFail = (status: number, body: string) => status === 401 || status === 402 || status === 403 || (status === 429 && /quota|credit|billing|insufficient/i.test(body));

/** Closest aspect ratio OpenRouter image models broadly accept; the result is cover-cropped to the exact size anyway. */
const OR_RATIOS: [string, number][] = [['1:1', 1], ['4:3', 4 / 3], ['3:4', 3 / 4], ['3:2', 3 / 2], ['2:3', 2 / 3], ['16:9', 16 / 9], ['9:16', 9 / 16]];
export function openrouterAspect(w: number, h: number): string {
  const r = Math.log(w / h);
  return OR_RATIOS.reduce((best, cur) => (Math.abs(Math.log(cur[1]) - r) < Math.abs(Math.log(best[1]) - r) ? cur : best))[0];
}
/** Total time allowed for one OpenRouter image (then the next image provider is tried). */
export const OPENROUTER_IMAGE_TIMEOUT_MS = 60_000;
/** OpenRouter failures carry `status`; `account` uses the same rule as text calls (a moderation 403 is not an account error). */
const orImageError = (status: number, msg: string) => { const e: any = new Error(`openrouter image ${status || ''}: ${msg.slice(0, 200)}`); e.status = status; e.account = isOpenrouterAccountError(e); return e; };
async function openrouterImage(prompt: string, w: number, h: number): Promise<Buffer> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), OPENROUTER_IMAGE_TIMEOUT_MS);
  let res: Response; let j: any;
  try {
    res = await fetch(`${OPENROUTER_BASE}/images`, { method: 'POST', headers: openrouterHeaders(), body: JSON.stringify({ model: openrouterImageModel(), prompt, aspect_ratio: openrouterAspect(w, h), n: 1 }), signal: ctl.signal });
    if (!res.ok) throw orImageError(res.status, await res.text());
    j = await res.json();
  } catch (e: any) {
    if (ctl.signal.aborted) throw Object.assign(new Error(`openrouter image: timed out after ${OPENROUTER_IMAGE_TIMEOUT_MS / 1000}s`), { timeout: true });
    throw e;
  } finally { clearTimeout(t); }
  if (j?.error) { const code = Number(j.error.code); throw orImageError(code >= 400 && code < 600 ? code : 0, String(j.error.message || j.error.code || 'error')); }
  const img = j?.data?.[0];
  const b64 = String(img?.b64_json || '').replace(/^data:[^,]*,/, ''); if (!b64) throw new Error('openrouter image: empty');
  if (/svg/i.test(String(img?.media_type || ''))) throw new Error('openrouter image: SVG output is not supported');
  return Buffer.from(b64, 'base64');
}
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
/** Prompt template per visual style (UPDATE-2026-10-21-image-options: each style key maps to a template; labels stay the same). */
export const STYLE_PROMPTS: Record<string, string> = {
  editorial: 'Conceptual editorial illustration built around one clear visual metaphor, textured shapes, magazine-cover quality, calm and professional',
  flat: 'Flat vector illustration, clean geometric shapes, simple stylised characters, minimal detail, solid fills, generous negative space',
  render3d: '3D render of glossy glass, soft clay or brushed metal objects with real depth, soft studio lighting and gentle shadows',
  handdrawn: 'Hand-drawn illustration, ink and pencil sketch on textured paper, loose confident linework with light watercolor washes',
  photography: 'Editorial photograph, natural light, realistic, shallow depth of field',
  illustration: 'Modern flat editorial illustration, clean geometric shapes, generous negative space, calm and professional',
};
/** Styles that go to the image model when one is configured (the rest are brand templates). */
export const MODEL_STYLES = ['editorial', 'flat', 'render3d', 'handdrawn', 'photography', 'illustration'];

export function imagePrompt(r: Pick<ImageReq, 'style' | 'prompt' | 'headline' | 'name' | 'brand' | 'seed' | 'kind'>): string {
  const style = STYLE_PROMPTS[r.style] || STYLE_PROMPTS.illustration;
  const where = r.kind === 'brief' || r.kind === 'social' ? `${r.name}'s social media post` : `${r.name}'s blog`;
  return `${style}. Subject: ${r.prompt || r.headline}. Made for ${where}. Color palette built around the brand colors ${r.brand.primary} and ${r.brand.secondary}, with neutral tones. Variation ${r.seed}. No words, letters, numbers, logos or watermarks anywhere in the image.`;
}

export async function generatePhoto(r: ImageReq): Promise<Buffer> {
  const prompt = imagePrompt(r);
  const providers: [string, () => Promise<Buffer>][] = [];
  // The OpenRouter breaker (repeated timeouts/5xx) only skips it when another image provider is configured.
  if (env.openrouterKey && !openrouterDown() && !(openrouterTripped() && (env.openaiKey || env.xaiKey))) providers.push(['openrouter', () => openrouterImage(prompt, r.w, r.h)]);
  if (env.openaiKey) providers.push(['openai', () => openaiImage(prompt, r.w, r.h)]);
  if (env.xaiKey) providers.push(['xai', () => xaiImage(prompt, r.w, r.h)]);
  let raw: Buffer | null = null; let last: any = null;
  for (const [name, run] of providers) {
    if ((imgDown.get(name) || 0) > Date.now()) continue;
    try { raw = await run(); if (name === 'openrouter') noteOpenrouterOutcome(); break; } catch (e: any) {
      last = e; console.warn('[images]', e?.message);
      if (name === 'openrouter') noteOpenrouterOutcome(e);
      // OpenRouter is one account for text and images: its account failures use the shared OpenRouter cooldown.
      if (e?.account) { if (name === 'openrouter') markOpenrouterDown(String(e?.message || '')); else imgDown.set(name, Date.now() + 10 * 60e3); }
    }
  }
  if (!raw) throw last || new Error('no image provider available');
  // Cover-crop to the exact aspect ratio
  const img = await loadImage(raw);
  const c = createCanvas(r.w, r.h); const ctx = c.getContext('2d');
  const s = Math.max(r.w / img.width, r.h / img.height); const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, (r.w - dw) / 2, (r.h - dh) / 2, dw, dh);
  return c.toBuffer('image/png');
}

/** Render or generate a visual and store it. Returns the public URL plus the stored file's size and type (social posting
 *  checks them against each platform's limits without fetching the file). */
export async function renderImageFile(r: ImageReq): Promise<{ url: string; bytes: number; type: string }> {
  let png: Buffer;
  if (MODEL_STYLES.includes(r.style) && imageModelConfigured()) {
    try { png = await generatePhoto(r); } catch (e: any) { console.error('[images] generation failed, using template', e.message); png = renderTemplatePng(r); }
  } else png = renderTemplatePng(r);
  const url = await putObject(objectKey(r.bid, r.kind || 'images', 'png'), png, 'image/png');
  return { url, bytes: png.length, type: 'image/png' };
}
/** Render or generate a visual and store it. Returns a public URL. */
export async function renderImage(r: ImageReq): Promise<string> { return (await renderImageFile(r)).url; }
