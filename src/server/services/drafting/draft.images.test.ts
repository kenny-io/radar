// What a draft does about its pictures: the cover direction it saves, whose direction it respects, the placeholder
// mark, and that missing body images never cost the draft. The model, the image service, body-image generation and
// the database are replaced; draftArticle and the direction step (prompt, checks, fallback) are real.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Article, CalendarEntry, Profile } from '@/lib/types';

const H = vi.hoisted(() => ({ run: vi.fn(), file: vi.fn(), body: vi.fn(), defaultStyle: 'illustration' as 'illustration' | 'branded' }));
vi.mock('../../db', () => {
  const rows: any = { where: () => rows, limit: async () => [], then: (resolve: any) => Promise.resolve([]).then(resolve) };
  return { db: { select: () => ({ from: () => rows }) }, schema: { crawlPages: { businessId: 'businessId' }, calendarEntries: {} } };
});
vi.mock('../../ai', () => ({ ai: { run: H.run }, profileContext: () => 'BUSINESS PROFILE' }));
vi.mock('../images', () => ({ renderImageFile: H.file, renderImage: vi.fn(), defaultArticleImageStyle: () => H.defaultStyle, MODEL_STYLES: ['editorial', 'flat', 'render3d', 'handdrawn', 'photography', 'illustration'] }));
vi.mock('./bodyImages', () => ({ generateArticleBodyImages: H.body }));
// This file is about generated covers. Its scripted article has a building as its subject, so without this every draft
// here would start a search of the business's site for a real picture (draft.realCover.test.ts covers that).
vi.mock('../realCover', async original => ({ ...(await original<typeof import('../realCover')>()), findSubjectPicture: vi.fn(async () => ({ picture: null, searched: false })), storeRealCover: vi.fn() }));
vi.mock('../gsc/metrics', () => ({ normKw: (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(), topQueries: async () => [] }));
vi.mock('../calendar/research', () => ({ tokens: (s: string) => s.toLowerCase().split(/\W+/).filter(word => word.length > 2) }));

import { defaultArticle } from '@/features/article/blocks';
import { fallbackImageDirections, planArticleBodyImages } from '@/lib/articleImages';
import { draftArticle } from './draft';

const profile = {
  domain: 'lived.test', business: { name: 'Lived', description: 'Tenant reviews', industry: 'Property', positioning: '', offerings: [], differentiators: [] },
  audience: { segments: ['Tenants'], buyers: [], needs: [], competitors: [] }, brand: { voice: 'Plain', language: 'English', markets: ['AE'], primary: '#123456', secondary: '#abcdef' }, keywords: { list: [] },
} as unknown as Profile;
const entry = { id: 'e_wasl', title: 'Wasl 611 Reviews: Tenant Ratings and What to Check First', kw: 'wasl 611 reviews', type: 'Guide', audience: 'Tenants', relevance: 'Tenants compare buildings', mode: 'new', url: null } as unknown as CalendarEntry;
const TEXT = [
  'Wasl 611 is a gated staff accommodation community of three buildings in Al Warsan, Dubai.',
  '## What tenants say about maintenance', 'Repairs are logged at the gate office and most are handled within the week.',
  '## What to check first', 'Walk the corridor and look at the shared kitchen before you sign.',
].join('\n\n');
const DEFAULT = 'Calm, editorial image about wasl 611 reviews';
const COVER = 'The exterior of Wasl 611, a gated staff accommodation community of three buildings in Al Warsan, seen from outside the entrance gate.';
const ANSWER = {
  subject: 'Wasl 611', subjectKind: 'building',
  cover: { direction: COVER, alt: 'Illustration of Wasl 611 in Al Warsan' },
  sections: [
    { i: 0, direction: 'A maintenance worker repairing a door hinge in a plain residential corridor, with a toolbox open on the floor.', alt: 'Illustration of a repair in a corridor' },
    { i: 1, direction: 'A shared kitchen in staff accommodation, seen from the doorway, with a cooker, a sink and a long counter.', alt: 'Illustration of a shared kitchen' },
  ],
};
let directions: () => Promise<any>;
let renders = 0;
beforeEach(() => {
  H.run.mockReset(); H.file.mockReset(); H.body.mockReset(); H.defaultStyle = 'illustration'; renders = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {});
  directions = async () => ({ json: ANSWER });
  H.run.mockImplementation(async (_task: string, input: any) => {
    if (input.purpose === 'article.research') throw new Error('no search in this test');
    if (input.purpose === 'article.draft') return { text: TEXT, json: null, citations: [] };
    if (input.purpose === 'article.meta') return { json: { seoTitle: 'Wasl 611 reviews', meta: 'What tenants say about Wasl 611.', alt: 'Alt text from the SEO step' } };
    if (input.purpose === 'article.imageDirections') return directions();
    throw new Error('unexpected purpose ' + input.purpose);
  });
  H.file.mockImplementation(async (r: any) => ({ url: `/api/files/biz/hero/${++renders}-${r.style}.png`, bytes: 10, type: 'image/png' }));
  H.body.mockImplementation(async (_ctx: any, _e: any, a: Article) => planArticleBodyImages(a.body, a.brief.words).map((plan, i) => ({ id: 'abi_' + i, after: plan.after, url: `/api/files/biz/article-body/${i}.png`, alt: 'alt', prompt: 'prompt', seed: 2 + i })));
});

const draft = (a0: Partial<Article> | null = null) => draftArticle({ businessId: 'biz', progress: vi.fn(async () => {}) } as any, entry, a0 ? ({ ...defaultArticle(entry), ...a0 } as Article) : null, profile, false, 'Lived');
const purposes = () => H.run.mock.calls.map(c => c[1].purpose);
/** A drafted article as it is stored, to redraft. */
const drafted = (img: Partial<Article['img']>, over: Partial<Article> = {}): Partial<Article> => ({ generated: true, body: [['p', 'Earlier text.']], seo: { title: 'Kept title', meta: 'Kept meta', slug: 'kept' }, img: { style: 'illustration', seed: 1, prompt: DEFAULT, alt: 'Earlier alt', url: '/api/files/biz/hero/old.png', urlKey: 'illustration:1', ...img }, ...over });

describe('a new draft', () => {
  it('saves a cover direction read from the article, names the subject in the alt, and asks for a literal picture', async () => {
    const a = await draft();
    expect(a.img).toMatchObject({ style: 'illustration', prompt: COVER, promptBy: 'radar', alt: 'Illustration of Wasl 611 in Al Warsan', url: '/api/files/biz/hero/1-illustration.png', urlKey: 'illustration:1' });
    expect(a.img.prompt).not.toBe(DEFAULT);
    expect('placeholder' in a.img).toBe(false);
    expect(H.file).toHaveBeenCalledTimes(1);
    expect(H.file.mock.calls[0][0]).toMatchObject({ bid: 'biz', kind: 'hero', w: 1200, h: 628, style: 'illustration', prompt: COVER, literal: true, modelRequired: false, headline: entry.title, seed: 1 });
    expect(a.imageDirections).toMatchObject({ source: 'ai', subject: { name: 'Wasl 611', kind: 'building' }, cover: { prompt: COVER } });
    expect(a.imageDirections!.sections.map(s => s.prompt)).toEqual(ANSWER.sections.map(s => s.direction));
    expect(a.generated).toBe(true); expect(a.bodyImages).toHaveLength(2); expect(a.bodyImagesIssue).toBeUndefined();
  });
  it('runs the direction step once, after the text is final and before the SEO step, on the written body', async () => {
    await draft();
    expect(purposes()).toEqual(['article.research', 'article.draft', 'article.imageDirections', 'article.meta']);
    const call = H.run.mock.calls.find(c => c[1].purpose === 'article.imageDirections')!;
    expect(call[1].prompt).toContain('Repairs are logged at the gate office');
    expect(call[1].prompt).toContain('Section 1: What to check first');
    expect(call[2]).toEqual({ businessId: 'biz', retries: 0 });
  });
  it('hands the same directions and the new cover to body-image generation', async () => {
    const a = await draft();
    const [, , given, , dir] = H.body.mock.calls[0];
    expect(dir).toEqual(a.imageDirections);
    expect(given.img).toMatchObject({ prompt: COVER, promptBy: 'radar' });
    expect(given.body).toEqual(a.body);
  });
  it('the direction step fails: the draft still completes, with directions built from the title and section text', async () => {
    directions = async () => { throw Object.assign(new Error('Radar couldn’t finish this. Try again.'), { code: 'ai_failed' }); };
    const a = await draft();
    const built = fallbackImageDirections(entry.title, a.body, planArticleBodyImages(a.body, 1400));
    expect(a.generated).toBe(true);
    expect(a.imageDirections).toMatchObject({ source: 'fallback', subject: null, cover: built.cover, sections: built.sections });
    expect(a.img).toMatchObject({ prompt: built.cover.prompt, promptBy: 'radar', alt: built.cover.alt });
    expect(a.img.prompt).toContain('Wasl 611 Reviews');
    expect(a.imageDirections!.sections[1].prompt).toContain('Walk the corridor and look at the shared kitchen before you sign.');
    expect(H.file.mock.calls[0][0]).toMatchObject({ prompt: built.cover.prompt, literal: true });
    expect(a.bodyImages).toHaveLength(2);
  });
  it('an entry made before image models were available is moved to the illustration style, from the direction as loaded', async () => {
    expect((await draft()).img.style).toBe('illustration'); // defaultArticle starts as `branded` with the default direction
    H.defaultStyle = 'branded';
    const template = await draft();
    expect(template.img).toMatchObject({ style: 'branded', prompt: COVER, promptBy: 'radar', urlKey: 'branded:1' });
    expect(H.file.mock.calls.at(-1)![0]).toMatchObject({ style: 'branded', modelRequired: false });
  });
});

describe('a cover direction the owner wrote', () => {
  it.each([
    ['marked as the owner’s', { prompt: 'Sobha Sapphire at sunset', promptBy: 'owner' as const }],
    ['typed before the mark existed', { prompt: 'Sobha Sapphire at sunset' }],
    ['the default sentence with an edited tail', { prompt: DEFAULT + ', seen from the canal' }],
  ])('%s is used as written, is not drawn as a literal scene, and is marked the owner’s', async (_name, img) => {
    const a = await draft({ img: { ...defaultArticle(entry).img, style: 'illustration', ...img } });
    expect(a.img.prompt).toBe(img.prompt);
    expect(a.img.promptBy).toBe('owner');
    expect(H.file.mock.calls[0][0]).toMatchObject({ prompt: img.prompt, literal: false });
    // The alt was empty, so the SEO step's alt is used; Radar's own cover alt is for Radar's own direction.
    expect(a.img.alt).toBe('Alt text from the SEO step');
    // The direction step is told about the owner's cover, and its sections still reach the body images.
    expect(H.run.mock.calls.find(c => c[1].purpose === 'article.imageDirections')![1].prompt).toContain(`The owner has chosen this cover: ${img.prompt}.`);
    expect(H.body.mock.calls[0][4].sections).toHaveLength(2);
  });
  it('a rewrite keeps the owner’s cover and direction without a render', async () => {
    const a = await draft(drafted({ prompt: 'Sobha Sapphire at sunset', promptBy: 'owner', alt: 'My alt', altBy: 'owner' }));
    expect(H.file).not.toHaveBeenCalled();
    expect(a.img).toEqual({ style: 'illustration', seed: 1, prompt: 'Sobha Sapphire at sunset', promptBy: 'owner', alt: 'My alt', altBy: 'owner', url: '/api/files/biz/hero/old.png', urlKey: 'illustration:1' });
  });
  it('a missing custom cover is never downgraded: the draft fails when it cannot be generated', async () => {
    H.file.mockRejectedValue(Object.assign(new Error('Image generation is unavailable right now.'), { code: 'image_unavailable' }));
    await expect(draft(drafted({ prompt: 'Sobha Sapphire at sunset', modelRequired: true, url: null, urlKey: null }))).rejects.toMatchObject({ code: 'image_unavailable' });
    expect(H.file.mock.calls[0][0]).toMatchObject({ modelRequired: true, literal: false, prompt: 'Sobha Sapphire at sunset' });
    expect(H.body).not.toHaveBeenCalled();
  });
});

describe('the placeholder mark', () => {
  it('a cover that fell back to the template is saved with the reason, and a later real cover removes it', async () => {
    H.file.mockImplementation(async () => ({ url: '/api/files/biz/hero/template.png', bytes: 10, type: 'image/png', placeholder: 'unavailable' }));
    const first = await draft();
    expect(first.img).toMatchObject({ url: '/api/files/biz/hero/template.png', urlKey: 'illustration:1', promptBy: 'radar' });
    expect(first.img.placeholder).toEqual({ reason: 'unavailable', at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) });

    H.file.mockReset(); H.file.mockImplementation(async () => ({ url: '/api/files/biz/hero/real.png', bytes: 10, type: 'image/png' }));
    const second = await draft(first);
    // The placeholder is retried strictly: an existing picture, even a template, is never replaced by another template.
    expect(H.file).toHaveBeenCalledTimes(1);
    expect(H.file.mock.calls[0][0]).toMatchObject({ modelRequired: true, literal: true, prompt: COVER });
    expect(second.img.url).toBe('/api/files/biz/hero/real.png');
    expect('placeholder' in second.img).toBe(false);
  });
  it('a provider failure is recorded as `failed`; a retry that fails again keeps the placeholder and its mark', async () => {
    H.file.mockImplementation(async () => ({ url: '/api/files/biz/hero/template.png', bytes: 10, type: 'image/png', placeholder: 'failed' }));
    const first = await draft();
    expect(first.img.placeholder).toMatchObject({ reason: 'failed' });
    H.file.mockReset(); H.file.mockRejectedValue(new Error('openai image 503'));
    const second = await draft(first);
    expect(second.img).toEqual(first.img);
  });
  it('a cover that could not be stored at all leaves no cover and no mark, and the draft completes', async () => {
    H.file.mockRejectedValue(new Error('storage unavailable'));
    const a = await draft({ img: { ...defaultArticle(entry).img, placeholder: { reason: 'failed', at: '2026-11-01T00:00:00.000Z' } } });
    expect(a.generated).toBe(true);
    expect(a.img).toMatchObject({ url: null, urlKey: null, prompt: COVER, promptBy: 'radar' });
    expect('placeholder' in a.img).toBe(false);
  });
});

describe('body images that cannot be made', () => {
  it.each([
    ['no image model can be used', Object.assign(new Error('Image generation is temporarily unavailable.'), { code: 'image_unavailable' }), 'unavailable'],
    ['a provider failed', new Error('xai image 500: down'), 'failed'],
    ['storage failed', new Error('storage unavailable'), 'failed'],
  ] as const)('%s: the draft completes with none, and records why', async (_name, error, reason) => {
    H.body.mockRejectedValue(error);
    const a = await draft();
    expect(a.generated).toBe(true);
    expect(a.bodyImages).toEqual([]);
    expect(a.bodyImagesIssue).toEqual({ reason, at: a.bodyImagesGeneratedAt });
    expect(a.draftedAt).toBeTruthy();
    expect(a.img.url).toBe('/api/files/biz/hero/1-illustration.png');
    expect(a.body.length).toBeGreaterThan(0);
  });
  it('a later draft that makes them removes the record; the previous images are replaced, never mixed', async () => {
    const before = drafted({ prompt: COVER, promptBy: 'radar' }, { bodyImages: [], bodyImagesIssue: { reason: 'unavailable', at: '2026-11-01T00:00:00.000Z' }, bodyImagesGeneratedAt: '2026-11-01T00:00:00.000Z' });
    const a = await draft(before);
    expect(a.bodyImages).toHaveLength(2);
    expect('bodyImagesIssue' in a).toBe(false);
    expect(a.bodyImagesGeneratedAt).not.toBe('2026-11-01T00:00:00.000Z');
  });
  it('an article with nothing to illustrate still fails as before', async () => {
    H.body.mockRejectedValue(Object.assign(new Error('Add article content before generating body images.'), { code: 'empty_article' }));
    await expect(draft()).rejects.toMatchObject({ code: 'empty_article' });
  });
});

describe('rewriting an article that already has a cover', () => {
  it('a contextual cover is kept with its direction: no image is generated, and the new directions are cached', async () => {
    const earlier = 'The entrance gate of Wasl 611 in Al Warsan in daylight.';
    const a = await draft(drafted({ prompt: earlier, promptBy: 'radar', alt: 'Illustration of the Wasl 611 gate' }));
    expect(H.file).not.toHaveBeenCalled();
    expect(a.img).toEqual({ style: 'illustration', seed: 1, prompt: earlier, promptBy: 'radar', alt: 'Illustration of the Wasl 611 gate', url: '/api/files/biz/hero/old.png', urlKey: 'illustration:1' });
    expect(a.imageDirections).toMatchObject({ source: 'ai', cover: { prompt: COVER } });
    expect(a.seo).toEqual({ title: 'Kept title', meta: 'Kept meta', slug: 'kept' });
  });
  it('an article from before this change gets one strict attempt at a contextual cover', async () => {
    const a = await draft(drafted({}));
    expect(H.file).toHaveBeenCalledTimes(1);
    expect(H.file.mock.calls[0][0]).toMatchObject({ prompt: COVER, literal: true, modelRequired: true, style: 'illustration', seed: 1 });
    expect(a.img).toMatchObject({ prompt: COVER, promptBy: 'radar', alt: 'Illustration of Wasl 611 in Al Warsan', url: '/api/files/biz/hero/1-illustration.png', urlKey: 'illustration:1' });
  });
  it('when that attempt fails the cover, its direction and its alt stay exactly as they were', async () => {
    H.file.mockRejectedValue(Object.assign(new Error('Image generation is temporarily unavailable.'), { code: 'image_unavailable' }));
    const before = drafted({});
    const a = await draft(before);
    expect(a.generated).toBe(true);
    expect(a.img).toEqual(before.img);
    // The directions are still cached, so the next Regenerate or rewrite has them.
    expect(a.imageDirections!.cover.prompt).toBe(COVER);
  });
  it('an alt the owner edited survives a new cover direction', async () => {
    const a = await draft(drafted({ alt: 'My own alt', altBy: 'owner' }));
    expect(a.img).toMatchObject({ prompt: COVER, promptBy: 'radar', alt: 'My own alt', altBy: 'owner' });
  });
  it('a template style takes the new direction text and is not drawn again', async () => {
    const a = await draft(drafted({ style: 'branded', urlKey: 'branded:1' }));
    expect(H.file).not.toHaveBeenCalled();
    expect(a.img).toMatchObject({ style: 'branded', prompt: COVER, promptBy: 'radar', url: '/api/files/biz/hero/old.png', urlKey: 'branded:1' });
  });
  it('a cover whose style or variation no longer matches is drawn again, and may fall back like a first cover', async () => {
    const a = await draft(drafted({ prompt: COVER, promptBy: 'radar', urlKey: 'photography:1' }));
    expect(H.file).toHaveBeenCalledTimes(1);
    expect(H.file.mock.calls[0][0]).toMatchObject({ modelRequired: false, literal: true });
    expect(a.img.urlKey).toBe('illustration:1');
  });
});
