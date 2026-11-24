// Custom posts: packs whose text and media the user wrote or uploaded (source.kind 'custom', every post author 'user').
// Isomorphic helpers shared by the composer/PackView and the server (social.createCustom, social-image upload).
// Contract: .factory/custom-post-scheduling/architecture.md §4.2. Rules: no React, no server imports.
import type { Platform, SocialPack } from './types';

export const isCustomPack = (p: Pick<SocialPack, 'source'> | null | undefined): boolean => p?.source?.kind === 'custom';

/** Longest default name, in characters. */
export const POST_NAME_MAX = 64;

/** First non-blank line, whitespace collapsed, at most 64 characters cut at a word with '…'. Never rewrites the words. */
export function defaultPostName(text: string): string {
  const line = (text || '').split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).find(Boolean) || '';
  const chars = [...line];
  if (chars.length <= POST_NAME_MAX) return line;
  const head = chars.slice(0, POST_NAME_MAX - 1).join('');
  const cut = chars[POST_NAME_MAX - 1] === ' ' ? head.length : head.lastIndexOf(' ');
  return (cut > 0 ? head.slice(0, cut) : head).trimEnd() + '…';
}

/** Still image types a user may upload per platform (v1: JPEG, PNG and WebP stills; no GIF). YouTube takes video only. */
const STILLS = ['image/jpeg', 'image/png', 'image/webp'];
export const UPLOAD_IMAGE_TYPES: Record<Platform, string[]> = {
  x: STILLS, linkedin: STILLS, instagram: STILLS, tiktok: STILLS, facebook: STILLS, reddit: STILLS, quora: STILLS, youtube: [],
};

/** The type Radar stores for an upload: the input type when the platform takes it, otherwise JPEG (every platform takes JPEG). */
const STORED: Record<Platform, string[]> = {
  x: STILLS, linkedin: ['image/jpeg', 'image/png'], instagram: ['image/jpeg'], tiktok: ['image/jpeg', 'image/webp'],
  facebook: STILLS, reddit: STILLS, quora: STILLS, youtube: [],
};
export const storedImageType = (k: Platform, input: string): string => (STORED[k].includes(input) ? input : 'image/jpeg');
