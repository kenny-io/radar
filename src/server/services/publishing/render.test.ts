// blocksToMarkdown is the Next.js MDX body (and the webhook's `markdown`). Escaping follows CommonMark (spec.commonmark.org/0.31.2:
// backslash escapes for ASCII punctuation, character references, list/heading/quote/fence/thematic-break line starts) and MDX
// (mdxjs.com/docs/what-is-mdx: unescaped `<` and `{` "have to be escaped" (\< \{), no autolinks, no indented code;
// github.com/micromark/micromark-extension-mdxjs-esm: lowercase `export`/`import` followed by a space starts ESM).
import { describe, expect, it } from 'vitest';
import { blocksToHtml, blocksToMarkdown, escMd } from './render';

describe('escMd (prose that must not break an MDX build)', () => {
  it('escapes JSX and expression openers', () => {
    expect(escMd('use {name} when a < b and <Tag>')).toBe('use \\{name\\} when a \\< b and \\<Tag\\>');
  });
  it('a paragraph starting with "import"/"export" is not ESM: the first letter is a character reference', () => {
    expect(escMd('export your invoices to CSV')).toBe('&#101;xport your invoices to CSV');
    expect(escMd('Line one\nimport the file')).toBe('Line one\n&#105;mport the file');
    expect(escMd('exports grew; Import costs; important')).toBe('exports grew; Import costs; important');
  });
  it('escapes block starts on every line, not just the first', () => {
    expect(escMd('Intro\n- not a list\n+ nor this\n1. nor this\n2) nor this\n> nor a quote\n# nor a heading\n---\n    not code\n~~~')).toBe(
      'Intro\n\\- not a list\n\\+ nor this\n1\\. nor this\n2\\) nor this\n\\> nor a quote\n\\# nor a heading\n\\---\nnot code\n\\~\\~\\~');
  });
  it('escapes inline Markdown (emphasis, code, links, tables, strikethrough) and backslashes', () => {
    expect(escMd('a*b*_c_ `x` [l](u) | ~~s~~ C:\\dir')).toBe('a\\*b\\*\\_c\\_ \\`x\\` \\[l\\](u) \\| \\~\\~s\\~\\~ C:\\\\dir');
  });
  it('leaves ordinary text alone', () => {
    expect(escMd('Rent, software & insurance — 20% of 1,200.')).toBe('Rent, software & insurance — 20% of 1,200.');
    expect(escMd('In 2026. Prices rose')).toBe('In 2026. Prices rose');
  });
});

describe('blocksToMarkdown', () => {
  it('renders headings, lists, paragraphs, videos after the first section and numbered sources', () => {
    const md = blocksToMarkdown([['p', 'Intro {x}'], ['h2', 'Why <it> works'], ['ul', ['export one', '{two}']], ['p', 'Done.']],
      { videos: [{ id: 'dQw4w9WgXcQ', title: 'A "video"', channel: 'Chan' }], sources: [{ title: 'Survey [2026]', url: 'https://example.org/a b_(c)', use: '' }] });
    expect(md).toBe([
      'Intro \\{x\\}',
      '<iframe width="560" height="315" src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" title="A \'video\'" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen></iframe>\n\n*A "video" · YouTube · Chan* — [Watch on YouTube](https://www.youtube.com/watch?v=dQw4w9WgXcQ)',
      '## Why \\<it\\> works',
      '- &#101;xport one\n- \\{two\\}',
      'Done.',
      '## Sources\n\n1. [Survey \\[2026\\]](https://example.org/a%20b_%28c%29)',
    ].join('\n\n') + '\n');
  });
  it('a source URL can\'t close the link or open JSX/an expression; non-http URLs become #', () => {
    const md = blocksToMarkdown([['p', 'x']], { sources: [{ title: 't', url: 'https://e.org/x)<y>{z}', use: '' }, { title: 'bad', url: 'javascript:alert(1)', use: '' }] });
    expect(md).toContain('[t](https://e.org/x%29%3Cy%3E%7Bz%7D)');
    expect(md).toContain('[bad](#)');
  });
});

describe('blocksToHtml is unchanged', () => {
  it('escapes text as HTML only', () => {
    expect(blocksToHtml([['p', 'export {a} < b'], ['ul', ['- x']]])).toBe('<p>export {a} &lt; b</p>\n<ul><li>- x</li></ul>');
  });
});
