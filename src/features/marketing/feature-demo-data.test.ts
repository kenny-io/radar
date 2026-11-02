import { describe, expect, it } from 'vitest';
import { BRIEF_REPLIES, SOCIAL_POSTS, performancePath, performanceSeries } from './feature-demo-data';

describe('illustrative feature demo behavior', () => {
  it('keeps personal Reddit mentions disclosed and all reply samples free of links', () => {
    expect(BRIEF_REPLIES[1]).toMatch(/^I work on Fieldnote, so I’m biased/);
    for (const text of BRIEF_REPLIES) expect(text).not.toMatch(/https?:|www\./);
    expect(BRIEF_REPLIES[0]).not.toContain('Fieldnote');
  });
  it('fits platform text limits and discloses the product connection in the Reddit sample', () => {
    for (const post of SOCIAL_POSTS) {
      if (post.limit) expect(post.text.length).toBeLessThanOrEqual(post.limit);
      expect(post.ratio).toBeGreaterThan(1);
    }
    expect(SOCIAL_POSTS.find(post => post.name === 'Reddit')?.text).toMatch(/^Disclosure: I work on/);
    expect(SOCIAL_POSTS.filter(post => post.limit).map(post => post.name)).toEqual(['LinkedIn', 'X']);
  });
  it('prerenders seeded chart data consistently across browser time zones', () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = 'Pacific/Honolulu'; const west = performanceSeries();
      process.env.TZ = 'Pacific/Auckland'; const east = performanceSeries();
      expect(west).toEqual(east);
      expect(west.every(series => series.length === 28 && series.every(Number.isFinite))).toBe(true);
    } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
  });
  it('inverts average position so a better ranking appears higher, with a safe flat-series path', () => {
    expect(performancePath([20, 10], true)).toBe('M0.0 132.0 L520.0 12.0');
    expect(performancePath([10, 20])).toBe('M0.0 132.0 L520.0 12.0');
    expect(performancePath([3, 3])).not.toMatch(/NaN|Infinity/);
  });
});
