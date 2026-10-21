// Image options (UPDATE-2026-10-21-image-options §1): five visual styles, an images on/off choice, and a count range.
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

export type ImgRange = 'few' | 'many';
export interface ImageSettings { on: boolean; style: StyleKey; range: ImgRange }
export const IMG_DEFAULT: ImageSettings = { on: true, style: 'editorial', range: 'few' };
export const IMG_RANGES: { v: ImgRange; min: number; max: number }[] = [{ v: 'few', min: 1, max: 3 }, { v: 'many', min: 3, max: 5 }];
/** Platform limits: X allows 4 images; LinkedIn, Facebook, Reddit, Quora and blog articles allow 5. */
export const imgMax = (k?: string | null) => (k === 'x' ? 4 : 5);
/** The exact count inside the range, seeded so the same seed always gives the same count. */
export function imgN(range: ImgRange, k: string | null | undefined, seed: number): number {
  const r = IMG_RANGES.find(x => x.v === range) || IMG_RANGES[0]; const max = Math.min(imgMax(k), r.max);
  return r.min + Math.floor((((seed * 9301 + 49297) % 233280) / 233280) * (max - r.min + 1));
}
/** Seed for image i of a set. */
export const imgSeed = (seed: number, i: number) => seed + i * 31;
export function imageSettingsOf(v: any): ImageSettings {
  return { on: v?.on !== false, style: styleK(v?.style), range: v?.range === 'many' ? 'many' : 'few' };
}
