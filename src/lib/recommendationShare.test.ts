import { describe, it, expect } from 'vitest';
import { dailyObservations, ownDomainCitation, summarizeRecommendationShare, weeklyRecommendationShare, type HistoryAnswer } from './recommendationShare';

describe('recommendation share', () => {
  it('excludes failed collections, reports per assistant, and counts cited answers once', () => {
    const summary = summarizeRecommendationShare([
      { engine: 'ChatGPT', status: 'mentioned', pos: 2, cites: ['https://a.product.com/a', 'https://product.com/b'] },
      { engine: 'ChatGPT', status: 'not-mentioned', cites: ['https://other.com'] },
      { engine: 'Claude', status: 'not-collected', cites: ['https://product.com'] },
      { engine: 'Gemini', status: 'mentioned', pos: 4, cites: [] },
    ], 'product.com');
    expect(summary).toMatchObject({ mentioned: 2, collected: 3, share: 2 / 3, averagePosition: 3, ownDomainCitations: 1, ownDomainCitationShare: 1 / 3 });
    expect(summary.byEngine.ChatGPT.share).toBe(.5); expect(summary.byEngine.Claude.share).toBeNull();
  });
  it('all missing and absent positions stay unavailable, not zero', () => {
    expect(summarizeRecommendationShare([{ engine: 'Claude', status: 'not-collected' }], 'product.com')).toMatchObject({ share: null, averagePosition: null, ownDomainCitationShare: null, collected: 0 });
    expect(summarizeRecommendationShare([{ engine: 'ChatGPT', status: 'mentioned', position: null }], 'product.com').averagePosition).toBeNull();
  });
  it('does not mistake hostile host suffixes and non-web URLs for own citations', () => {
    expect(ownDomainCitation('https://docs.product.com/a', 'www.product.com')).toBe(true);
    for (const url of ['https://product.com.attacker.com', 'https://fakeproduct.com', 'javascript:product.com', 'file://product.com/a', 'nonsense']) expect(ownDomainCitation(url, 'product.com')).toBe(false);
  });
});
const row = (overrides: Partial<HistoryAnswer> = {}): HistoryAnswer => ({ engine: 'ChatGPT', status: 'mentioned', promptId: 'p1', series: 'same', day: '2026-11-06', measuredAt: '2026-11-06T02:00:00Z', ...overrides });
describe('comparable weekly history', () => {
  it('uses completed UTC days, same series only, and latest success per cell/day', () => {
    const rows = [row(), row({ status: 'not-mentioned', measuredAt: '2026-11-06T05:00:00Z' }), row({ status: 'not-collected', measuredAt: '2026-11-06T06:00:00Z' }),
      row({ day: '2026-10-30', measuredAt: '2026-10-30T01:00:00Z' }),
      row({ series: 'different', status: 'not-mentioned' }), row({ day: '2026-11-08', measuredAt: '2026-11-08T01:00:00Z' })];
    const w = weeklyRecommendationShare(rows, 'same', 'product.com', new Date('2026-11-08T18:00:00Z'));
    expect(w.start).toBe('2026-11-01'); expect(w.end).toBe('2026-11-08');
    expect(w.current).toMatchObject({ collected: 1, mentioned: 0, share: 0 }); expect(w.previous.share).toBe(1); expect(w.delta).toBe(-1);
    expect(dailyObservations(rows, 'same')).toHaveLength(3);
  });
  it('does not borrow an older prompt series as last week or invent missing history', () => {
    const w = weeklyRecommendationShare([row(), row({ day: '2026-10-30', series: 'old' })], 'same', 'product.com', new Date('2026-11-08T00:00:00Z'));
    expect(w.previous.share).toBeNull(); expect(w.delta).toBeNull(); expect(w.days).toHaveLength(7);
  });
});
