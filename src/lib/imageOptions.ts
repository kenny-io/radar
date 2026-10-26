// Image options (UPDATE-2026-10-21-image-options §1): five visual styles, an images on/off choice, and a count of 1–4
// (owner request 2026-10-26: an exact count instead of the 1–3 / 3–5 ranges).
// Isomorphic: used by the UI and the server.

export type StyleKey = 'editorial' | 'flat' | 'render3d' | 'handdrawn' | 'photography';
export const STYLES: { k: StyleKey; l: string; d: string }[] = [
  { k: 'editorial', l: 'Editorial illustration', d: 'Conceptual artwork and visual metaphors.' },
  { k: 'flat', l: 'Flat / vector', d: 'Clean shapes, simple characters and minimal detail.' },
  { k: 'render3d', l: '3D render', d: 'Glossy, glass, clay or metallic objects with depth.' },
  { k: 'handdrawn', l: 'Hand-drawn', d: 'Sketches, ink drawings and textured artwork.' },
  { k: 'photography', l: 'Photography', d: 'Product shots, people, workspaces and real-world scenes.' },
];
/** Older saved keys map to the closest new style when read. */
const LEGACY: Record<string, StyleKey> = { branded: 'flat', infographic: 'flat', illustration: 'editorial', custom: 'editorial' };
export const styleK = (k?: string | null): StyleKey => (STYLES.some(s => s.k === k) ? (k as StyleKey) : (k && LEGACY[k]) || 'editorial');
export const styleL = (k?: string | null) => STYLES.find(s => s.k === styleK(k))!.l;

export type ImgCount = 1 | 2 | 3 | 4;
export const IMG_COUNTS: ImgCount[] = [1, 2, 3, 4];
export interface ImageSettings { on: boolean; style: StyleKey; n: ImgCount }
export const IMG_DEFAULT: ImageSettings = { on: true, style: 'editorial', n: 1 };
/** A saved count, clamped to 1–4. Settings saved before counts had a range instead: 1–3 → 1, 3–5 → 3. */
export function imgCount(n: unknown, range?: unknown): ImgCount {
  if (typeof n === 'number' && Number.isFinite(n)) return Math.min(4, Math.max(1, Math.round(n))) as ImgCount;
  return range === 'many' ? 3 : 1;
}
/** Seed for image i of a set. */
export const imgSeed = (seed: number, i: number) => seed + i * 31;
export function imageSettingsOf(v: any): ImageSettings {
  return { on: v?.on !== false, style: styleK(v?.style), n: imgCount(v?.n, v?.range) };
}
