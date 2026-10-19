import { describe, it, expect } from 'vitest';
import { buildPlan } from './plan';

const profile: any = {
  business: { name: 'Thally', industry: 'Developer tools', description: 'Docs that stay in sync', offerings: ['Thally Track: impact analysis on your last five merged PRs'], differentiators: [] },
  audience: { segments: ['Developer experience leads'], buyers: ['Head of developer experience'], needs: ['Know which docs, website and help-center pages are wrong after a merge, without digging through tickets and diffs'], competitors: ['Mintlify', 'GitBook'] },
  keywords: { list: [{ kw: 'keep docs in sync with code', priority: true }, { kw: 'what is llms.txt' }, { kw: 'a very long keyword phrase that nobody would ever type into a search box', priority: true }] },
};

describe('buildPlan queries', () => {
  const plan = buildPlan(profile);
  it('uses short keyword phrases and competitor alternatives, never profile sentences', () => {
    expect(plan.queries).toContain('keep docs in sync with code');
    expect(plan.queries).toContain('Mintlify alternative');
    expect(plan.queries.every(q => q.split(' ').length <= 6)).toBe(true);
    expect(plan.queries.some(q => q.includes('help-center'))).toBe(false);
  });
  it('falls back to the industry when nothing short is available', () => {
    const p = buildPlan({ ...profile, audience: { ...profile.audience, competitors: [] }, keywords: { list: [{ kw: 'a very long keyword phrase that nobody would ever type in', priority: true }] } });
    expect(p.queries).toEqual(['developer tools']);
  });
});

import { cleanTitle } from './sources/search';
describe('cleanTitle', () => {
  it('strips platform decorations from search result titles', () => {
    expect(cleanTitle('How do you keep engineering docs in sync with the code? : r/EngineeringManagers')).toBe('How do you keep engineering docs in sync with the code?');
    expect(cleanTitle('r/webdev on Reddit: Docs keep going stale')).toBe('Docs keep going stale');
    expect(cleanTitle('Why our API docs drift | LinkedIn')).toBe('Why our API docs drift');
  });
});

import { plugOrFallback } from './draft';
import { mergeStats } from './store';
describe('plug variant', () => {
  const p: any = { ...profile, brand: {}, domain: 'thally.io' };
  it('keeps a model plug that names the business', () => {
    expect(plugOrFallback('Map docs to anchors. Full disclosure, I work on Thally, which flags this per PR.', 'Map docs to anchors.', p, 'reddit')).toContain('Thally, which flags');
  });
  it('never returns the help text unchanged', () => {
    const out = plugOrFallback('Map docs to anchors.', 'Map docs to anchors.', p, 'reddit');
    expect(out).not.toBe('Map docs to anchors.');
    expect(out).toMatch(/I work on Thally/);
  });
});
describe('mergeStats', () => {
  it('sums reads per platform across scans', () => {
    expect(mergeStats({ hn: { read: 3 } }, { hn: { read: 2 }, x: { read: 0 } })).toEqual({ hn: { read: 5 }, x: { read: 0 } });
  });
});
