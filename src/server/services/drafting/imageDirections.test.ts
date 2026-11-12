// The image-direction step: what the model is asked, how its answer is checked against the article slot by slot, and
// that the wrapper never fails an article (cache, fallback, budget). ai.run is replaced; everything else is real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Article, Block, CalendarEntry, Profile } from '@/lib/types';
const M = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../../ai', () => ({ ai: { run: M.run }, profileContext: () => '' }));

import { fallbackImageDirections, planArticleBodyImages } from '@/lib/articleImages';
import { DirectionsOut, cleanImageDirections, directionsKey, directionsPrompt, resolveImageDirections, type DirectionsAnswer } from './imageDirections';

const profile = { domain: 'lived.test', business: { name: 'Lived', industry: 'Property reviews' }, brand: { language: 'English', markets: ['AE'], primary: '#123456', secondary: '#abcdef' } } as unknown as Profile;
const e = { title: 'Wasl 611 Reviews: Tenant Ratings and What to Check First', kw: 'wasl 611 reviews', type: 'Guide' } as CalendarEntry;
const body: Block[] = [
  ['p', 'Wasl 611 is a gated staff accommodation community of three buildings in Al Warsan, Dubai, with 131 ensuite rooms.'],
  ['h2', 'What tenants say about maintenance'], ['p', 'Repairs are logged at the gate office and most are handled within the week.'],
  ['h2', 'Getting to work'], ['ul', ['Buses leave from the main entrance every morning', 'The metro is a short drive away']],
  ['h2', 'What to check first'], ['p', 'Walk the corridor and look at the shared kitchen before you sign.'],
];
const plans = planArticleBodyImages(body, 2200);
const ctx = { title: e.title, body, plans };
const spare = fallbackImageDirections(e.title, body, plans);
const good: DirectionsAnswer = {
  subject: 'Wasl 611', subjectKind: 'building',
  cover: { direction: 'The exterior of Wasl 611, a gated staff accommodation community of three buildings in Al Warsan, seen from outside the entrance gate.', alt: 'Illustration of Wasl 611 in Al Warsan' },
  sections: [
    { i: 0, direction: 'A maintenance worker repairing a door hinge in a plain residential corridor, with a toolbox open on the floor.', alt: 'Illustration of a repair in a corridor' },
    { i: 1, direction: 'A staff bus waiting at the main entrance of a residential community early in the morning, with residents boarding.', alt: 'Illustration of a morning bus at the entrance' },
    { i: 2, direction: 'A shared kitchen in staff accommodation, seen from the doorway, with a cooker, a sink and a long counter.', alt: 'Illustration of a shared kitchen' },
  ],
};
const article = (over: Partial<Article> = {}) => ({ body, brief: { angle: '', outline: [], words: 2200 }, img: { style: 'illustration', seed: 1, prompt: 'Calm, editorial image about wasl 611 reviews', alt: '', url: null }, ...over }) as Pick<Article, 'body' | 'brief' | 'img' | 'imageDirections'>;

beforeEach(() => { M.run.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('what the direction step is asked', () => {
  it('reads the title, the whole article and each planned section, in the business’s language', () => {
    const prompt = directionsPrompt({ profile, e, body, plans });
    expect(prompt).toContain('Business: Lived (Property reviews). Markets: AE.');
    expect(prompt).toContain('Article title: Wasl 611 Reviews: Tenant Ratings and What to Check First');
    expect(prompt).toContain('Primary keyword: wasl 611 reviews');
    expect(prompt).toContain('## What tenants say about maintenance\n\nRepairs are logged at the gate office');
    expect(prompt).toContain('- Buses leave from the main entrance every morning\n- The metro is a short drive away');
    expect(prompt).toContain('Section 0: What tenants say about maintenance — Repairs are logged at the gate office and most are handled within the week.');
    expect(prompt).toContain('Section 1: Getting to work — Buses leave from the main entrance every morning The metro is a short drive away');
    expect(prompt).toContain('Section 2: What to check first — Walk the corridor and look at the shared kitchen before you sign.');
    expect(prompt).toContain('One plain sentence in English, at most 140 characters');
    expect(prompt).toContain('Use only what the article states.');
  });
  it('names the owner’s cover only when the owner wrote one', () => {
    expect(directionsPrompt({ profile, e, body, plans })).not.toContain('The owner has chosen this cover');
    expect(directionsPrompt({ profile, e, body, plans, ownerDirection: '  Sobha Sapphire\n at sunset ' })).toContain('The owner has chosen this cover: Sobha Sapphire at sunset. Do not change it. Section pictures must be different scenes that fit with it.');
  });
  it('caps a very long article and long section text', () => {
    const long: Block[] = [['h2', 'Only section'], ['p', 'word '.repeat(4000)]];
    const prompt = directionsPrompt({ profile, e, body: long, plans: planArticleBodyImages(long, 900) });
    expect(prompt.split('ARTICLE\n')[1].split('\n\nPICTURES NEEDED')[0].length).toBe(12_000);
    expect(prompt.split('Section 0: Only section — ')[1].split('\n')[0].length).toBeLessThanOrEqual(500);
  });
});

describe('checking the answer against the article', () => {
  it('keeps concrete directions as written, with the subject the article names', () => {
    const clean = cleanImageDirections(good, ctx);
    expect(clean.replaced).toEqual([]);
    expect(clean.subject).toEqual({ name: 'Wasl 611', kind: 'building' });
    expect(clean.cover).toEqual({ prompt: good.cover.direction, alt: good.cover.alt });
    expect(clean.sections).toEqual(good.sections.map(s => ({ prompt: s.direction, alt: s.alt })));
  });
  it.each([
    ['asks for a caption', 'The entrance gate of the community with a caption underneath describing the address.', 'asks for writing'],
    ['asks for a sign with wording', 'The entrance gate of the community with a sign reading the name of the place.', 'asks for writing'],
    ['quotes wording', 'The entrance gate of the community under a banner, “Welcome home”, in daylight.', 'asks for writing'],
    ['asks for a chart', 'A bar chart of tenant ratings for the community, drawn on a clipboard on a desk.', 'asks for writing'],
    ['is symbolic', 'An abstract composition of circles that stands for the feeling of community living.', 'symbolic'],
    ['is a metaphor', 'A scale balancing a house and a coin as a metaphor for the choice tenants make.', 'symbolic'],
    ['is too short', 'A building at dusk.', 'too short'],
    ['states a number the article does not', 'A gated community of 33 low-rise blocks in Al Warsan seen from the main road.', 'number not in the article'],
  ])('replaces a direction that %s, and leaves the others alone', (_name, direction, why) => {
    const clean = cleanImageDirections({ ...good, sections: [good.sections[0], { ...good.sections[1], direction }, good.sections[2]] }, ctx);
    expect(clean.replaced).toEqual([{ slot: 'section 1', why }]);
    expect(clean.sections[1]).toEqual(spare.sections[1]);
    expect(clean.sections[0].prompt).toBe(good.sections[0].direction);
    expect(clean.sections[2].prompt).toBe(good.sections[2].direction);
    expect(clean.cover.prompt).toBe(good.cover.direction);
  });
  it('accepts numbers the article states, however they are punctuated', () => {
    const clean = cleanImageDirections({ ...good, cover: { ...good.cover, direction: 'The exterior of Wasl 611, a community with 131 rooms across three buildings in Al Warsan.' } }, ctx);
    expect(clean.replaced).toEqual([]);
    const thousands = cleanImageDirections({ ...good, subject: '', subjectKind: 'none', cover: { ...good.cover, direction: 'A warehouse holding 1200 parcels on tall shelves, seen from the loading door.' } }, { ...ctx, body: [...body, ['p', 'The depot holds 1,200 parcels.']] });
    expect(thousands.replaced).toEqual([]);
  });
  it('replaces a section that repeats the cover or an earlier section', () => {
    const clean = cleanImageDirections({ ...good, sections: [{ ...good.sections[0], direction: good.cover.direction.replace('seen from', 'viewed from') }, good.sections[1], { ...good.sections[2], direction: good.sections[1].direction + ' ' }] }, ctx);
    expect(clean.replaced).toEqual([{ slot: 'section 0', why: 'repeats another picture' }, { slot: 'section 2', why: 'repeats another picture' }]);
    expect(clean.sections[0]).toEqual(spare.sections[0]);
    expect(clean.sections[1].prompt).toBe(good.sections[1].direction);
    expect(clean.sections[2]).toEqual(spare.sections[2]);
  });
  it('places entries by their section number, ignores unknown and repeated numbers, and fills a missing section', () => {
    const clean = cleanImageDirections({ ...good, sections: [good.sections[2], { ...good.sections[0], i: 7 }, good.sections[0], { ...good.sections[1], i: 0 }] }, ctx);
    expect(clean.sections[0].prompt).toBe(good.sections[0].direction);
    expect(clean.sections[2].prompt).toBe(good.sections[2].direction);
    expect(clean.sections[1]).toEqual(spare.sections[1]);
    expect(clean.replaced).toEqual([{ slot: 'section 1', why: 'missing' }]);
  });
  it('drops a subject the article does not name, or one given with no kind', () => {
    expect(cleanImageDirections({ ...good, subject: 'Princess Tower' }, ctx).subject).toBeNull();
    expect(cleanImageDirections({ ...good, subjectKind: 'none' }, ctx).subject).toBeNull();
    expect(cleanImageDirections({ ...good, subject: '  wasl   611 ' }, ctx).subject).toEqual({ name: 'wasl 611', kind: 'building' });
    // With no subject, nothing is added to the cover.
    const anonymous = cleanImageDirections({ ...good, subject: 'Princess Tower', cover: { direction: 'A gated residential community seen from outside its entrance gate in daylight.', alt: 'Illustration of a gated community' } }, ctx);
    expect(anonymous.cover).toEqual({ prompt: 'A gated residential community seen from outside its entrance gate in daylight.', alt: 'Illustration of a gated community' });
  });
  it('names the subject in a cover that left it out, and in its alt text', () => {
    const clean = cleanImageDirections({ ...good, cover: { direction: 'A gated staff accommodation community of three buildings seen from outside the entrance gate.', alt: 'Illustration of a gated community' } }, ctx);
    expect(clean.cover.prompt).toBe('A gated staff accommodation community of three buildings seen from outside the entrance gate. The subject shown is Wasl 611.');
    expect(clean.cover.alt).toBe('Illustration of Wasl 611');
    // A cover that had to be rebuilt names it too.
    const rebuilt = cleanImageDirections({ ...good, cover: { direction: 'An abstract shape.', alt: '' } }, ctx);
    expect(rebuilt.replaced).toEqual([{ slot: 'cover', why: 'too short' }]);
    expect(rebuilt.cover.prompt).toContain('Wasl 611');
    expect(rebuilt.cover.alt).toContain('Wasl 611');
  });
  it('rebuilds an alt that says nothing, and keeps an alt within its limit', () => {
    const clean = cleanImageDirections({ ...good, subject: '', subjectKind: 'none', sections: [{ ...good.sections[0], alt: 'Image' }, { ...good.sections[1], alt: `Illustration of ${'a very long description '.repeat(12)}` }, good.sections[2]] }, ctx);
    expect(clean.replaced).toEqual([]);
    expect(clean.sections[0]).toEqual({ prompt: good.sections[0].direction, alt: spare.sections[0].alt });
    expect(clean.sections[1].alt.length).toBeLessThanOrEqual(200);
    expect(clean.sections[1].alt).toMatch(/^Illustration of a very long description/);
  });
});

describe('resolving directions for an article', () => {
  const answered = () => M.run.mockResolvedValue({ json: good });
  it('asks the utility purpose once with no retries, and returns the checked answer with its key', async () => {
    answered();
    const d = await resolveImageDirections('biz', profile, e, article());
    expect(M.run).toHaveBeenCalledTimes(1);
    const [task, input, opts] = M.run.mock.calls[0];
    expect(task).toBe('writing');
    expect(input).toMatchObject({ purpose: 'article.imageDirections', schema: DirectionsOut, maxTokens: 900, timeoutMs: 30_000, stubContext: { title: e.title, kw: e.kw, plans } });
    expect(input.prompt).not.toContain('The owner has chosen this cover');
    expect(opts).toEqual({ businessId: 'biz', retries: 0 });
    expect(d).toMatchObject({ key: directionsKey(e.title, body, 2200), source: 'ai', subject: { name: 'Wasl 611', kind: 'building' }, cover: { prompt: good.cover.direction } });
    expect(d.sections).toHaveLength(3);
    expect(Number.isNaN(Date.parse(d.at))).toBe(false);
  });
  it('tells the model about a cover the owner wrote, in either form the article can carry it', async () => {
    answered();
    await resolveImageDirections('biz', profile, e, article({ img: { ...article().img, prompt: 'Sobha Sapphire at sunset' } }));
    await resolveImageDirections('biz', profile, e, article({ img: { ...article().img, promptBy: 'owner' } }));
    await resolveImageDirections('biz', profile, e, article({ img: { ...article().img, prompt: 'A gated community', promptBy: 'radar' } }));
    expect(M.run.mock.calls.map(c => /The owner has chosen this cover: ([^.]+)\./.exec(c[1].prompt)?.[1] ?? null)).toEqual(['Sobha Sapphire at sunset', 'Calm, editorial image about wasl 611 reviews', null]);
  });
  it('reuses the cached set for the same title, body and length without a call', async () => {
    answered();
    const first = await resolveImageDirections('biz', profile, e, article());
    M.run.mockClear();
    expect(await resolveImageDirections('biz', profile, e, article({ imageDirections: first }))).toBe(first);
    expect(M.run).not.toHaveBeenCalled();
  });
  it('a changed title, body or length misses the cache, and `fresh` always asks', async () => {
    answered();
    const first = await resolveImageDirections('biz', profile, e, article());
    M.run.mockClear();
    await resolveImageDirections('biz', profile, { ...e, title: 'Another title about Wasl 611' }, article({ imageDirections: first }));
    await resolveImageDirections('biz', profile, e, article({ imageDirections: first, body: [...body, ['p', 'One more paragraph.']] }));
    await resolveImageDirections('biz', profile, e, article({ imageDirections: first, brief: { angle: '', outline: [], words: 1400 } }));
    await resolveImageDirections('biz', profile, e, article({ imageDirections: first }), { fresh: true });
    expect(M.run).toHaveBeenCalledTimes(4);
    expect(new Set([directionsKey('a', body, 900), directionsKey('b', body, 900), directionsKey('a', body, 1400), directionsKey('a', [], 900)]).size).toBe(4);
    expect(directionsKey('a', body, 900)).toMatch(/^[0-9a-f]{24}$/);
  });
  it('a failed step returns directions built from the title and sections, and they are never reused', async () => {
    M.run.mockRejectedValue(Object.assign(new Error('Radar couldn’t finish this. Try again.'), { code: 'ai_failed' }));
    const d = await resolveImageDirections('biz', profile, e, article());
    expect(d).toMatchObject({ source: 'fallback', subject: null, key: directionsKey(e.title, body, 2200), cover: spare.cover, sections: spare.sections });
    answered();
    const again = await resolveImageDirections('biz', profile, e, article({ imageDirections: d }));
    expect(M.run).toHaveBeenCalledTimes(2);
    expect(again.source).toBe('ai');
  });
  it('an answer with no usable slot counts as a failure, and an answer of the wrong shape does not throw', async () => {
    M.run.mockResolvedValue({ json: { subject: '', subjectKind: 'none', cover: { direction: 'Abstract shapes.', alt: '' }, sections: [] } });
    expect(await resolveImageDirections('biz', profile, e, article())).toMatchObject({ source: 'fallback', cover: spare.cover });
    M.run.mockResolvedValue({ json: { nothing: 'useful' } });
    expect(await resolveImageDirections('biz', profile, e, article())).toMatchObject({ source: 'fallback', sections: spare.sections });
    M.run.mockResolvedValue({ json: null });
    expect(await resolveImageDirections('biz', profile, e, article())).toMatchObject({ source: 'fallback' });
  });
  it('gives up at its budget and returns the built-in directions; the late answer and a late failure are both ignored', async () => {
    vi.useFakeTimers();
    for (const settle of [(done: any) => done({ json: good }), (_done: any, fail: any) => fail(new Error('late failure'))]) {
      let finish!: () => void;
      M.run.mockImplementation(() => new Promise((done, fail) => { finish = () => settle(done, fail); }));
      const pending = resolveImageDirections('biz', profile, e, article(), { budgetMs: 20_000 });
      await vi.advanceTimersByTimeAsync(19_999);
      let settled = false; void pending.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toMatchObject({ source: 'fallback', cover: spare.cover });
      finish(); await vi.advanceTimersByTimeAsync(0);
    }
  });
  it('an article with no text is not sent to the model', async () => {
    expect(await resolveImageDirections('biz', profile, e, article({ body: [] }))).toMatchObject({ source: 'fallback', sections: [] });
    expect(M.run).not.toHaveBeenCalled();
  });
});

describe('the dev stub', () => {
  const stub = () => (globalThis as any).__radarStubs.get('article.imageDirections') as (input: any, ctx: any) => any;
  it.each([[2200, 3], [1400, 2]])('answers %i words with %i sections that pass the same checks untouched', (words, count) => {
    const stubPlans = planArticleBodyImages(body, words);
    const answer = stub()({}, { title: e.title, kw: e.kw, plans: stubPlans });
    expect(DirectionsOut.safeParse(answer).success).toBe(true);
    expect(answer.sections).toHaveLength(count);
    const clean = cleanImageDirections(answer, { title: e.title, body, plans: stubPlans });
    expect(clean.replaced).toEqual([]);
    expect(clean.subject).toBeNull();
    expect(clean.cover.prompt).toContain('Wasl 611 Reviews');
    clean.sections.forEach((s, i) => expect(s.prompt).toContain(stubPlans[i].heading));
  });
  it('still passes for a quoted title and prose without headings', () => {
    const prose: Block[] = [['p', 'First point about the lease.'], ['p', 'Second point about the deposit.']];
    const prosePlans = planArticleBodyImages(prose, 900);
    const title = 'What “fair wear and tear” means for tenants?';
    const clean = cleanImageDirections(stub()({}, { title, kw: 'fair wear and tear', plans: prosePlans }), { title, body: prose, plans: prosePlans });
    expect(clean.replaced).toEqual([]);
  });
});
