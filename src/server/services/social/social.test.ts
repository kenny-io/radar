import { describe, expect, it } from 'vitest';
import type { Profile } from '@/lib/types';
import { check, enforce, stripLinks, capHashtags, fitTo, hasDisclosure } from './rules';
import { candidates, finish, pageFor, factByWords, type AngleOut } from './ideas-core';
import { stubPost } from './stubs';
import { isDue } from './auto';

const P: Profile = {
  domain: 'fieldnote.app',
  business: { name: 'Fieldnote', description: '', offerings: ['Calendar-based time tracking', 'Project budgets', 'One-click invoicing', 'Client portal'], industry: '', positioning: '', differentiators: ['Tracks time from your calendar, no timers', 'Invoices straight from tracked hours', 'Flat pricing with no per-seat fees'] },
  audience: { segments: ['Freelance designers'], buyers: [], needs: ['Bill accurately without micromanaging', 'Spend less time on admin', 'Know which projects are profitable'], competitors: ['Tallyhour', 'Billable', 'Hourwise'] },
  keywords: { list: [
    { kw: 'calendar time tracking', intent: 'Commercial', vol: 720, kd: 18, src: 'site', priority: true },
    { kw: 'time tracking for designers', intent: 'Commercial', vol: 3600, kd: 47, src: 'site', priority: true },
    { kw: 'freelance design rates', intent: 'Informational', vol: 6600, kd: 30, src: 'site', priority: false },
  ] },
  brand: { logo: null, primary: '#1F4D3A', secondary: '#F2B544', voice: '', language: 'English (US)', markets: [] },
};

describe('rules', () => {
  it('reddit: strips links and always discloses', () => {
    const t = enforce('reddit', 'Title: x\n\nSee https://fieldnote.app/blog and [our guide](https://x.com/a).', P);
    expect(t).not.toMatch(/https?:|www\./);
    expect(hasDisclosure(t, 'Fieldnote')).toBe(true);
    expect(stripLinks('a www.foo.com/b c')).toBe('a c');
  });
  it('x: ≤ 280', () => { const t = enforce('x', 'word '.repeat(100), P); expect(t.length).toBeLessThanOrEqual(280); expect(fitTo('a. '.repeat(200), 280).length).toBeLessThanOrEqual(280); });
  it('linkedin: ≤ 2 hashtags', () => { expect(capHashtags('hi #a #b #c\n#d', 2)).toBe('hi #a #b'); });
  it('quora: Q:/Short answer and disclosure when the product is named', () => {
    const c = check('quora', 'Use Fieldnote.', P); expect(c.ok).toBe(false);
    const t = enforce('quora', 'Short answer: use Fieldnote.', P, { sourceLabel: 'How to bill' });
    expect(t.startsWith('Q: How to bill?')).toBe(true); expect(hasDisclosure(t, 'Fieldnote')).toBe(true);
  });
  it('competitors are never promoted', () => {
    const t = enforce('facebook', 'Try Tallyhour for this. We help too.', P);
    expect(t).toBe('We help too.');
  });
  it('stubs follow every rule', () => {
    for (const k of ['linkedin', 'x', 'facebook', 'reddit', 'quora'] as const) for (const v of [0, 1]) {
      const t = enforce(k, stubPost(k, 'Why most freelancers undercharge in their first year', P, v), P, { sourceLabel: 'Why most freelancers undercharge' });
      expect(check(k, t, P, { sourceLabel: 'x' }).problems).toEqual([]);
    }
  });
});

describe('analyzeIdeas core (02-system §8.3)', () => {
  const queries = [['time tracking for designers', 412, 18200, 9.4], ['freelance invoice template', 388, 9900, 6.1], ['calendar time tracking', 301, 4100, 3.2], ['scope creep', 122, 9800, 11.6], ['fieldnote app', 540, 1210, 1.1], ['project budget template', 29, 2600, 18.3]].map(q => ({ q: q[0] as string, clicks: q[1] as number, impr: q[2] as number, ctr: (q[1] as number) / (q[2] as number), pos: q[3] as number }));
  const pages = [{ path: '/blog/scope-creep', title: 'Scope creep: a field guide', impr: 9800 }, { path: '/blog/calendar-tracking', title: 'Why we track time from your calendar', impr: 6900 }, { path: '/blog/invoice-template', title: 'Free invoice template for freelancers', impr: 14000 }];
  const cs = candidates({ profile: P, gscOn: true, queries, pages, measured: {} });
  it('scores, why and metric lines match the spec', () => {
    const t = cs.find(c => c.text === 'time tracking for designers')!;
    expect(t.metric).toBe('“time tracking for designers” · position 9.4 · 18.2k impressions');
    expect(t.why).toBe('Bottom of page one, where few people scroll.');
    expect(t.score).toBeCloseTo(18200 * 1.6 / (9.4 - 6));
    expect(t.page).toBe('/blog/calendar-tracking');
    const s = cs.find(c => c.text === 'scope creep')!; expect(s.why).toBe('Just off page one. Shares and links can lift it.'); expect(s.page).toBe('/blog/scope-creep');
    const pb = cs.find(c => c.text === 'project budget template')!; expect(pb.why).toBe('You rank without a page written for it.'); expect(pb.page).toBeNull();
    const fi = cs.find(c => c.text === 'freelance invoice template')!; expect(fi.why).toBe('On page one, but only 3.9% of searchers click.'); expect(fi.score).toBeCloseTo(9900 * 0.12);
    expect(cs.find(c => c.text === 'fieldnote app')).toBeUndefined(); // branded
    expect(cs.find(c => c.text === 'calendar time tracking')!.why).toBe('On page one, but only 7.3% of searchers click.');
    expect(cs.filter(c => c.kind === 'keyword').map(c => c.text)).toEqual(['freelance design rates']); // others covered by queries
    const kw = cs.find(c => c.text === 'freelance design rates')!;
    expect(kw.metric).toBe('“freelance design rates” · 6,600 searches a month · not ranking');
    expect(kw.why).toBe('Searchers want practical advice.');
    expect(kw.score).toBeCloseTo(6600 * 0.45);
  });
  it('no-GSC footer branch: no "not ranking", keyword ideas only', () => {
    const c2 = candidates({ profile: P, gscOn: false, queries: [], pages: [], measured: {} });
    expect(c2.every(c => c.kind === 'keyword' && !c.metric.includes('not ranking'))).toBe(true);
    const cal = c2.find(c => c.text === 'calendar time tracking')!; expect(cal.why).toBe('Searchers are close to choosing a tool. Few sites compete for it.');
    const d = c2.find(c => c.text === 'time tracking for designers')!; expect(d.why).toBe('Searchers are close to choosing a tool. Competitive in search.');
  });
  it('fallback angle for priority keywords, skip others, dedupe, sort', () => {
    const c2 = candidates({ profile: P, gscOn: false, queries: [], pages: [], measured: {} });
    const ideas = finish(P, c2, new Map<string, AngleOut>());
    expect(ideas.map(i => i.t)).toEqual(['“time tracking for designers”: what freelance designers get wrong', '“calendar time tracking”: what freelance designers get wrong']);
    expect(ideas[1].tie).toBe('Tracks time from your calendar, no timers');
  });
  it('page and fact matching', () => {
    expect(pageFor('scope creep', pages)?.path).toBe('/blog/scope-creep');
    expect(pageFor('raise freelance rates', pages)).toBeNull();
    expect(factByWords(P, 'project profitability')?.text).toMatch(/project/i);
    expect(factByWords(P, 'raise freelance rates')).toBeNull();
  });
  it('auto schedule: daily / custom weekdays in the business timezone, 1h window', () => {
    const a = { on: true, freq: 'custom' as const, days: ['Mon'], platforms: ['x' as const], style: 'branded' as const, time: '08:00' };
    expect(isDue(a, 'America/New_York', new Date('2026-10-19T12:10:00Z')).due).toBe(true); // Mon 08:10 ET
    expect(isDue(a, 'America/New_York', new Date('2026-10-20T12:10:00Z')).due).toBe(false); // Tue
    expect(isDue({ ...a, freq: 'daily' }, 'America/New_York', new Date('2026-10-20T12:10:00Z')).due).toBe(true);
    expect(isDue({ ...a, freq: 'daily' }, 'America/New_York', new Date('2026-10-20T11:50:00Z')).due).toBe(false);
  });
});
