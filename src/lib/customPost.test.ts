import { describe, expect, it } from 'vitest';
import { UPLOAD_IMAGE_TYPES, defaultPostName, isCustomPack, storedImageType } from './customPost';

describe('defaultPostName', () => {
  it('takes the first non-blank line with whitespace collapsed', () => {
    expect(defaultPostName('\n\n  Launch   day  is here \nSecond line')).toBe('Launch day is here');
    expect(defaultPostName('   ')).toBe('');
  });
  it('cuts at a word to at most 64 characters with an ellipsis', () => {
    const name = defaultPostName('We rebuilt the onboarding flow from scratch and here is what we learned along the way');
    expect([...name].length).toBeLessThanOrEqual(64);
    expect(name).toBe('We rebuilt the onboarding flow from scratch and here is what we…');
  });
  it('keeps hyphens and URLs as written', () => {
    expect(defaultPostName('Self-serve docs - live at https://thally.io/docs-v2')).toBe('Self-serve docs - live at https://thally.io/docs-v2');
  });
  it('keeps a short line exactly as written', () => {
    expect(defaultPostName('日本語のポスト 🎉')).toBe('日本語のポスト 🎉');
  });
});

describe('upload types', () => {
  it('accepts JPEG, PNG and WebP stills everywhere but YouTube, and never GIF', () => {
    for (const [k, types] of Object.entries(UPLOAD_IMAGE_TYPES)) {
      expect(types.includes('image/gif')).toBe(false);
      expect(types).toEqual(k === 'youtube' ? [] : ['image/jpeg', 'image/png', 'image/webp']);
    }
  });
  it('stores each platform’s accepted type, else JPEG', () => {
    const m = (k: Parameters<typeof storedImageType>[0]) => ['image/jpeg', 'image/png', 'image/webp'].map(t => storedImageType(k, t));
    expect(m('x')).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(m('linkedin')).toEqual(['image/jpeg', 'image/png', 'image/jpeg']);
    expect(m('instagram')).toEqual(['image/jpeg', 'image/jpeg', 'image/jpeg']);
    expect(m('tiktok')).toEqual(['image/jpeg', 'image/jpeg', 'image/webp']);
    expect(m('facebook')).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });
  it('recognises custom packs by source kind', () => {
    expect(isCustomPack({ source: { kind: 'custom', label: 'x' } })).toBe(true);
    expect(isCustomPack({ source: { kind: 'idea', label: 'x' } })).toBe(false);
    expect(isCustomPack(null)).toBe(false);
  });
});
