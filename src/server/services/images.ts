// Image generation (02-system.md §7 Images). Server renders brand templates ("Branded graphic", "Infographic") with
// @napi-rs/canvas; "Photography" / "Illustration" use an image model when configured: OpenRouter (if OPENROUTER_API_KEY),
// then the OpenAI Images API, then xAI. Exact sizes per use (cover-cropped).
// Without an image model configured, Photography/Illustration fall back to the brand template (DIVERGENCES), and the
// result says so (`placeholder`) so an article cover can be marked. A strict request (`modelRequired`: custom
// directions, article body images, a cover a person asked to regenerate) never falls back: it throws.
// A model's picture comes from the provider's server, so this process never decodes it. coverCrop first reads the
// type, the pixel size and completeness from the bytes, then decodes and crops in a short-lived child process
// (./untrustedImage.ts, shared with covers and logos). The templates are Radar's own drawing and are made here.
import path from 'node:path';
import fs from 'node:fs';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { drawVisual } from '@/lib/visual';
import { env } from '../env';
import { RadarError } from '../errors';
import { reportFailure } from '../observability/failures';
import { OPENROUTER_BASE, openrouterHeaders, openrouterImageModel, openrouterDown, markOpenrouterDown, openrouterTripped, isOpenrouterAccountError, noteOpenrouterOutcome } from '../ai/adapters/openrouter';
import { recordAiCall } from '../ai/record';
import type { Usage } from '../ai/prices';
import type { ImageIssueReason } from '@/lib/types';
import { objectKey, putObject } from './storage';
import { ImageRefused, decodeInChild, overPixelLimits, probeImage } from './untrustedImage';

let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return; fontsReady = true;
  const dir = path.join(process.cwd(), 'node_modules/geist/dist/fonts');
  for (const [f, fam] of [['geist-sans/Geist-Regular.ttf', 'Geist'], ['geist-sans/Geist-Medium.ttf', 'Geist'], ['geist-sans/Geist-SemiBold.ttf', 'Geist'], ['geist-mono/GeistMono-Regular.ttf', 'Geist Mono']] as const) {
    const p = path.join(dir, f); if (fs.existsSync(p)) GlobalFonts.registerFromPath(p, fam);
  }
}

export interface ImageReq { bid: string; style: string; brand: { primary: string; secondary: string }; headline: string; name: string; seed: number; prompt?: string; w: number; h: number; kind?: string; /** Never fall back to the template: explicit custom requests, article body images, and a cover a person asked to regenerate. */ modelRequired?: boolean; /** Ask for a centred subject with spare background (a social pack's shared image, cropped once per platform). */ cropSafe?: boolean;
  /** The prompt is a literal scene direction (article images written by Radar): draw the thing itself, never a
   *  metaphor. Absent: the prompt every caller gets today, unchanged. */
  literal?: boolean }

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
/** One provider's answer: the raw image and what the response said it cost (for ai_calls). An error thrown after the
 *  provider answered (a body error, an empty or SVG image) carries that usage as `billed`, so the row keeps it. */
type Generated = { buf: Buffer; usage?: Usage & { costUsd?: number } };
const tok = (v: any): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
async function openrouterImage(prompt: string, w: number, h: number): Promise<Generated> {
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
  const usage = { inputTokens: tok(j?.usage?.prompt_tokens), outputTokens: tok(j?.usage?.completion_tokens), costUsd: tok(j?.usage?.cost) };
  if (j?.error) { const code = Number(j.error.code); throw Object.assign(orImageError(code >= 400 && code < 600 ? code : 0, String(j.error.message || j.error.code || 'error')), { billed: usage }); }
  const img = j?.data?.[0];
  const b64 = String(img?.b64_json || '').replace(/^data:[^,]*,/, ''); if (!b64) throw Object.assign(new Error('openrouter image: empty'), { billed: usage });
  if (/svg/i.test(String(img?.media_type || ''))) throw Object.assign(new Error('openrouter image: SVG output is not supported'), { billed: usage });
  return { buf: Buffer.from(b64, 'base64'), usage };
}
/** OpenAI's Images API model. `gpt-image-1` was shut down on 2026-10-23; OpenAI's deprecations page and Create image
 *  reference (read 2026-11-13) name the GPT-Image-2.5 pair as its replacement, and Flare is the one for everyday
 *  generation. GPT image models always return base64, so no response_format is sent. */
export const OPENAI_IMAGE_DEFAULT = 'gpt-image-2.5-flare';
const openaiImageModel = () => process.env.OPENAI_IMAGE_MODEL || OPENAI_IMAGE_DEFAULT;
async function openaiImage(prompt: string, w: number, h: number): Promise<Generated> {
  const size = w / h > 1.2 ? '1536x1024' : w / h < 0.83 ? '1024x1536' : '1024x1024';
  const res = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { authorization: `Bearer ${env.openaiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: openaiImageModel(), prompt, size, n: 1 }) });
  if (!res.ok) { const t = await res.text(); throw Object.assign(new Error(`openai image ${res.status}: ${t.slice(0, 200)}`), { status: res.status, account: accountFail(res.status, t) }); }
  const j = await res.json(); const usage = { inputTokens: tok(j?.usage?.input_tokens), outputTokens: tok(j?.usage?.output_tokens) };
  const b64 = j.data?.[0]?.b64_json; if (!b64) throw Object.assign(new Error('openai image: empty'), { billed: usage });
  return { buf: Buffer.from(b64, 'base64'), usage };
}
async function xaiImage(prompt: string, w: number, h: number): Promise<Generated> {
  const ratio = w / h > 1.6 ? '2:1' : w / h > 1.2 ? '16:9' : w / h < 0.7 ? '9:16' : w / h < 0.9 ? '3:4' : '1:1';
  const res = await fetch('https://api.x.ai/v1/images/generations', { method: 'POST', headers: { authorization: `Bearer ${env.xaiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: process.env.XAI_IMAGE_MODEL || 'grok-imagine-image', prompt, n: 1, aspect_ratio: ratio, response_format: 'b64_json' }) });
  if (!res.ok) { const t = await res.text(); throw Object.assign(new Error(`xai image ${res.status}: ${t.slice(0, 200)}`), { status: res.status, account: accountFail(res.status, t) }); }
  const b64 = (await res.json()).data?.[0]?.b64_json; if (!b64) throw new Error('xai image: empty');
  // xAI reports no usage; it bills per image delivered (prices.ts IMAGE_PRICE).
  return { buf: Buffer.from(b64, 'base64'), usage: { images: 1 } };
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

/** Style texts for literal scenes, where the standard text asks for a metaphor or for abstract objects. */
export const STYLE_PROMPTS_LITERAL: Record<string, string> = {
  editorial: 'Editorial illustration with textured shapes, magazine-cover quality, calm and professional',
  render3d: '3D render with real depth, soft studio lighting and gentle shadows, with glossy glass, soft clay or brushed metal finishes',
};

export function imagePrompt(r: Pick<ImageReq, 'style' | 'prompt' | 'headline' | 'name' | 'brand' | 'seed' | 'kind' | 'cropSafe' | 'literal'>): string {
  if (r.literal) {
    const style = STYLE_PROMPTS_LITERAL[r.style] || STYLE_PROMPTS[r.style] || STYLE_PROMPTS.illustration;
    const scene = (r.prompt || r.headline).trim().replace(/\s+/g, ' ');
    return `${style}. Show exactly this scene: ${scene}${/[.!?]$/.test(scene) ? '' : '.'} Draw the real thing described, literally and recognisably, in its setting. Do not replace it with a visual metaphor, symbols, icons or abstract shapes. Made for ${r.name}'s blog. Use the brand colors ${r.brand.primary} and ${r.brand.secondary} as accents where they fit naturally, with realistic, neutral tones elsewhere. Variation ${r.seed}. Any signs, screens or documents in the scene are blank. No words, letters, numbers, logos or watermarks anywhere in the image.`;
  }
  const style = STYLE_PROMPTS[r.style] || STYLE_PROMPTS.illustration;
  const where = r.kind === 'brief' || r.kind === 'social' ? `${r.name}'s social media post` : `${r.name}'s blog`;
  return `${style}. Subject: ${r.prompt || r.headline}. Made for ${where}. Color palette built around the brand colors ${r.brand.primary} and ${r.brand.secondary}, with neutral tones. Variation ${r.seed}.${r.cropSafe ? ' Keep the main subject in the centre with background to spare on every side, so the image can be cropped.' : ''} No words, letters, numbers, logos or watermarks anywhere in the image.`;
}

const IMG_PROVIDER: Record<string, string> = { openrouter: 'openrouter', openai: 'OpenAI', xai: 'SpaceX' };
/** The provider loop only: the model's image as it came back, uncropped. Writes one ai_calls row per provider asked,
 *  answered or not; a provider that is skipped (cooldown, breaker) was not asked and writes none. */
export async function generatePhotoRaw(r: ImageReq): Promise<Buffer> {
  const prompt = imagePrompt(r);
  const providers: [string, () => Promise<Generated>][] = [];
  // Keep every configured route so account cooldowns can be distinguished from transient breaker skips.
  if (env.openrouterKey) providers.push(['openrouter', () => openrouterImage(prompt, r.w, r.h)]);
  if (env.openaiKey) providers.push(['openai', () => openaiImage(prompt, r.w, r.h)]);
  if (env.xaiKey) providers.push(['xai', () => xaiImage(prompt, r.w, r.h)]);
  let raw: Buffer | null = null; let last: any = null; let accountBlocked = 0;
  for (const [index, [name, run]] of providers.entries()) {
    if ((name === 'openrouter' && openrouterDown()) || (imgDown.get(name) || 0) > Date.now()) { accountBlocked++; continue; }
    // The OpenRouter breaker is transient, and only skips its route when an alternative is configured.
    if (name === 'openrouter' && openrouterTripped() && (env.openaiKey || env.xaiKey)) continue;
    const model = name === 'openrouter' ? openrouterImageModel() : name === 'openai' ? openaiImageModel() : process.env.XAI_IMAGE_MODEL || 'grok-imagine-image';
    const t0 = Date.now(); const row = { businessId: r.bid, task: 'image', purpose: `image.${r.kind || 'images'}`, model, provider: IMG_PROVIDER[name] };
    try { const out = await run(); raw = out.buf; recordAiCall({ ...row, ...out.usage, latencyMs: Date.now() - t0, ok: true }); if (name === 'openrouter') noteOpenrouterOutcome(); break; } catch (e: any) {
      last = e;
      recordAiCall({ ...row, ...e?.billed, latencyMs: Date.now() - t0, ok: false, error: e });
      await reportFailure(e, { source: 'image', operation: 'image.generate', businessId: r.bid, provider: name, model, retrying: providers.slice(index + 1).some(([next]) => !(next === 'openrouter' && (openrouterDown() || openrouterTripped() && (env.openaiKey || env.xaiKey))) && (imgDown.get(next) || 0) <= Date.now()), degraded: !r.modelRequired });
      console.warn('[images]', e?.message);
      if (name === 'openrouter') noteOpenrouterOutcome(e);
      // OpenRouter is one account for text and images: its account failures use the shared OpenRouter cooldown.
      if (e?.account) { accountBlocked++; if (name === 'openrouter') markOpenrouterDown(String(e?.message || '')); else imgDown.set(name, Date.now() + 10 * 60e3); }
    }
  }
  if (!raw) {
    if (providers.length && accountBlocked === providers.length) {
      const blocked = new RadarError('Image generation is temporarily unavailable. Your previous image is kept. Please contact support.', 503, 'image_unavailable');
      // The provider failure behind it was already reported; carrying it keeps the caller's report from alerting twice.
      if (last) Object.defineProperty(blocked, 'cause', { value: last, enumerable: false });
      throw blocked;
    }
    throw last || new Error('no image provider available');
  }
  return raw;
}
// What the child process does with the decoded picture (the process itself is ./untrustedImage.ts): the centred crop,
// scaled to fill o.w×o.h, answered as a PNG. The size is read from the decoded image, which the decoder has already
// turned upright when the file says the camera was held on its side.
const CROP = `
    const c = createCanvas(o.w, o.h); const ctx = c.getContext('2d');
    const s = Math.max(o.w / img.width, o.h / img.height); const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, (o.w - dw) / 2, (o.h - dh) / 2, dw, dh);
    reply({}, c.toBuffer('image/png'));
`;
/** How long one decode and crop may take before its process is stopped, and the most it may answer with (as covers). */
const CROP_LIMITS = { timeoutMs: 20_000, maxOutput: 32 * 1024 * 1024 };
/** The picture is why there is no crop. The message is one of the fixed texts below: nothing from the file is in it. */
const refusedPicture = (why: string) => new Error(`The image model's picture was refused: ${why}`);

/** Cover-crop to exactly w×h (a centred crop, scaled to fill), as a PNG.
 *  `raw` is an image provider's answer and is never decoded in this process: the decoder ends the process on some
 *  malformed files, renders SVG, and accepts a file that was cut short.
 *  Checked from the bytes first, before any decode: a complete PNG, JPEG or WebP, not animated, with a positive size
 *  within the shared pixel limits. The decode and the draw then run in a child process, one picture at a time, and
 *  the answer must be a complete PNG of exactly w×h.
 *  Rejects with a plain Error (never a RadarError) when the picture is refused at any of those steps, and when the
 *  decoder itself could not run. Nothing falls back to decoding here; the callers decide between the brand template
 *  and failing the request. */
export async function coverCrop(raw: Buffer, w: number, h: number): Promise<Buffer> {
  const probe = probeImage(raw);
  if (!probe) throw refusedPicture('it is not a PNG, JPEG or WebP');
  if (!probe.complete) throw refusedPicture('the file is cut short');
  if (probe.animated) throw refusedPicture('it is animated');
  if (!(probe.width > 0 && probe.height > 0)) throw refusedPicture('it has no size');
  // Before any decode: the decoder allocates the whole bitmap on load, so a small file declaring a huge size is stopped here.
  if (overPixelLimits(probe)) throw refusedPicture('it is larger than the decoder is given');
  const { data: png } = await decodeInChild(raw, CROP, { w, h }, CROP_LIMITS)
    .catch(error => { throw error instanceof ImageRefused ? refusedPicture(`the decoder could not read it (${error.reason})`) : error; });
  const made = probeImage(png);
  if (!made || made.type !== 'image/png' || !made.complete || made.width !== w || made.height !== h) throw refusedPicture('the decoder did not answer with the crop');
  return png;
}
export async function generatePhoto(r: ImageReq): Promise<Buffer> { return coverCrop(await generatePhotoRaw(r), r.w, r.h); }

/** Where a file's picture comes from when the caller already has it: one raw model image shared by a social pack
 *  (cropped here to this file's size), or 'template' when that one generation failed. */
export type ImageSource = { raw: Buffer } | 'template';

export interface RenderedImage { url: string; bytes: number; type: string;
  /** A model style was asked for and the brand template was stored instead. */
  placeholder?: ImageIssueReason }
/** Render or generate a visual and store it. Returns the public URL plus the stored file's size and type (social posting
 *  checks them against each platform's limits without fetching the file). With `from`, no image model is asked: the
 *  file is cut from the shared image, or is the brand template. An explicit custom request (`modelRequired`) ignores it.
 *  `placeholder` is set only when no `from` was given, the style is a model style, and the template was stored. */
export async function renderImageFile(r: ImageReq, from?: ImageSource): Promise<RenderedImage> {
  let operation = 'image.render';
  try {
    let png: Buffer; let placeholder: ImageIssueReason | undefined;
    if (r.modelRequired) {
      operation = 'image.generate';
      if (!imageModelConfigured()) throw new RadarError('Image generation is unavailable right now. Please contact support to enable it.', 503, 'image_unavailable');
      png = await generatePhoto(r);
    } else if (from === 'template') png = renderTemplatePng(r);
    else if (from) {
      try { png = await coverCrop(from.raw, r.w, r.h); } catch (e: any) {
        await reportFailure(e, { source: 'image', operation: 'image.generate', businessId: r.bid, degraded: true });
        console.error('[images] generation failed, using template', e.message); png = renderTemplatePng(r);
      }
    } else if (MODEL_STYLES.includes(r.style) && imageModelConfigured()) {
      try { png = await generatePhoto(r); } catch (e: any) {
        // Includes decoding/cropping errors after an otherwise successful provider call.
        await reportFailure(e, { source: 'image', operation: 'image.generate', businessId: r.bid, degraded: true });
        console.error('[images] generation failed, using template', e.message); png = renderTemplatePng(r);
        // Every configured account is blocked, or a provider was asked and did not deliver.
        placeholder = e?.code === 'image_unavailable' ? 'unavailable' : 'failed';
      }
    } else {
      png = renderTemplatePng(r);
      // A model style with no image model to ask (no keys, or dev stubs).
      if (MODEL_STYLES.includes(r.style)) placeholder = 'unavailable';
    }
    operation = 'image.store';
    const url = await putObject(objectKey(r.bid, r.kind || 'images', 'png'), png, 'image/png');
    return { url, bytes: png.length, type: 'image/png', ...(placeholder ? { placeholder } : {}) };
  } catch (error) {
    await reportFailure(error, { source: 'image', operation, businessId: r.bid });
    throw error;
  }
}
/** Render or generate a visual and store it. Returns a public URL. */
export async function renderImage(r: ImageReq): Promise<string> { return (await renderImageFile(r)).url; }
