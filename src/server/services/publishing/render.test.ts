// blocksToMarkdown is the Next.js MDX body (and the webhook's `markdown`). Escaping follows CommonMark (spec.commonmark.org/0.31.2:
// backslash escapes for ASCII punctuation, character references, list/heading/quote/fence/thematic-break line starts) and MDX
// (mdxjs.com/docs/what-is-mdx: unescaped `<` and `{` "have to be escaped" (\< \{), no autolinks, no indented code;
// github.com/micromark/micromark-extension-mdxjs-esm: lowercase `export`/`import` followed by a space starts ESM).
import { describe, expect, it } from 'vitest';
import { blocksToHtml, blocksToMarkdown, escMd, sourcesList } from './render';

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
    // Literal "&copy;" / "&amp;" stay text (MDX and Markdown would decode them); the import/export reference is still decoded.
    expect(escMd('Write &copy; or &#169; literally.')).toBe('Write \\&copy; or &\\#169; literally.');
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
  it('a source URL can\'t close the link or open JSX/an expression; non-http source URLs are omitted', () => {
    const md = blocksToMarkdown([['p', 'x']], { sources: [{ title: 't', url: 'https://e.org/x)<y>{z}', use: '' }, { title: 'bad', url: 'javascript:alert(1)', use: '' }] });
    expect(md).toContain('[t](https://e.org/x%29%3Cy%3E%7Bz%7D)');
    expect(md).not.toContain('[bad]');
    expect(md).not.toContain('javascript:');
  });
});

describe('blocksToHtml is unchanged', () => {
  it('escapes text as HTML only', () => {
    expect(blocksToHtml([['p', 'export {a} < b'], ['ul', ['- x']]])).toBe('<p>export {a} &lt; b</p>\n<ul><li>- x</li></ul>');
  });
});

describe('public source citations', () => {
  const internal = { title: 'Search Console — queries for “documentation analytics for developer docs”', url: 'Google Search Console', use: 'Internal research context', notes: ['Keep these research notes in the article.'] };
  it('omits the actual internal research reference while preserving neighboring external citations across public exports', () => {
    const first = { title: 'Documentation report — 2026', url: 'https://example.org/report?year=2026#results', use: 'Report', notes: ['Original finding.'] };
    const last = { title: 'Protocol guide', url: 'HTTP://example.com/guide', use: 'Guide' };
    const sources = [first, internal, last];
    const before = JSON.stringify(sources);
    const blocks: import('@/lib/types').Block[] = [['p', 'Original article — body remains unchanged.']];
    const html = blocksToHtml(blocks, { sources }); const markdown = blocksToMarkdown(blocks, { sources });
    const publicSources = sourcesList(sources);
    // buildPayload uses this same list when exporting structured payload.sources.
    const payloadSources = publicSources.map(source => ({ title: source.title, url: source.url }));
    expect(payloadSources).toEqual([{ title: first.title, url: first.url }, { title: last.title, url: last.url }]);
    expect(publicSources[0]).toBe(first); expect(publicSources[1]).toBe(last);
    expect(JSON.stringify(sources)).toBe(before); expect(sources[1]).toBe(internal);
    for (const output of [html, markdown, JSON.stringify(payloadSources)]) {
      expect(output).not.toContain('Search Console'); expect(output).not.toContain(internal.use);
      expect(output).toContain(first.title); expect(output).toContain(first.url); expect(output).toContain(last.url);
    }
    expect(html).toContain('<p>Original article — body remains unchanged.</p>');
    expect(markdown).toContain('Original article — body remains unchanged.');
    expect(markdown).toContain('1. [Documentation report — 2026]'); expect(markdown).toContain('2. [Protocol guide]');
  });
  it.each(['', '#', '#research', 'Google Search Console', 'gsc:queries', '/research/report', '../report', '//example.org/report', 'javascript:alert(1)', 'mailto:author@example.org', 'https://', 'https://bad host.test/report', 'https://user:password@example.org/report', 'https://user@example.org/report', 'http://:password@example.org/report'])('does not export internal, malformed or credential-bearing reference %s', url => {
    const source = { title: 'Research reference', url, use: 'Context only' };
    expect(sourcesList([source])).toEqual([]);
    expect(blocksToHtml([['p', 'Body']], { sources: [source] })).toBe('<p>Body</p>');
    expect(blocksToMarkdown([['p', 'Body']], { sources: [source] })).toBe('Body\n');
  });
  it('keeps removed sources out, retains valid URL/title strings and suppresses an empty citations heading', () => {
    const removed = { title: 'Removed source', url: 'https://example.org/removed', use: '', removed: true };
    expect(sourcesList([internal, removed])).toEqual([]);
    expect(blocksToHtml([], { sources: [internal, removed], sourcesHeading: 'References' })).toBe('');
    expect(blocksToMarkdown([], { sources: [internal, removed], sourcesHeading: 'References' })).toBe('\n');
    const source = { title: '', url: 'https://example.org/path_(reference)?q=1&v=2', use: '' };
    expect(sourcesList([source])).toEqual([source]); expect(sourcesList()).toEqual([]);
    expect(source.title).toBe(''); expect(source.url).toBe('https://example.org/path_(reference)?q=1&v=2');
  });
});
