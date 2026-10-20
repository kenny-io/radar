import { describe, expect, it } from 'vitest';
import { cleanBrand, dropUnsupportedFigures } from './rules';

describe('company drafts never invent figures', () => {
  it('drops sentences with unsupported stats', () => {
    const t = 'We looked at 1,200 weeks of timesheets. Teams that review daily log 14% more hours. The fix is a daily review.';
    expect(dropUnsupportedFigures(t, 'Fieldnote turns your calendar into a timesheet')).toBe('The fix is a daily review.');
  });
  it('keeps figures that appear in the profile or thread', () => {
    const t = 'Utilization at 61% matches what we hear. A daily review helps.';
    expect(dropUnsupportedFigures(t, 'Studio utilization fell to 61% this year')).toBe(t);
  });
  it('keeps small counts and years', () => {
    const t = 'Three minutes a day, 2 steps, since 2024.';
    expect(dropUnsupportedFigures(t, '')).toBe(t);
  });
  it('strips links and fits X', () => {
    const out = cleanBrand('That is what we built Fieldnote for, see https://fieldnote.app #time ' + 'a'.repeat(300), { plat: 'x', name: 'Fieldnote', domain: 'fieldnote.app' }, '');
    expect(out).not.toMatch(/https|#time/);
    expect(out.length).toBeLessThanOrEqual(280);
  });
});
