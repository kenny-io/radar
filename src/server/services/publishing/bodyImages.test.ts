import { describe, expect, it } from 'vitest';
import type { ArticleBodyImage, Block } from '@/lib/types';
import { blocksToHtml, blocksToMarkdown } from './render';
import { toNotionBlocks } from './connectors/notion';

const blocks: Block[] = [['p', 'Intro'], ['h2', 'Section'], ['p', 'Content'], ['h2', 'Next'], ['p', 'More']];
const bodyImages: ArticleBodyImage[] = [{ id: 'img', after: { heading: 'section', occurrence: 0, block: 1 }, url: 'https://cdn.example.org/image.png?a=1&b=2', alt: 'A "diagram" <script> {x} [text]', prompt: '', seed: 1 }];
describe('publishing article body images', () => {
  it('inserts the same image between sections in HTML, Markdown and native Notion', () => {
    const opts = { bodyImages, videos: [], sources: [] };
    const html = blocksToHtml(blocks, opts);
    expect(html).toContain('<p>Content</p>\n<figure class="radar-body-image"><img src="https://cdn.example.org/image.png?a=1&amp;b=2" alt="A &quot;diagram&quot; &lt;script&gt; {x} [text]" width="1200" height="675" loading="lazy" /></figure>\n<h2>Next</h2>');
    const md = blocksToMarkdown(blocks, opts);
    expect(md).toContain('Content\n\n![A "diagram" \\<script\\> \\{x\\} \\[text\\]](https://cdn.example.org/image.png?a=1&b=2)\n\n## Next');
    const notion = toNotionBlocks(blocks, opts);
    expect(notion.map(b => b.type)).toEqual(['paragraph', 'heading_2', 'paragraph', 'image', 'heading_2', 'paragraph']);
    expect(notion[3].image).toMatchObject({ type: 'external', external: { url: bodyImages[0].url }, caption: [{ text: { content: bodyImages[0].alt } }] });
  });
  it('ignores orphaned anchors; legacy bodies serialize unchanged', () => {
    const orphan = [{ ...bodyImages[0], after: { heading: 'deleted', occurrence: 0, block: 0 } }];
    expect(blocksToHtml(blocks, { bodyImages: orphan })).toBe(blocksToHtml(blocks));
    expect(blocksToMarkdown(blocks, { bodyImages: orphan })).toBe(blocksToMarkdown(blocks));
    expect(toNotionBlocks(blocks, { videos: [], sources: [] })).toHaveLength(5);
  });
  it('escapes Markdown destinations and refuses unusable Notion URLs rather than dropping images', () => {
    const image = { ...bodyImages[0], url: 'https://cdn.example.org/a(b){c}<d>.png' };
    expect(blocksToMarkdown(blocks, { bodyImages: [image] })).toContain('a%28b%29%7Bc%7D%3Cd%3E.png');
    for (const url of ['http://example.org/image.png', 'https://localhost/image.png', 'javascript:alert(1)']) {
      expect(() => toNotionBlocks(blocks, { videos: [], sources: [], bodyImages: [{ ...image, url }] })).toThrow('publicly reachable HTTPS');
    }
    expect(blocksToHtml(blocks, { bodyImages: [{ ...image, url: 'javascript:alert(1)' }] })).not.toContain('<img');
  });
});
