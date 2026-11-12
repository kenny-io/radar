import { describe, expect, it } from 'vitest';
import type { Block } from '@/lib/types';
import { blocksToHtml, blocksToMarkdown } from '../render';
import { FIDELITY, articleUnits, checkArticleFidelity, omittedMedia } from './fidelity';
import { ARTICLE, BODY_IMAGE, PARAPHRASED, SOURCES, VIDEOS, generatedArticle, paragraph, payloadFor, seeded } from './__fixtures__/article';
import { recordSource, toRecord } from './__fixtures__/typedRegistry';
import { mdxPost } from './__fixtures__/mdxAudit';

const payload = payloadFor();
const units = articleUnits(ARTICLE);
/** Fidelity of one or more final files against the fixture article. `articleAdded` defaults to the first file, as for a new article file. */
const check = (contents: string | string[], blocks: Block[] = ARTICLE, articleAdded?: string | null) => {
  const list = Array.isArray(contents) ? contents : [contents];
  return checkArticleFidelity({ units: articleUnits(blocks), contents: list, articleAdded: articleAdded === undefined ? list[0] : articleAdded });
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
