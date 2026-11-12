import { describe, expect, it } from 'vitest';
import type { Block } from '@/lib/types';
import { blocksToHtml, blocksToMarkdown } from '../render';
import { FIDELITY, articleUnits, checkArticleFidelity, markBoundaries, omittedMedia } from './fidelity';
import { ARTICLE, BODY_IMAGE, PARAPHRASED, SOURCES, VIDEOS, generatedArticle, paragraph, payloadFor, seeded } from './__fixtures__/article';
import { recordSource, toRecord } from './__fixtures__/typedRegistry';
import { mdxPost } from './__fixtures__/mdxAudit';

const payload = payloadFor();
const units = articleUnits(ARTICLE);
/** A repository path for a fixture file, by what it holds: the check reads a file's structure by its type. */
const pathFor = (content: string) => (/^\s*[{["]/.test(content) ? 'content/post.json' : /^\s*(?:<|&lt;)/.test(content) ? 'content/post.html' : /^(?:export |import |const |\s*\{\n\s+slug: ')/.test(content) ? 'content/posts.ts' : 'content/post.mdx');
/** Fidelity of one or more final files against the fixture article. `articleAdded` defaults to the first file, as for a
 *  new article file. `paths` defaults to a path of the type each file's content has. */
const check = (contents: string | string[], blocks: Block[] = ARTICLE, articleAdded?: string | null, paths?: (string | undefined)[]) => {
  const list = Array.isArray(contents) ? contents : [contents];
  return checkArticleFidelity({ units: articleUnits(blocks), contents: list, paths: paths ?? list.map(pathFor), articleAdded: articleAdded === undefined ? list[0] : articleAdded });
};
const rules = (result: ReturnType<typeof check>) => result.issues.map(issue => issue.rule);
const without = (index: number, blocks: Block[] = ARTICLE) => blocks.filter((_, i) => i !== index);
/** Words that only occur in the article body; a diagnostic must never contain one. */
const ARTICLE_WORDS = /larkfield|ferry|decibels|glazing|deposit|brochure|catchment/i;

describe('articleUnits', () => {
  it('turns paragraphs, headings and every list entry into one indexed unit each, in document order', () => {
    expect(units).toHaveLength(28);
    expect(units.map(unit => unit.index)).toEqual(units.map((_, i) => i));
    expect(units.filter(unit => unit.kind === 'paragraph')).toHaveLength(13);
    expect(units.filter(unit => unit.kind === 'heading')).toHaveLength(8);
    expect(units.filter(unit => unit.kind === 'item')).toHaveLength(7);
    expect(units[7]).toEqual({ index: 7, kind: 'item', text: 'North block: quiet after 9 pm, with double glazing on every window' });
    expect(units[5]).toEqual({ index: 5, kind: 'heading', text: 'Noise & light' });
    expect(units[0].text).toBe(ARTICLE[0][1]);
  });
  it('skips blank units and tolerates malformed stored blocks without throwing', () => {
    const blocks = [['p', '  '], ['h2', 'Kept heading'], ['ul', ['', 'Kept item', 7]], ['table', 'x'], null, ['p', 'Kept paragraph']] as unknown as Block[];
    expect(articleUnits(blocks)).toEqual([{ index: 0, kind: 'heading', text: 'Kept heading' }, { index: 1, kind: 'item', text: 'Kept item' }, { index: 2, kind: 'paragraph', text: 'Kept paragraph' }]);
    expect(articleUnits(undefined as unknown as Block[])).toEqual([]);
  });
});

describe('fidelity accepts legitimate format conversion', () => {
  it('accepts the Markdown Radar renders, including its escapes', () => {
    const result = check(payload.markdown);
    expect(result.issues).toEqual([]);
    expect(result).toMatchObject({ ok: true, headingsMissing: [], interleaved: [], counts: { paragraphs: 13, items: 7, headings: 8, headingsPresent: 8, duplicates: 0, orderedShare: 1 } });
    expect(result.detail).toMatch(/^13 of 13 paragraphs and 7 of 7 list items present, 20 of them word for word; 8 of 8 headings present; 100% in the article's order; /);
  });
  it('accepts MDX with frontmatter where the em dash and curly quotes were replaced and lines were re-wrapped', () => {
    const mdx = String(Object.values(mdxPost(payload).files)[0]);
    expect(mdx.startsWith('---\ntitle: ')).toBe(true);
    expect(mdx).not.toMatch(/[\u2014\u2018\u2019\u201c\u201d]/);
    // Re-wrapped: the second paragraph no longer sits on one line, but its words are all there.
    expect(mdx).not.toContain("compared the building's published fees with what tenants actually paid");
    expect(mdx.replace(/\n/g, ' ')).toContain("compared the building's published fees with what tenants actually paid");
    expect(check(mdx)).toMatchObject({ ok: true, issues: [] });
  });
  it('accepts the article as an HTML document body and as an HTML string field in JSON', () => {
    expect(check(payload.html)).toMatchObject({ ok: true, issues: [] });
    expect(check(JSON.stringify({ slug: payload.slug, bodyHtml: payload.html }, null, 2))).toMatchObject({ ok: true, issues: [] });
    // Encoders that escape markup and non-ASCII characters inside JSON strings.
    const escaped = JSON.stringify({ bodyHtml: payload.html }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/[\u0080-\uffff]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
    expect(escaped).not.toMatch(/[<>&\u0080-\uffff]/);
    expect(check(escaped)).toMatchObject({ ok: true, issues: [] });
  });
  it('accepts HTML that uses character references for punctuation and accents', () => {
    const html = payload.html.replace(/\u2014/g, '&mdash;').replace(/\u2019/g, '&rsquo;').replace(/\u201c/g, '&ldquo;').replace(/\u201d/g, '&#8221;').replace(/\u00e9/g, '&eacute;').replace(/ (?=\d)/g, '&nbsp;');
    expect(html).toContain('caf&eacute;');
    expect(check(html)).toMatchObject({ ok: true, issues: [] });
  });
  it('accepts a typed registry record: paragraph arrays, bullet arrays and a list converted to table rows', () => {
    const record = recordSource(toRecord(ARTICLE, payload));
    expect(record).toContain("rows: [");
    expect(record).toContain("['Studio', 'from 1,150 per month'],");
    expect(record).toContain("building\u2019s published fees");
    const result = check(record);
    expect(result).toMatchObject({ ok: true, issues: [] });
    // The table sits after the section's paragraphs, so one paragraph moves ahead of four rows: within the order tolerance.
    expect(result.counts.orderedShare).toBeGreaterThanOrEqual(FIDELITY.orderRun);
    expect(result.counts.orderedShare).toBeLessThan(1);
  });
  it('accepts inline links and emphasis added around the original words', () => {
    const linked = payload.markdown
      .replace('ferry terminal', '[ferry terminal](https://transit.example.net/ferry/terminal "Timetable")')
      .replace('Bus route 14', '**Bus route 14**')
      .replace('one-bedroom unit', '<a href="/homes/one-bedroom" class="inline">one-bedroom unit</a>')
      .replace('induction hobs', '[induction hobs][appliances]')
      .replace('nine of the forty-two days', 'nine[^1] of the forty-two days')
      .replace('covered market', '<https://markets.example.org/saturday> covered market')
      + '\n[appliances]: https://shop.example.net/appliances\n[^1]: Counted from the maintenance log.\n';
    expect(linked).not.toBe(payload.markdown);
    expect(check(linked)).toMatchObject({ ok: true, issues: [], interleaved: [] });
  });
  it('accepts prose that mentions a tag or a backslash when it is stored in a plain string', () => {
    const blocks: Block[] = [['p', 'Add a <meta> tag inside the <head> element of every page, then write the folder as C:\\new\\templates in the settings file before you publish the site again.'], ['p', paragraph(seeded(3))]];
    expect(check(JSON.stringify({ paragraphs: blocks.map(block => block[1]) }), blocks)).toMatchObject({ ok: true, issues: [] });
    expect(check(blocksToMarkdown(blocks), blocks)).toMatchObject({ ok: true, issues: [] });
    expect(check(blocksToHtml(blocks), blocks)).toMatchObject({ ok: true, issues: [] });
  });
  it('allows a template to supply one structural heading and reports which heading was not carried', () => {
    const blocks = ARTICLE.map((block): Block => (block[0] === 'h2' && block[1] === 'Frequently asked questions' ? ['h2', 'FAQ'] : block));
    const result = check(blocksToMarkdown(blocks));
    expect(result.ok).toBe(true);
    expect(result.headingsMissing).toEqual([23]);
    expect(units[23]).toMatchObject({ kind: 'heading', text: 'Frequently asked questions' });
    expect(result.detail).toContain('7 of 8 headings present');
  });
  it('allows one paragraph to repeat, as a lede or description does', () => {
    const withDescription = `---\ndescription: ${JSON.stringify(ARTICLE[0][1])}\n---\n` + payload.markdown;
    const result = check(withDescription);
    expect(result.ok).toBe(true);
    expect(result.counts).toMatchObject({ duplicates: 1, duplicatesAllowed: 1 });
  });
});

describe('fidelity refuses a shortened, reworded, repeated or padded article', () => {
  it('refuses a missing paragraph and names its position', () => {
    const result = check(blocksToMarkdown(without(13)));
    expect(result.ok).toBe(false);
    expect(rules(result)).toEqual(['omitted']);
    expect(result.issues[0].detail).toBe('1 of 20 paragraphs and list items are missing or rewritten: paragraph 18');
  });
  it('refuses a missing list entry, and a list entry whose figure changed', () => {
    const dropped = ARTICLE.map((block): Block => (block[0] === 'ul' && block[1].length === 4 ? ['ul', block[1].slice(0, 3)] : block));
    expect(check(blocksToMarkdown(dropped)).issues).toEqual([{ rule: 'omitted', detail: '1 of 20 paragraphs and list items are missing or rewritten: item 15' }]);
    const repriced = check(payload.markdown.replace('One bedroom: from 1,480 per month', 'One bedroom: from 1,840 per month'));
    expect(repriced.issues).toEqual([{ rule: 'omitted', detail: '1 of 20 paragraphs and list items are missing or rewritten: item 13' }]);
  });
  it('refuses a truncated tail', () => {
    const result = check(blocksToMarkdown(ARTICLE.slice(0, 15)));
    expect(result.ok).toBe(false);
    expect(rules(result)).toContain('truncated');
    expect(result.issues.find(issue => issue.rule === 'truncated')!.detail).toBe('the article is cut short: the last 4 of 20 paragraphs and list items are missing or incomplete, starting at paragraph 21');
  });
  it('refuses a body that stops in the middle of its last paragraph', () => {
    const cut = payloadFor(ARTICLE, { sources: [], videos: [], bodyImages: [] }).markdown.trimEnd();
    const result = check(cut.slice(0, cut.length - 90));
    expect(rules(result)).toEqual(['truncated']);
    expect(result.issues[0].detail).toContain('the last 1 of 20');
  });
  it('refuses paraphrased paragraphs even though the facts and many words are the same', () => {
    const blocks = ARTICLE.map((block, i): Block => (PARAPHRASED[i] ? ['p', PARAPHRASED[i]] : block));
    const result = check(blocksToMarkdown(blocks));
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([{ rule: 'omitted', detail: '3 of 20 paragraphs and list items are missing or rewritten: paragraph 3, paragraph 11, paragraph 21' }]);
  });
  it('refuses a light edit: one changed figure and one swapped word inside long paragraphs', () => {
    const edited = payload.markdown.replace('under 40 decibels', 'under 45 decibels').replace('about a quarter of an hour', 'roughly a quarter of an hour');
    expect(edited).not.toBe(payload.markdown);
    const result = check(edited);
    expect(result.issues).toEqual([{ rule: 'altered', detail: '2 of 20 paragraphs and list items have changed or dropped words: paragraph 6, paragraph 18' }]);
  });
  it('refuses a paragraph or list item that gained a word, and names its unit index (D2)', () => {
    // An inserted word leaves every original word in place and can reverse the sentence. Nothing that is present but
    // not word for word is allowed.
    expect(FIDELITY).toMatchObject({ interleavedShare: 0, interleavedFloor: 0 });
    const negated = check(payload.markdown.replace('which the lease requires', 'which the lease no longer requires'));
    expect(negated).toMatchObject({ ok: false, interleaved: [16], counts: { interleaved: 1, interleavedAllowed: 0 } });
    expect(negated.issues).toEqual([{ rule: 'interleaved', detail: "1 of 20 paragraphs and list items are present but not word for word: other words or markup sit between the article's words (none may be): paragraph 16" }]);
    expect(units[16]).toMatchObject({ index: 16, kind: 'paragraph' });
    const item = check(payload.markdown.replace('quiet after 9 pm, with double glazing', 'quiet after 9 pm, but never with double glazing'));
    expect(item.issues).toEqual([{ rule: 'interleaved', detail: "1 of 20 paragraphs and list items are present but not word for word: other words or markup sit between the article's words (none may be): item 7" }]);
    const several = check(payload.markdown
      .replace('which the lease requires', 'which the lease no longer requires')
      .replace('the crossing takes eleven', 'the crossing usually takes eleven')
      .replace('and parcels are signed for at the desk', 'and, as you would hope, parcels are signed for at the desk'));
    expect(several.issues).toEqual([{ rule: 'interleaved', detail: "3 of 20 paragraphs and list items are present but not word for word: other words or markup sit between the article's words (none may be): paragraph 3, paragraph 16, paragraph 18" }]);
    // A word inserted through a markup-looking wrapper that is not markup is still a word.
    expect(check(payload.markdown.replace('which the lease requires', 'which the lease {never} requires')).ok).toBe(false);
  });
  it('still reads markup between the words as markup, not as inserted words', () => {
    const marked = payload.markdown
      .replace('which the lease requires', 'which the **lease** <em>requires</em>')
      .replace('the crossing takes eleven', 'the [crossing](/ferry "Crossing times") takes eleven');
    expect(marked).not.toBe(payload.markdown);
    expect(check(marked)).toMatchObject({ ok: true, interleaved: [] });
    expect(check(marked).detail).toContain('20 of them word for word;');
  });
  it('finds a unit word for word when the file needs a different reading than the rest of it', () => {
    // An HTML body escapes the tag the prose mentions and leaves its backslashes alone; a JSON string does the opposite.
    const blocks: Block[] = [['p', 'Add a <meta> tag inside the <head> element of every page, then write the folder as C:\\new\\templates in the settings file before you publish the site again.'], ['p', 'The caf\u00e9 keeps a <strong> opinion about the building\u2019s lifts, and says so on the notice board by the door.'], ['p', paragraph(seeded(3))]];
    expect(check(blocksToHtml(blocks), blocks)).toMatchObject({ ok: true, interleaved: [] });
    const asciiJson = JSON.stringify({ paragraphs: blocks.map(block => block[1]) }).replace(/[\u0080-\uffff]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
    expect(asciiJson).toContain('caf\\u00e9');
    expect(check(asciiJson, blocks)).toMatchObject({ ok: true, interleaved: [] });
    // The same files with one word added are still refused.
    expect(check(blocksToHtml(blocks).replace('before you publish', 'before you ever publish'), blocks).ok).toBe(false);
    expect(check(asciiJson.replace('says so on', 'never says so on'), blocks).ok).toBe(false);
  });
  it('refuses an article written twice, in one file or across two files', () => {
    const body = payloadFor(ARTICLE, { sources: [], videos: [], bodyImages: [] }).markdown;
    const sameFile = check(body + '\n' + body);
    expect(rules(sameFile)).toContain('duplicated');
    expect(sameFile.issues.find(issue => issue.rule === 'duplicated')!.detail).toMatch(/^13 of 13 paragraphs appear more than once \(at most 1 may repeat\): paragraph 0, paragraph 1, /);
    const twoFiles = check([body, '<article>' + blocksToHtml(ARTICLE) + '</article>']);
    expect(rules(twoFiles)).toEqual(['duplicated']);
  });
  it('refuses unrelated prose padded into the article file', () => {
    const random = seeded(77);
    const padding = Array.from({ length: 16 }, () => paragraph(random, 4)).join('\n\n');
    const result = check(payload.markdown + '\n## You may also like\n\n' + padding + '\n');
    expect(rules(result)).toEqual(['padded']);
    expect(result.counts.addedTokens!).toBeGreaterThan(result.counts.addedTokenLimit);
    expect(result.issues[0].detail).toMatch(/^the article file adds \d+ words; the supplied article has \d+, so at most \d+ are allowed$/);
    // The same prose in another changed file is not the article file's padding.
    expect(check([payload.markdown, padding], ARTICLE, payload.markdown).ok).toBe(true);
  });
  it('refuses sections moved out of the article order', () => {
    const blocks = generatedArticle(11, 12);
    const starts = blocks.flatMap((block, i) => (block[0] === 'h2' ? [i] : []));
    const sections = starts.map((start, s) => blocks.slice(start, starts[s + 1] ?? blocks.length));
    const shuffled = [...blocks.slice(0, starts[0]), ...[...sections].reverse().flat()];
    expect(check(blocksToMarkdown(blocks), blocks).ok).toBe(true);
    const result = check(blocksToMarkdown(shuffled), blocks);
    expect(rules(result)).toEqual(['order']);
    expect(result.counts.orderedShare).toBeLessThan(FIDELITY.orderRun);
  });
  it('refuses a body whose headings were dropped beyond the template tolerance', () => {
    const result = check(blocksToMarkdown(ARTICLE.filter(block => block[0] === 'p' || block[0] === 'ul')));
    expect(rules(result)).toEqual(['headings']);
    expect(result.headingsMissing).toHaveLength(8);
  });
  it('refuses when the supplied article has nothing to verify, and when the output is unrelated text', () => {
    expect(rules(check('Some text', []))).toEqual(['no-units']);
    const unrelated = check(blocksToMarkdown(generatedArticle(5, 6)));
    expect(unrelated.ok).toBe(false);
    expect(rules(unrelated)).toContain('truncated');
  });
  it('describes every failure by position, kind and count only', () => {
    const failures = [
      check(blocksToMarkdown(without(13))), check(blocksToMarkdown(ARTICLE.slice(0, 15))), check(payload.markdown + payload.markdown),
      check(blocksToMarkdown(ARTICLE.map((block, i): Block => (PARAPHRASED[i] ? ['p', PARAPHRASED[i]] : block)))),
      check(blocksToMarkdown(ARTICLE.filter(block => block[0] !== 'h2' && block[0] !== 'h3'))),
    ];
    for (const failure of failures) {
      expect(failure.ok).toBe(false);
      expect(failure.detail.length).toBeLessThan(500);
      for (const text of [failure.detail, ...failure.issues.map(issue => issue.detail)]) {
        expect(text).not.toMatch(ARTICLE_WORDS);
        expect(text).not.toMatch(/https?:/);
      }
    }
    expect(check(payload.markdown).detail).not.toMatch(ARTICLE_WORDS);
  });
  it('keeps units listed in a failure bounded', () => {
    const blocks = generatedArticle(21, 20);
    const result = check('nothing of the article is here', blocks);
    const detail = result.issues.find(issue => issue.rule === 'truncated' || issue.rule === 'omitted')!.detail;
    expect(detail.length).toBeLessThan(300);
  });
});

// FINDING N3 of QA-2: a unit found as one run of words says nothing about the words right next to it.
describe('unit edges: nothing but the article’s own units shares a unit’s line, element or string (N3)', () => {
  const SMALL: Block[] = [
    ['p', 'Clear the gutters before the first storm of the autumn, and check each downpipe while you are up the ladder.'],
    ['h2', 'Start with the gutters'],
    ['ul', ['Clear leaves from every gutter run twice before December', 'Flush each downpipe with a hose']],
    ['h3', 'When to call someone'],
    ['p', 'Call a roofer if a ceiling stain grows after rain, and a plumber if it grows when nobody has used the bathroom.'],
  ];
  const U = articleUnits(SMALL).map(unit => unit.text);
  const q = (text: string) => "'" + text.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  /** The same six units in each destination format, one unit per container. */
  const CARRIERS: Record<string, [path: string, render: (u: string[]) => string]> = {
    'Markdown': ['content/blog/post.md', u => `---\ntitle: "Gutters"\ndescription: A short guide\n---\n\n${u[0]}\n\n## ${u[1]}\n\n- ${u[2]}\n- ${u[3]}\n\n### ${u[4]}\n\n${u[5]}\n`],
    'MDX with components': ['content/blog/post.mdx', u => `import { Callout } from '../components';\n\nexport const meta = { title: 'Gutters' };\n\n<Lede>${u[0]}</Lede>\n\n## ${u[1]}\n\n<Steps items={[${JSON.stringify(u[2])}, ${JSON.stringify(u[3])}]} />\n\n<Heading level="3" text="${u[4]}" />\n\n<Callout>\n${u[5]}\n</Callout>\n`],
    'an HTML page': ['site/guides/gutters.html', u => `<!doctype html>\n<html><head><title>Gutters</title></head>\n<body>\n<main>\n  <p>${u[0]}</p>\n  <h2>${u[1]}</h2>\n  <ul><li>${u[2]}</li><li>${u[3]}</li></ul>\n  <h3 id="call">${u[4]}</h3>\n  <p class="last">\n    ${u[5]}\n  </p>\n</main>\n</body></html>\n`],
    'a TypeScript record': ['apps/web/lib/posts.ts', u => `export const posts = [\n  {\n    slug: 'gutters',\n    intro: [${q(u[0])}],\n    sections: [\n      { heading: ${q(u[1])}, bullets: [${q(u[2])}, ${q(u[3])}] },\n      { heading: ${q(u[4])}, paragraphs: [\n        ${q(u[5])},\n      ] },\n    ],\n  },\n];\n`],
    'a JSON document': ['content/posts/gutters.json', u => JSON.stringify({ slug: 'gutters', blocks: [{ type: 'p', text: u[0] }, { type: 'h2', text: u[1] }, { type: 'ul', items: [u[2], u[3]] }, { type: 'h3', text: u[4] }, { type: 'p', text: u[5] }] }, null, 2) + '\n'],
    'HTML in a JSON string': ['content/posts/gutters.json', u => JSON.stringify({ slug: 'gutters', html: `<p>${u[0]}</p>\n<h2>${u[1]}</h2>\n<ul><li>${u[2]}</li><li>${u[3]}</li></ul><h3>${u[4]}</h3><p>${u[5]}</p>` }) + '\n'],
    'Markdown in a template literal': ['apps/web/lib/post.ts', u => `export const post = {\n  slug: 'gutters',\n  body: \`\n${u[0]}\n\n## ${u[1]}\n\n- ${u[2]}\n- ${u[3]}\n\n### ${u[4]}\n\n${u[5]}\n\`,\n};\n`],
    'Markdown in a JSON string': ['content/posts/gutters.json', u => JSON.stringify({ slug: 'gutters', body: `${u[0]}\n\n## ${u[1]}\n\n- ${u[2]}\n- ${u[3]}\n\n### ${u[4]}\n\n${u[5]}\n` }) + '\n'],
    'a TSX page': ['apps/web/app/blog/gutters/page.tsx', u => `export default function Post() {\n  return (\n    <article>\n      <p>{${JSON.stringify(u[0])}}</p>\n      <h2>${u[1]}</h2>\n      <ul>\n        <li>${u[2]}</li>\n        <li>{${q(u[3])}}</li>\n      </ul>\n      <h3 className="mt-8">${u[4]}</h3>\n      <p>\n        ${u[5]}\n      </p>\n    </article>\n  );\n}\n`],
    'YAML': ['content/posts/gutters.yaml', u => `title: Gutters\nbody:\n  - p: >-\n      ${u[0].replace(/, /g, ',\n      ')}\n  - h2: ${u[1]}\n  - ul:\n      - ${u[2]}\n      - "${u[3]}"\n  - h3: '${u[4]}'\n  - p: |\n      ${u[5]}\n`],
  };
  const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
  const edge = (path: string | undefined, content: string, blocks: Block[] = SMALL) => checkArticleFidelity({ units: articleUnits(blocks), contents: [content], paths: [path], articleAdded: content });

  it.each(Object.entries(CARRIERS))('%s: carries every unit with clear edges, nothing undecided', (_label, [path, render]) => {
    const result = edge(path, render(U));
    expect(result.issues).toEqual([]);
    expect(result).toMatchObject({ ok: true, extended: [], undecided: [], headingsMissing: [], interleaved: [] });
    expect(result.detail).toMatch(/^2 of 2 paragraphs and 2 of 2 list items present, 4 of them word for word; 2 of 2 headings present; /);
  });

  // The two reproductions QA recorded, and their siblings, in every format: each is refused, and names the unit.
  const ADDITIONS: [string, number, (text: string) => string][] = [
    ['words in front of a list item, reversing it', 2, text => 'Do not ' + lower(text)],
    ['words after a list item', 3, text => text + ', or never'],
    ['words in front of a paragraph', 0, text => 'It is a myth that you should ' + lower(text)],
    ['a sentence after a paragraph', 5, text => text + ' None of this is true.'],
  ];
  it.each(Object.entries(CARRIERS).flatMap(([label, [path, render]]) => ADDITIONS.map(([what, index, add]) => [`${label}: ${what}`, path, render, index, add] as const)))('%s is refused', (_label, path, render, index, add) => {
    const result = edge(path, render(U.map((text, at) => (at === index ? add(text) : text))));
    expect(result.ok).toBe(false);
    expect(rules(result)).toEqual(['extended']);
    expect(result.extended).toEqual([index]);
    expect(result.issues[0].detail).toBe(`1 of 4 paragraphs and list items have words directly before or after them in their line, element or string: ${index === 0 || index === 5 ? 'paragraph' : 'item'} ${index}. Each one must stand alone there, with nothing added`);
  });
  it.each(Object.entries(CARRIERS))('%s: a heading with words added to it is not carried, and two headings cannot spare one', (_label, [path, render]) => {
    const result = edge(path, render(U.map((text, at) => (at === 1 ? 'Do not ' + lower(text) : text))));
    expect(result.ok).toBe(false);
    expect(rules(result)).toEqual(['headings']);
    expect(result.headingsMissing).toEqual([1]);
    expect(result.issues[0].detail).toBe('1 of 2 headings are missing or do not stand alone, as written, on their line or in their element: heading 1');
  });
  it('an article with many headings tolerates one that is not carried as written, and says which', () => {
    const result = check(payload.markdown.replace('## Frequently asked questions', '## Not frequently asked questions'));
    expect(result.ok).toBe(true);
    expect(result.headingsMissing).toEqual([23]);
    expect(result.detail).toContain('7 of 8 headings present (not carried, by unit index, 23)');
  });

  // Ways of putting words beside a unit that leave it, by itself, word for word.
  const item = U[2]; const para = U[5];
  it.each<[string, string, string]>([
    ['Markdown: a soft-wrapped line above the paragraph', 'p.md', `Never do this:\n${para}\n`],
    ['Markdown: a lazy continuation line under a list item', 'p.md', `- ${item}\n  unless it is raining\n`],
    ['Markdown: emphasised words in front', 'p.md', `- **Do not** ${lower(item)}\n`],
    ['Markdown: a linked word in front', 'p.md', `- [Never](/why) ${lower(item)}\n`],
    ['Markdown: inline HTML in front', 'p.md', `- <strong>Do not</strong> ${lower(item)}\n`],
    ['Markdown: a quoted line that continues the paragraph', 'p.md', `> Ignore this:\n> ${para}\n`],
    ['Markdown: an indented bullet that Markdown reads as paragraph text', 'p.md', `Do not\n    - ${item}\n`],
    ['Markdown: a numbered line that cannot start a list there', 'p.md', `Skip step\n7. ${item}\n`],
    ['Markdown: an image on the next line', 'p.md', `${para}\n![Never trust this advice](/x.png)\n`],
    ['Markdown: a private-use character posing as a boundary', 'p.md', `- Do not \uE000${lower(item)}\uE000 ever\n`],
    ['HTML: words and the unit in one element', 'p.html', `<ul><li>Do not <span>${lower(item)}</span></li></ul>`],
    ['HTML: a line break is not a new element', 'p.html', `<p>Do not<br>${lower(item)}</p>`],
    ['HTML: a blank line inside an element is only white space', 'p.html', `<p>Ignore this.\n\n${para}</p>`],
    ['HTML in a JSON string: an escaped blank line is only white space too', 'p.json', JSON.stringify({ html: `<p>Ignore this.\n\n${para}</p>` })],
    ['TSX: text and a string in one element', 'p.tsx', `export const P = () => <li>Do not {${JSON.stringify(lower(item))}}</li>;\n`],
    ['TSX: two strings in one element', 'p.tsx', `export const P = () => <li>{'Do not '}{${JSON.stringify(lower(item))}}</li>;\n`],
    ['TSX: a blank line inside an element', 'p.tsx', `export const P = () => (\n  <p>\n    Ignore this.\n\n    ${para}\n  </p>\n);\n`],
    ['TypeScript: two strings joined with +', 'p.ts', `export const items = ['Do not ' + ${JSON.stringify(lower(item))}];\n`],
    ['TypeScript: a template with the unit in a placeholder', 'p.ts', 'export const items = [`Do not ${' + JSON.stringify(lower(item)) + '}`];\n'],
    ['TypeScript: a single line break inside one string', 'p.ts', `export const items = [${JSON.stringify('Do not\n' + lower(item))}];\n`],
    ['TypeScript: a quotation mark inside the string is not its end', 'p.ts', `export const items = ["Do not 'do this': ${lower(item)}"];\n`],
    ['TypeScript: the unit in a comment beside code', 'p.ts', `// ${item}\nexport const items = ['Something else'];\n`],
    ['YAML: a plain scalar on one line', 'p.yaml', `items:\n  - Do not ${lower(item)}\n`],
    ['YAML: a plain scalar continued on the next line', 'p.yaml', `text: Do not\n  ${lower(item)}\n`],
    ['YAML: a continuation line that looks like a key', 'p.yaml', `text: Do not\n  ever: ${lower(item)}\n`],
    ['YAML: a quoted scalar continued on a line that looks like a key', 'p.yaml', `text: "Do not\n  ever: ${lower(item)}"\n`],
    ['YAML: a line of a folded block that looks like a key', 'p.yaml', `text: >-\n  Do not\n  ever: ${lower(item)}\n`],
    ['a file of unknown type: words on the same line', 'p.txt', `Do not ${lower(item)}\n\n${para} None of this is true.\n`],
    ['no path at all: words on the same line', '', `Do not ${lower(item)}\n\n${para} None of this is true.\n`],
  ])('refuses %s', (_label, path, content) => {
    const blocks: Block[] = [['ul', [item]], ['p', para]];
    const result = edge(path || undefined, content + (content.includes(para) ? '' : `\n\n${path.endsWith('.html') ? `<p>${para}</p>` : /\.(?:tsx?|json)$/.test(path) ? '' : para}\n`), blocks);
    expect(result.ok).toBe(false);
    expect(result.extended.length + result.issues.filter(issue => issue.rule === 'omitted' || issue.rule === 'truncated').length).toBeGreaterThan(0);
    expect(result.extended).toContain(content.includes(item) || content.includes(lower(item)) ? 0 : 1);
  });

  it.each<[string, string, string]>([
    ['Markdown: no blank lines at all, each unit on its own line', 'p.md', `${U[0]}\n## ${U[1]}\n- ${U[2]}\n- ${U[3]}\n### ${U[4]}\n${U[5]}\n`],
    ['Markdown: Windows line endings', 'p.md', `${U[0]}\r\n\r\n## ${U[1]}\r\n\r\n- ${U[2]}\r\n- ${U[3]}\r\n\r\n### ${U[4]}\r\n\r\n${U[5]}\r\n`],
    ['Markdown: heading ids, nested and numbered lists, a quoted paragraph, a rule', 'p.md', `> ${U[0]}\n\n## ${U[1]} {#gutters}\n\n1. ${U[2]}\n   - ${U[3]}\n\n---\n\n### ${U[4]} ###\n\n${U[5]}\n`],
    ['Markdown: an underlined heading and an HTML block', 'p.md', `${U[1]}\n===\n\n<div class="note">\n\n${U[0]}\n\n</div>\n\n- ${U[2]}\n- ${U[3]}\n\n${U[4]}\n---\n\n${U[5]}\n`],
    ['a string holding several units, one per line', 'p.json', JSON.stringify({ body: [U[0], U[1], U[2], U[3], U[4], U[5]].join('\n') })],
    ['a list item split over two table cells', 'p.ts', `export const lede = [${q(U[0])}, ${q(U[1])}];\nexport const rows = [[${q(U[2].slice(0, 12))}, ${q(U[2].slice(13))}]];\nexport const rest = [${[3, 4, 5].map(at => q(U[at])).join(', ')}];\n`],
    ['strings joined with + across lines, in parentheses, and through a template placeholder', 'p.ts', `export const all = [${q(U[0])}, ${q(U[1])},\n  ${q(U[2].slice(0, 12))} +\n    ${q(U[2].slice(12))},\n  (${q(U[3].slice(0, 10))} + (${q(U[3].slice(10))})), ${q(U[4])},\n  \`${U[5].slice(0, 14)}\${${q(U[5].slice(14, U[5].indexOf(' after')))}}${U[5].slice(U[5].indexOf(' after'))}\`];\n`],
    ['JSON with escaped tags and slashes', 'p.json', JSON.stringify({ html: `<p>${U[0]}</p><h2>${U[1]}</h2><ul><li>${U[2]}</li><li>${U[3]}</li></ul><h3>${U[4]}</h3><p>${U[5]}</p>` }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\//g, '\\/')],
    ['YAML: front matter lists in a Markdown file', 'p.md', `---\nintro: "${U[0]}"\nsteps:\n  - title: ${U[1]}\n    items:\n      - ${U[2]}\n      - ${U[3]}\n  - title: ${U[4]}\n    text: >\n      ${U[5]}\n---\n\nRendered from the front matter.\n`],
    ['YAML: a literal block that holds Markdown', 'p.yml', `body: |\n  ${U[0]}\n\n  ## ${U[1]}\n\n  - ${U[2]}\n  - ${U[3]}\n\n  ### ${U[4]}\n\n  ${U[5]}\nauthor: Editorial team\n`],
    ['HTML: attribute values', 'p.html', `<section><step-list lede="${U[0]}" title='${U[1]}'></step-list><ul><li>${U[2]}</li><li>${U[3]}</li></ul><h3>${U[4]}</h3><p>${U[5]}</p></section>`],
  ])('accepts %s', (_label, path, content) => {
    const result = edge(path, content);
    expect(result.issues).toEqual([]);
    expect(result).toMatchObject({ ok: true, extended: [], undecided: [], headingsMissing: [] });
  });

  it('accepts two paragraphs on adjacent lines, and a wrapped line that begins like a numbered item', () => {
    const blocks: Block[] = [['p', 'We moved into the terrace in the spring of 2026. Then the rain came and it did not stop until the autumn.'], ['p', 'Nobody had cleared the gutters for years, and the first storm showed exactly where the water went.'], ['ul', ['Check the downpipes', 'Check the brackets']]];
    const [first, second] = [String(blocks[0][1]), String(blocks[1][1])];
    const wrapped = first.replace('spring of 2026. Then', 'spring of\n2026. Then');
    expect(wrapped).toContain('\n2026. Then');
    for (const [path, content] of [['p.md', `${wrapped}\n${second}\n\n- Check the downpipes\n- Check the brackets\n`], ['p.json', JSON.stringify({ body: `${first}\n${second}`, steps: ['Check the downpipes', 'Check the brackets'] })], ['p.yaml', `body: |\n  ${first}\n  ${second}\nsteps:\n  - Check the downpipes\n  - Check the brackets\n`]] as const) {
      expect([path, edge(path, content, blocks)]).toEqual([path, expect.objectContaining({ ok: true, extended: [], undecided: [] })]);
    }
    // The same two lines with one foreign word between them are not two whole units any more.
    expect(edge('p.md', `${first}\nAlso:\n${second}\n\n- Check the downpipes\n- Check the brackets\n`, blocks).extended).toEqual([0, 1]);
  });

  describe('where Radar cannot tell, it says so instead of passing silently', () => {
    // A title line and a footer that are not the article's: without them the file holds nothing but the units.
    const text = `Gutters, a short guide\n\n${U[0]}\n\n${U[1]}\n\n* ${U[2]}\n* ${U[3]}\n\n${U[4]}\n\n${U[5]}\n\nFiled under maintenance\n`;
    it('a file of a type it does not know: the units pass, every one disclosed as not decided', () => {
      for (const path of ['content/posts/gutters.txt', 'content/posts/gutters.rst', 'content/posts/gutters.toml', undefined]) {
        const result = edge(path, text);
        expect(result).toMatchObject({ ok: true, extended: [], undecided: [0, 1, 2, 3, 4, 5], counts: { undecided: 6 } });
        expect(result.detail).toContain('4 of them word for word (not decided for 6: only markup or line structure Radar does not classify separates unit 0, 1, 2, 3 and 2 more from the text beside them; check the diff for words added there); 2 of 2 headings present');
      }
      // The same text in a Markdown file is decided.
      expect(edge('content/posts/gutters.md', text)).toMatchObject({ ok: true, undecided: [], extended: [] });
      // A file that holds nothing but the article's units has nothing beside any of them, whatever its type.
      expect(edge('content/posts/gutters.txt', text.split('\n').slice(2, -3).join('\n'))).toMatchObject({ ok: true, undecided: [], extended: [] });
    });
    it('a unit set off from other words only by a component or custom element', () => {
      const mdx = `<Lede>Editor’s note</Lede><Lede>${U[0]}</Lede>\n\n## ${U[1]}\n\n- ${U[2]}\n- ${U[3]}\n\n### ${U[4]}\n\n<p>Updated <my-note>${U[5]}</my-note></p>\n`;
      const result = edge('content/blog/post.mdx', mdx);
      expect(result).toMatchObject({ ok: true, extended: [], undecided: [0, 5] });
      expect(result.detail).toContain('(not decided for 2: only markup or line structure Radar does not classify separates unit 0, 5 from the text beside them; check the diff for words added there)');
      // A standard inline element decides it the other way: that is one piece of text.
      expect(edge('content/blog/post.mdx', mdx.replace(/<\/?my-note>/g, match => match.replace('my-note', 'em'))).extended).toEqual([5]);
    });
    it('keeps the disclosure inside the bounds of a check detail', () => {
      const blocks = generatedArticle(31, 40);
      const result = edge('notes.txt', 'Notes\n\n' + blocksToMarkdown(blocks) + '\nEnd of notes\n', blocks);
      expect(result.ok).toBe(true);
      expect(result.undecided.length).toBeGreaterThan(40);
      expect(result.detail.length).toBeLessThan(440);
    });
  });

  it('marks boundaries where each format ends a piece of text, and nowhere a file asks for one', () => {
    const S = '\uE000'; const W = '\uE001';
    expect(markBoundaries('a.md', 'One\ntwo\n\n- item\n## Head\n')).toBe(`One\ntwo\n${S}\n${S}- ${S}item\n${S}##${S} Head${S}\n${S}`);
    expect(markBoundaries('a.html', '<p>One <b>two</b></p><x-y>z</x-y>')).toBe(`${S}<p>${S}One <b>two</b>${S}</p>${S}<x-y>${W}z${W}</x-y>${W}`);
    expect(markBoundaries('a.mdx', '<Steps items={["a b", "c d"]} title="t" />\n')).toBe(`${W}<Steps items={[${S}"a b"${S}, ${S}"c d"${S}]} title=${S}"t"${S} />${W}\n${S}`);
    expect(markBoundaries('a.tsx', 'const X = () => <li className="x">Do {"y"}</li>;')).toBe(`const X = () => ${S}<li className=${S}"x"${S}>${S}Do {"y"}${S}</li>${S};`);
    expect(markBoundaries('a.ts', 'const a = `Do ${"x y"} z`;')).toBe(`const a = ${S}\`Do \${"x y"} z\`${S};`);
    expect(markBoundaries('a.yaml', 'body: |\n  One\n\n  - a\nnext: "q\n  k: v"\n')).toBe(`${S}body:${S} |\n  One\n${S}\n${S}  - ${S}a\n${S}next:${S} "q\n  k: v"\n${S}`);
    expect(markBoundaries('a.ts', `const a = ['x' + "y", \`z\`]; // 'not a string'\n`)).toBe(`const a = [${S}'x' + "y"${S}, ${S}\`z\`${S}]; // 'not a string'\n`);
    expect(markBoundaries('a.json', '{"k": "one\\n\\ntwo"}')).toBe(`{${S}"k"${S}: ${S}"one\\n${S}\\ntwo"${S}}`);
    expect(markBoundaries('a.yaml', 'k: v\n  more\n- x\n')).toBe(`${S}k:${S} v\n  more\n${S}- ${S}x\n${S}`);
    expect(markBoundaries('a.txt', 'One\n\nTwo')).toBe(`One\n${W}\nTwo`);
    // Whatever the file holds, the two marker characters themselves never survive from it.
    expect(markBoundaries('a.md', `a${S}b${W}c`)).toBe('a b c');
  });

  it('stays fast on a megabyte of each kind of structure', () => {
    const started = Date.now();
    const noise = (unit: string) => unit.repeat(Math.ceil(900_000 / unit.length));
    for (const [path, filler] of [['a.md', '- x\n\n## y\n\n> z\n'], ['a.html', '<p>x</p><my-el a="b">y</my-el>'], ['a.ts', `["x", 'y' + "z", \`a\\nb\`],\n`], ['a.json', '"x\\n\\ny",\n'], ['a.yaml', 'k: v\n- x: |\n    y\n'], ['a.txt', 'x\n\n'], ['a.mdx', '<A b={["c", "d"]} />\n'], ['a.md', '<a b={{{{'], ['a.md', '------'], ['a.yaml', '- - - - ']] as const) {
      const result = checkArticleFidelity({ units, contents: [payload.markdown, noise(filler)], paths: ['content/post.md', path], articleAdded: payload.markdown });
      expect([path, result.issues]).toEqual([path, []]);
    }
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 60_000);
});

describe('fidelity on hostile input', () => {
  it('stays fast on a megabyte of unclosed markup, and still finds the article beside it', () => {
    const openers = ['<!--', '](<', ']( ', '](' + ' '.repeat(2000), '<http://', '<a ', '](a(b)', '](x "', '&#x', '\\u', '<', 'the '];
    const started = Date.now();
    for (const opener of openers) {
      const noise = opener.repeat(Math.ceil(900_000 / opener.length));
      expect(check([payload.markdown, noise], ARTICLE, payload.markdown).ok).toBe(true);
      expect(check([blocksToMarkdown(without(13)), noise], ARTICLE, payload.markdown).ok).toBe(false);
    }
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 30_000);
});

describe('media and links are reported, not failed', () => {
  it('finds every reference in the Markdown and HTML Radar renders', () => {
    expect(omittedMedia(payload, [payload.markdown])).toEqual([]);
    expect(omittedMedia(payload, [payload.html])).toEqual([]);
    expect(omittedMedia(payload, [JSON.stringify({ html: payload.html })])).toEqual([]);
  });
  it('lists the body image, video and sources a plain-string format could not carry', () => {
    const record = recordSource(toRecord(ARTICLE, payload));
    expect(check(record).ok).toBe(true);
    expect(omittedMedia(payload, [record])).toEqual([BODY_IMAGE.url, VIDEOS[0].id, SOURCES[0].url, SOURCES[1].url]);
  });
  it('lists links applied only to the HTML body, and counts a reference found in any changed file', () => {
    const html = payload.html.replace('covered market', '<a href="https://markets.example.org/saturday?stall=12&amp;view=map" rel="noopener">covered market</a>');
    const linked = { ...payload, html };
    expect(omittedMedia(linked, [payload.markdown])).toEqual(['https://markets.example.org/saturday?stall=12&view=map']);
    expect(omittedMedia(linked, [payload.markdown, 'export const links = ["https://markets.example.org/saturday?stall=12&view=map"];'])).toEqual([]);
    expect(omittedMedia(linked, [html])).toEqual([]);
  });
  it('bounds what it returns', () => {
    const sources = Array.from({ length: 150 }, (_, i) => ({ title: 'Source ' + i, url: `https://sources.example.org/${i}/` + 'x'.repeat(400) }));
    const omitted = omittedMedia({ html: '', bodyImages: [], videos: [], sources }, ['nothing']);
    expect(omitted).toHaveLength(FIDELITY.mediaListed);
    expect(omitted.every(value => value.length <= FIDELITY.mediaChars)).toBe(true);
  });
});
