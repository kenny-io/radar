import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Article, CalendarEntry, Profile } from '@/lib/types';
const M = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('../images', () => ({ renderImage: M.render }));
import { generateArticleBodyImages } from './bodyImages';

const e = { id: 'e1', title: 'Improve documentation' } as CalendarEntry;
const a = { body: [['p', 'Intro'], ['h2', 'Measure drift'], ['p', 'Compare documentation and code.'], ['h2', 'Review changes'], ['p', 'Review documentation with the pull request.'], ['h2', 'Ship safely'], ['p', 'Publish checked documentation.']], brief: { words: 1400 }, img: { style: 'illustration', seed: 7 }, bodyImages: [{ seed: 10 }] } as Article;
const profile = { business: { name: 'Radar' }, brand: { primary: '#123456', secondary: '#abcdef' } } as Profile;
beforeEach(() => { M.render.mockReset(); M.render.mockImplementation(async r => `/api/files/bid/article-body/${r.seed}.png`); });

describe('section illustration generation', () => {
  it('stores every planned image with distinct direction, seed, useful alt and progress', async () => {
    const progress = vi.fn(async (_p: any) => {});
    const images = await generateArticleBodyImages({ businessId: 'bid', progress }, e, a, profile);
    expect(images).toHaveLength(2);
    expect(new Set(images.map(i => i.id)).size).toBe(2);
    expect(images.map(i => i.seed)).toEqual([11, 12]);
    expect(images.map(i => i.alt)).toEqual(['Illustration of Measure drift', 'Illustration of Ship safely']);
    expect(images[0].prompt).toContain('Compare documentation and code.');
    expect(images[1].prompt).toContain('Publish checked documentation.');
    // Never a template: every request is strict, and its prompt is a literal scene.
    expect(M.render.mock.calls[0][0]).toMatchObject({ kind: 'article-body', w: 1200, h: 675, headline: 'Measure drift', style: 'illustration', modelRequired: true, literal: true });
    expect(M.render.mock.calls.every(([r]) => r.modelRequired === true && r.literal === true)).toBe(true);
    // Without directions the request is built from the title, heading and section text; nothing asks for a metaphor.
    expect(M.render.mock.calls[0][0].prompt).toBe('A literal, realistic scene showing Measure drift, in an article titled Improve documentation. Compare documentation and code.');
    expect(images[0].prompt).toBe(M.render.mock.calls[0][0].prompt);
    expect(M.render.mock.calls.map(([r]) => r.prompt).join(' ')).not.toMatch(/metaphor|Do not repeat the article cover/);
    expect(progress.mock.calls.map(c => c[0])).toEqual([{ stage: 'images', completed: 0, total: 2 }, { stage: 'images', completed: 1, total: 2 }, { stage: 'images', completed: 2, total: 2 }]);
    expect(a.bodyImages).toEqual([{ seed: 10 }]);
  });
  it('a long article gets three, and storage failure rejects the entire replacement', async () => {
    expect(await generateArticleBodyImages({ businessId: 'bid', progress: async () => {} }, e, { ...a, brief: { ...a.brief, words: 2200 } }, profile)).toHaveLength(3);
    M.render.mockReset().mockResolvedValueOnce('/api/files/first.png').mockRejectedValueOnce(new Error('storage failed'));
    await expect(generateArticleBodyImages({ businessId: 'bid', progress: async () => {} }, e, a, profile)).rejects.toThrow('storage failed');
    expect(a.bodyImages).toEqual([{ seed: 10 }]);
  });
  it('draws the directions it is given: the request and the stored prompt and alt are the section’s own', async () => {
    const directions = { sections: [
      { prompt: 'Two open laptops side by side on a desk, one showing code and one showing a manual.', alt: 'Illustration of code beside its manual' },
      { prompt: 'A release checklist pinned beside a monitor in a quiet office.', alt: 'Illustration of a release checklist' },
    ] };
    const images = await generateArticleBodyImages({ businessId: 'bid', progress: async () => {} }, e, a, profile, directions);
    expect(M.render.mock.calls.map(([r]) => r.prompt)).toEqual(directions.sections.map(s => s.prompt));
    expect(images.map(i => ({ prompt: i.prompt, alt: i.alt }))).toEqual(directions.sections);
    expect(images.map(i => i.after.heading)).toEqual(['measure drift', 'ship safely']);
  });
  it('directions for a different number of sections are not used', async () => {
    const images = await generateArticleBodyImages({ businessId: 'bid', progress: async () => {} }, e, a, profile, { sections: [{ prompt: 'Only one direction for two sections.', alt: 'Stale' }] });
    expect(images.map(i => i.alt)).toEqual(['Illustration of Measure drift', 'Illustration of Ship safely']);
    expect(images[1].prompt).toContain('Publish checked documentation.');
  });
  it('a cover direction the owner typed guides every body image; one Radar wrote, or the creation default, does not', async () => {
    const run = async (img: Partial<Article['img']>, kw = 'docs updates') => {
      M.render.mockClear();
      const images = await generateArticleBodyImages({ businessId: 'bid', progress: async () => {} }, { ...e, kw } as CalendarEntry, { ...a, img: { ...a.img, ...img } }, profile, { sections: [{ prompt: 'Scene one in a workshop.', alt: 'Illustration one' }, { prompt: 'Scene two on a rooftop.', alt: 'Illustration two' }] });
      return { sent: M.render.mock.calls.map(([r]) => r.prompt), stored: images.map(i => i.prompt) };
    };
    for (const img of [{ prompt: 'Warm evening light', promptBy: 'owner' as const }, { prompt: 'Warm evening light' }]) {
      const { sent, stored } = await run(img);
      expect(sent).toEqual(['Scene one in a workshop. Overall look the owner asked for: Warm evening light', 'Scene two on a rooftop. Overall look the owner asked for: Warm evening light']);
      // What is stored is what the picture shows, without the owner's overall look repeated on every image.
      expect(stored).toEqual(['Scene one in a workshop.', 'Scene two on a rooftop.']);
    }
    for (const img of [{ prompt: 'The exterior of a gated community', promptBy: 'radar' as const }, { prompt: 'Calm, editorial image about docs updates' }, { prompt: '' }]) {
      expect((await run(img)).sent).toEqual(['Scene one in a workshop.', 'Scene two on a rooftop.']);
    }
  });
  it('reuses strict custom cover direction for body images without altering the prior set on failure', async () => {
    const custom = { ...a, img: { ...a.img, style: 'branded' as const, prompt: 'Sobha Sapphire at sunset', modelRequired: true } };
    await generateArticleBodyImages({ businessId: 'bid', progress: async () => {} }, e, custom, profile);
    expect(M.render.mock.calls.every(([r]) => r.modelRequired === true && r.prompt.includes('Sobha Sapphire at sunset'))).toBe(true);
    M.render.mockRejectedValue(new Error('generation unavailable'));
    await expect(generateArticleBodyImages({ businessId: 'bid', progress: async () => {} }, e, custom, profile)).rejects.toThrow('generation unavailable');
    expect(custom.bodyImages).toEqual(a.bodyImages);
  });
  it('refuses empty content before rendering anything', async () => {
    await expect(generateArticleBodyImages({ businessId: 'bid', progress: async () => {} }, e, { ...a, body: [] }, profile)).rejects.toMatchObject({ code: 'empty_article' });
    expect(M.render).not.toHaveBeenCalled();
  });
});
