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
    expect(M.render.mock.calls[0][0]).toMatchObject({ kind: 'article-body', w: 1200, h: 675, headline: 'Measure drift', style: 'illustration' });
    expect(progress.mock.calls.map(c => c[0])).toEqual([{ stage: 'images', completed: 0, total: 2 }, { stage: 'images', completed: 1, total: 2 }, { stage: 'images', completed: 2, total: 2 }]);
    expect(a.bodyImages).toEqual([{ seed: 10 }]);
  });
  it('a long article gets three, and storage failure rejects the entire replacement', async () => {
    expect(await generateArticleBodyImages({ businessId: 'bid', progress: async () => {} }, e, { ...a, brief: { ...a.brief, words: 2200 } }, profile)).toHaveLength(3);
    M.render.mockReset().mockResolvedValueOnce('/api/files/first.png').mockRejectedValueOnce(new Error('storage failed'));
    await expect(generateArticleBodyImages({ businessId: 'bid', progress: async () => {} }, e, a, profile)).rejects.toThrow('storage failed');
    expect(a.bodyImages).toEqual([{ seed: 10 }]);
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
