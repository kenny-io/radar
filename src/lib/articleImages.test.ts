import { describe, expect, it } from 'vitest';
import type { Article, ArticleBodyImage, Block, RealCover } from './types';
import { articleBodyImageAnchor, coverDirectionIsOwners, defaultCoverDirection, fallbackImageDirections, planArticleBodyImages, realCoverOf, withCover, withRealCover } from './articleImages';
import { defaultArticle } from '@/features/article/blocks';

const body: Block[] = [['p', 'Intro'], ['h2', 'First section'], ['p', 'One'], ['h3', 'Detail'], ['ul', ['More']], ['h2', 'Second section'], ['p', 'Two'], ['h2', 'Third section'], ['p', 'Three']];
const image = (heading: string, block: number, occurrence = 0): ArticleBodyImage => ({ id: heading, after: { heading, block, occurrence }, url: 'https://cdn.test/image.png', alt: 'An illustration', seed: 1, prompt: '' });

describe('article body image placement', () => {
  it('follows a whole section including subheadings/lists, and survives reordering', () => {
    expect(articleBodyImageAnchor(body, image(' FIRST   section ', 1))).toBe(4);
    const reordered: Block[] = [['h2', 'Second section'], ['p', 'Two'], ...body.slice(1, 5)];
    expect(articleBodyImageAnchor(reordered, image('First section', 1))).toBe(5);
  });
  it('distinguishes duplicate headings and falls back to an existing renamed h2 only', () => {
    const b: Block[] = [['h2', 'Same'], ['p', 'A'], ['h2', ' Same '], ['p', 'B']];
    expect(articleBodyImageAnchor(b, image('same', 2, 1))).toBe(3);
    expect(articleBodyImageAnchor([['h2', 'Renamed'], ['p', 'A']], image('Old', 0))).toBe(1);
    expect(articleBodyImageAnchor([['p', 'A']], image('Deleted', 0))).toBeNull();
    expect(articleBodyImageAnchor([['h2', 'Empty']], image('Empty', 0))).toBeNull();
  });
  it('rejects invalid fallback anchors and does not attach headingless media to a heading', () => {
    for (const block of [-1, 99, 1.5]) expect(articleBodyImageAnchor(body, image('', block))).toBeNull();
    expect(articleBodyImageAnchor(body, image('', 1))).toBeNull();
    expect(articleBodyImageAnchor(body, image('', 0))).toBe(0);
  });
  it('plans two or three distinct useful sections; one section and unsectioned prose remain supported', () => {
    expect(planArticleBodyImages(body, 1400).map(p => p.heading)).toEqual(['First section', 'Third section']);
    expect(planArticleBodyImages(body, 2200).map(p => p.heading)).toEqual(['First section', 'Second section', 'Third section']);
    expect(planArticleBodyImages([['h2', 'Only'], ['p', 'Text']], 2200)).toHaveLength(1);
    expect(planArticleBodyImages([['p', 'A'], ['p', 'B'], ['p', 'C'], ['p', 'D']], 900).map(p => p.after.block)).toEqual([1, 3]);
    expect(planArticleBodyImages([['p', ''], ['h2', 'Empty']], 900)).toEqual([]);
  });
});

describe('who wrote the cover direction', () => {
  const kw = 'tenant reviews';
  it('every new article starts with the default direction, which is nobody’s', () => {
    const fresh = defaultArticle({ id: 'e1', kw, title: 'How to read tenant reviews', relevance: '' });
    expect(fresh.img.prompt).toBe(defaultCoverDirection(kw));
    expect(coverDirectionIsOwners(fresh.img, kw)).toBe(false);
  });
  it('an article saved before the mark existed: only the exact default is Radar’s, an edited tail is the owner’s', () => {
    expect(coverDirectionIsOwners({ prompt: 'Calm, editorial image about tenant reviews' }, kw)).toBe(false);
    expect(coverDirectionIsOwners({ prompt: '  Calm, editorial image about tenant reviews  ' }, kw)).toBe(false);
    expect(coverDirectionIsOwners({ prompt: 'Calm, editorial image about tenant reviews in Dubai Marina' }, kw)).toBe(true);
    expect(coverDirectionIsOwners({ prompt: 'Calm, editorial image about another keyword' }, kw)).toBe(true);
    expect(coverDirectionIsOwners({ prompt: 'Sobha Sapphire at sunset' }, kw)).toBe(true);
  });
  it('a blank direction is nobody’s, whatever the mark says', () => {
    expect(coverDirectionIsOwners({ prompt: '' }, kw)).toBe(false);
    expect(coverDirectionIsOwners({ prompt: '   ', promptBy: 'owner' }, kw)).toBe(false);
  });
  it('the mark decides when it is present', () => {
    expect(coverDirectionIsOwners({ prompt: 'The exterior of a gated community', promptBy: 'radar' }, kw)).toBe(false);
    expect(coverDirectionIsOwners({ prompt: defaultCoverDirection(kw), promptBy: 'owner' }, kw)).toBe(true);
  });
});

describe('the cover after a render', () => {
  const img: Article['img'] = { style: 'illustration', seed: 4, prompt: 'A gated community', promptBy: 'radar', alt: 'Illustration of a gated community', url: '/old.png', urlKey: 'branded:1' };
  it('records a template fallback with its reason and time, and keeps every other field', () => {
    expect(withCover(img, { url: '/new.png', placeholder: 'unavailable' }, '2026-11-12T10:00:00.000Z')).toEqual({ ...img, url: '/new.png', urlKey: 'illustration:4', placeholder: { reason: 'unavailable', at: '2026-11-12T10:00:00.000Z' } });
  });
  it('a later render that is not a fallback removes the mark', () => {
    const marked = withCover(img, { url: '/template.png', placeholder: 'failed' });
    expect(marked.placeholder).toMatchObject({ reason: 'failed' });
    const real = withCover(marked, { url: '/real.png' });
    expect(real).toEqual({ ...img, url: '/real.png', urlKey: 'illustration:4' });
    expect('placeholder' in real).toBe(false);
  });
});

describe('a real picture as the cover', () => {
  const img: Article['img'] = { style: 'illustration', seed: 4, prompt: 'A tower on the marina', promptBy: 'radar', alt: 'Illustration of a tower on the marina', url: '/generated.png', urlKey: 'branded:1' };
  const found: Omit<RealCover, 'url'> = { by: 'radar', page: 'https://lived.ae/property/princess-tower', src: 'https://lived.ae/media/princess-tower.jpg', at: '2026-11-13T10:00:00.000Z', w: 1600, h: 2400, fit: 'backdrop', subject: 'Princess Tower' };
  const record: RealCover = { ...found, url: '/real.png' };

  it('an article saved before real pictures existed has no record', () => {
    expect(realCoverOf(img)).toBeNull();
    expect(realCoverOf({ ...img, real: null })).toBeNull();
  });
  it('the record applies while it describes the stored cover', () => {
    expect(realCoverOf({ url: '/real.png', real: record })).toBe(record);
  });
  it('the record stops applying when a writer that does not know about it changes the cover', () => {
    expect(realCoverOf({ url: '/generated-later.png', real: record })).toBeNull();
    expect(realCoverOf({ url: null, real: record })).toBeNull();
  });
  it('storing a real picture sets the url, the urlKey for the current style and seed, the record and the alt, and keeps the rest', () => {
    const next = withRealCover(img, '/real.png', found, 'Princess Tower');
    expect(next).toEqual({ ...img, url: '/real.png', urlKey: 'illustration:4', real: record, alt: 'Princess Tower' });
    expect(realCoverOf(next)).toEqual(record);
  });
  it('the record always describes the url that was stored, whatever was passed in with it', () => {
    const stale = { ...found, url: '/somewhere-else.png' } as Omit<RealCover, 'url'>;
    expect(withRealCover(img, '/real.png', stale).real?.url).toBe('/real.png');
  });
  it('a real picture is not a placeholder', () => {
    const marked = withCover(img, { url: '/template.png', placeholder: 'failed' });
    const next = withRealCover(marked, '/real.png', found, 'Princess Tower');
    expect('placeholder' in next).toBe(false);
  });
  it('an alt a person wrote is kept', () => {
    const owners: Article['img'] = { ...img, alt: 'The tower from the beach', altBy: 'owner' };
    const next = withRealCover(owners, '/real.png', found, 'Princess Tower');
    expect(next.alt).toBe('The tower from the beach');
    expect(next.altBy).toBe('owner');
  });
  it('without a new alt the old one stays, and an empty alt is still an alt', () => {
    expect(withRealCover(img, '/real.png', found).alt).toBe('Illustration of a tower on the marina');
    expect(withRealCover(img, '/real.png', found, '').alt).toBe('');
  });
  it('a second real picture replaces the first record', () => {
    const first = withRealCover(img, '/real.png', found, 'Princess Tower');
    const chosen: Omit<RealCover, 'url'> = { by: 'owner', page: null, src: 'https://lived.ae/media/lobby.jpg', at: '2026-11-13T11:00:00.000Z', w: 2000, h: 1200, fit: 'crop' };
    const second = withRealCover(first, '/real-2.png', chosen);
    expect(second.real).toEqual({ ...chosen, url: '/real-2.png' });
    expect(realCoverOf(second)?.by).toBe('owner');
  });
  it('a generated or template render removes the record, so the cover is no longer real', () => {
    const real = withRealCover(img, '/real.png', found, 'Princess Tower');
    const generated = withCover(real, { url: '/generated-2.png' });
    expect('real' in generated).toBe(false);
    expect(realCoverOf(generated)).toBeNull();
    expect(generated).toEqual({ ...img, alt: 'Princess Tower', url: '/generated-2.png', urlKey: 'illustration:4' });
    const template = withCover(real, { url: '/template.png', placeholder: 'unavailable' }, '2026-11-13T12:00:00.000Z');
    expect('real' in template).toBe(false);
    expect(template.placeholder).toEqual({ reason: 'unavailable', at: '2026-11-13T12:00:00.000Z' });
  });
  it('the mark a person left by switching back survives later renders', () => {
    const switched: Article['img'] = { ...img, noReal: true };
    expect(withCover(switched, { url: '/generated-2.png' }).noReal).toBe(true);
  });
});

describe('directions built without a model', () => {
  const article: Block[] = [
    ['p', 'Wasl 611 is a staff accommodation community in Al Warsan. Tenants rate it for its location.'], ['p', 'This guide covers what residents say.'],
    ['h2', 'What tenants say about maintenance?'], ['p', 'Repairs are logged at the gate office. Most are handled within the week.'],
    ['h2', 'Getting to work'], ['p', 'Buses leave from the main entrance every morning.'],
    ['h2', 'What to check first'], ['p', 'Walk the corridor and look at the shared kitchen before you sign.'],
  ];
  const title = 'Wasl 611 Reviews: Tenant Ratings and What to Check First.';
  it('the cover names the article and leads with its opening, and nothing claims a subject', () => {
    const d = fallbackImageDirections(title, article, planArticleBodyImages(article, 2200));
    expect(d.subject).toBeNull();
    expect(d.cover.prompt).toBe('A literal, realistic scene showing the subject of an article titled Wasl 611 Reviews: Tenant Ratings and What to Check First. Wasl 611 is a staff accommodation community in Al Warsan. Tenants rate it for its location. This guide covers what residents say.');
    expect(d.cover.alt).toBe('Illustration for Wasl 611 Reviews: Tenant Ratings and What to Check First');
  });
  it('each section gets its own heading and its own text, so no two directions are the same', () => {
    const plans = planArticleBodyImages(article, 2200);
    const d = fallbackImageDirections(title, article, plans);
    expect(d.sections).toHaveLength(3);
    expect(d.sections[0].prompt).toBe('A literal, realistic scene showing What tenants say about maintenance, in an article titled Wasl 611 Reviews: Tenant Ratings and What to Check First. Repairs are logged at the gate office. Most are handled within the week.');
    expect(d.sections[1].prompt).toContain('showing Getting to work,');
    expect(d.sections[1].prompt).toContain('Buses leave from the main entrance every morning.');
    expect(d.sections[2].prompt).toContain('Walk the corridor and look at the shared kitchen before you sign.');
    expect(d.sections.map(s => s.alt)).toEqual(['Illustration of What tenants say about maintenance', 'Illustration of Getting to work', 'Illustration of What to check first']);
    expect(new Set([d.cover.prompt, ...d.sections.map(s => s.prompt)]).size).toBe(4);
  });
  it('keeps whole sentences within the limit, and cuts one over-long sentence at a word', () => {
    const long = 'word '.repeat(80).trim() + '.';
    const body: Block[] = [['h2', 'Long section'], ['p', `Short opening sentence. ${long}`], ['h2', 'One sentence'], ['p', long]];
    const d = fallbackImageDirections('Title', body, planArticleBodyImages(body, 900));
    expect(d.sections[0].prompt).toBe('A literal, realistic scene showing Long section, in an article titled Title. Short opening sentence.');
    const tail = d.sections[1].prompt.split('titled Title. ')[1];
    expect(tail.length).toBeLessThanOrEqual(240);
    expect(tail).toMatch(/^(word )+word$/);
  });
  it('prose without headings still gets a direction per image, from the text itself', () => {
    const body: Block[] = [['p', 'First point about the lease.'], ['p', 'Second point about the deposit.']];
    const d = fallbackImageDirections('Renting basics', body, planArticleBodyImages(body, 900));
    expect(d.cover.prompt).toContain('First point about the lease.');
    expect(d.sections.map(s => s.prompt)).toEqual([
      'A literal, realistic scene showing Renting basics, in an article titled Renting basics. First point about the lease.',
      'A literal, realistic scene showing Renting basics, in an article titled Renting basics. Second point about the deposit.',
    ]);
    expect(d.sections[0].alt).toBe('Illustration of First point about the lease');
  });
  it('an article that opens with a heading takes its cover lead from the first text there is', () => {
    const body: Block[] = [['h2', 'Start here'], ['p', 'The first real paragraph.']];
    expect(fallbackImageDirections('Title', body, []).cover.prompt).toBe('A literal, realistic scene showing the subject of an article titled Title. The first real paragraph.');
    expect(fallbackImageDirections('Title', [], []).cover.prompt).toBe('A literal, realistic scene showing the subject of an article titled Title.');
  });
});
