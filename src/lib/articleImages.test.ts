import { describe, expect, it } from 'vitest';
import type { ArticleBodyImage, Block } from './types';
import { articleBodyImageAnchor, planArticleBodyImages } from './articleImages';

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
