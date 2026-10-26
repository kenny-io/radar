import { describe, expect, it } from 'vitest';
import { IMG_COUNTS, imageSettingsOf, imgCount } from './imageOptions';

describe('image count: exactly 1, 2, 3 or 4', () => {
  it('offers 1–4', () => expect(IMG_COUNTS).toEqual([1, 2, 3, 4]));
  it('keeps a saved count and clamps old or bad ones', () => {
    expect([1, 2, 3, 4].map(n => imgCount(n))).toEqual([1, 2, 3, 4]);
    expect(imgCount(5)).toBe(4); expect(imgCount(0)).toBe(1); expect(imgCount(NaN)).toBe(1);
  });
  it('maps settings saved as ranges: 1–3 → 1, 3–5 → 3', () => {
    expect(imageSettingsOf({ on: true, style: 'flat', range: 'few' })).toEqual({ on: true, style: 'flat', n: 1 });
    expect(imageSettingsOf({ on: true, style: 'flat', range: 'many' })).toEqual({ on: true, style: 'flat', n: 3 });
    expect(imageSettingsOf({ style: 'handdrawn', n: 2 })).toEqual({ on: true, style: 'handdrawn', n: 2 });
    expect(imageSettingsOf(null).n).toBe(1);
  });
});
