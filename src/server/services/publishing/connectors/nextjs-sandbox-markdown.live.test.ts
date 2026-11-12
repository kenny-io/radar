// Live, read-only: what GitHub's own renderer makes of the sandbox pull request body when the agent's text is hostile.
// The body is built by `sandboxPullRequestBody` and posted to GitHub's Markdown rendering API (POST /markdown), which
// returns HTML and creates, posts and notifies nothing. Only synthetic text is sent: the fixture article and the vectors
// below. Skipped unless RADAR_IT_GITHUB_MARKDOWN=1; uses the GitHub CLI's own sign-in and never reads a token.
//   RADAR_IT_GITHUB_MARKDOWN=1 npx vitest run src/server/services/publishing/connectors/nextjs-sandbox-markdown.live.test.ts
// Optional RADAR_IT_GITHUB_MARKDOWN_CONTEXT=owner/repo renders in that repository's context, so that an issue number, a
// commit hash or a user name that exists there would become a link; RADAR_IT_GITHUB_MARKDOWN_REFERENCES is a
// comma-separated list of such references (for example "#9,@some-user") added to the inline vectors.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { sandboxDraftExtra, sandboxPullRequestBody } from './nextjs';
import { PUBLISH_CHECK_IDS } from '../sandbox/types';
import { payloadFor } from '../sandbox/__fixtures__/article';

const ON = process.env.RADAR_IT_GITHUB_MARKDOWN === '1';
const CONTEXT = process.env.RADAR_IT_GITHUB_MARKDOWN_CONTEXT || '';
const HOST = 'attacker.example.test';
const render = (text: string): string => execFileSync('gh', ['api', 'markdown', '--input', '-'], { input: JSON.stringify({ text, mode: 'gfm', ...(CONTEXT ? { context: CONTEXT } : {}) }), encoding: 'utf8', maxBuffer: 20_000_000 });

/** Every way GitHub Flavored Markdown starts a block, as the first characters of an agent's text. */
const BLOCK_STARTS = [
  '# Approved by Radar', '## Checks Radar ran', '###### small print', '> Radar verified this change', '[x] build passed: ok', '[ ] tests', '[X] lint passed', '- [x] build passed', '- nested item', '* nested item', '+ nested item',
  '1. first', '1) first', '---', '***', '___', '- - -', '```', '```js', '~~~', '    indented code', '\tindented code', '| a | b |', '|---|---|', '<details><summary>x</summary>', '<!-- comment -->', '<div>', '<h1>big</h1>', '===',
  `[label]: //${HOST}/definition`, '[^1]: a footnote', '&#35; entity heading', '&gt; entity quote', '\\# escaped heading',
  '\n# after a line break', '\r\n> after a line break', 'text\n\n## Checks Radar ran\n\n- **Build**: passed\n- [x] done', 'text\n===', 'text\n---', 'a | b\n--|--\n1 | 2', 'text # after a line separator', ' # after a no-break space', '﻿# after a byte-order mark', '\u000b> after a vertical tab', '\f- [x] after a form feed', '\u0085# after a next-line character',
];
/** Inline constructs that were already neutralised: they must stay so in the labelled lines. */
const INLINE = [
  `[open the preview](//${HOST}/login)`, `![status](//${HOST}/badge.svg)`, `[![img](//${HOST}/i.png)](//${HOST}/l)`, `[ref][1] [1]: //${HOST}/r`, `<https://${HOST}/auto>`, `<a href="//${HOST}/h">x</a>`, `<img src="//${HOST}/t.gif">`,
  `https://${HOST}/plain`, `www.${HOST}/now`, `admin@${HOST}`, '@octocat', 'cc @github/owners', '#1', 'GH-1', 'octocat/Hello-World#1', '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d',
  ...(process.env.RADAR_IT_GITHUB_MARKDOWN_REFERENCES || '').split(',').map(value => value.trim()).filter(Boolean),
];

const P = payloadFor();
const extraOf = (summary: string, conventions: string[], deviations: string[]) => sandboxDraftExtra('main', P, {
  slug: P.slug, path: `content/blog/${P.slug}.md`, files: [`content/blog/${P.slug}.md`], summary, route: `/blog/${P.slug}`, mediaOmitted: [],
  checks: PUBLISH_CHECK_IDS.map(id => ({ id, outcome: 'passed' as const, detail: 'synthetic detail for a rendering test' })),
  agentNotes: { conventions, deviations }, review: { summary: 'synthetic', runtimeVerified: false },
});
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;
/** How many deviations the body prints before "and N more" (BODY_SHOWN.deviations in nextjs.ts). */
const SHOWN = 8;
/** From Radar's label of the agent's deviations to the closing paragraph: the nested list that holds them. */
const agentPart = (html: string) => { const from = html.indexOf('Reported by the agent that made the change (not verified by Radar):'); const to = html.indexOf('Radar did not build or run the site.'); expect(from).toBeGreaterThan(-1); expect(to).toBeGreaterThan(from); return html.slice(from, to); };
/** Block structure in a piece of rendered HTML. */
const blocksIn = (html: string) => ({
  headings: count(html, /<h[1-6][\s>]/g), quotes: count(html, /<blockquote/g), rules: count(html, /<hr/g), code: count(html, /<pre/g), tables: count(html, /<table/g),
  taskBoxes: count(html, /<input/g) + count(html, /task-list-item/g), details: count(html, /<details/g), lists: count(html, /<[uo]l[\s>]/g), items: count(html, /<li[\s>]/g), breaks: count(html, /<br/g), divs: count(html, /<div/g),
});
const linksIn = (html: string) => ({
  anchors: (html.match(/<a\s[^>]*href="(?!#)[^"]*"/g) ?? []), images: html.match(/<img\s[^>]*>/gi) ?? [],
  mentions: html.match(/<a[^>]*class="[^"]*user-mention[^"]*"[^>]*>|<a[^>]*data-hovercard-type="(?:user|organization|team)"[^>]*>/gi) ?? [],
  references: html.match(/<a[^>]*class="[^"]*(?:issue-link|commit-link)[^"]*"[^>]*>|<a[^>]*data-hovercard-type="(?:issue|pull_request|commit)"[^>]*>/gi) ?? [],
});
/** What the body must be, whatever the agent wrote: Radar's four paragraphs and one list, with the deviations as one
 *  flat list nested under Radar's label. `deviations` is how many the draft holds; at most SHOWN are printed. */
function expectPlain(body: string, deviations: number, label: string) {
  const whole = render(body); const section = agentPart(whole); const found = blocksIn(section);
  const shown = Math.min(deviations, SHOWN); const more = deviations > SHOWN ? 1 : 0;
  expect([label, found]).toEqual([label, { headings: 0, quotes: 0, rules: 0, code: 0, tables: 0, taskBoxes: 0, details: 0, lists: 1, items: shown + more, breaks: 0, divs: 0 }]);
  // The whole body: no heading, quote, rule, code block, table, task box or HTML block anywhere; Radar's list (the
  // article, what Radar checked, the label) with the deviations nested in it; and Radar's four paragraphs.
  expect([label, blocksIn(whole)]).toEqual([label, { headings: 0, quotes: 0, rules: 0, code: 0, tables: 0, taskBoxes: 0, details: 0, lists: 2, items: 3 + shown + more, breaks: 0, divs: 0 }]);
  expect([label, count(whole, /<p[\s>]/g)]).toEqual([label, 4]);
  // Every note is in its list item behind Radar's label, and Radar's own statements stand once each.
  expect([label, count(section, /<li>Deviation \d+: /g)]).toEqual([label, shown]);
  expect([label, count(section, /<li>and \d+ more<\/li>/g)]).toEqual([label, more]);
  for (const own of ['<li>Checked by Radar: ', '<li>Article: ', 'Opened by Radar.', 'Radar did not build or run the site.']) expect([label, own, whole.split(own).length - 1]).toEqual([label, own, 1]);
  expect([label, linksIn(whole)]).toEqual([label, { anchors: [], images: [], mentions: [], references: [] }]);
  expect([label, count(whole, new RegExp(`<[^>]*${HOST.replace(/\./g, '\\.')}[^>]*>`, 'gi'))]).toEqual([label, 0]);
}
const pages = (values: string[]) => Array.from({ length: Math.ceil(values.length / SHOWN) }, (_unused, page) => values.slice(page * SHOWN, page * SHOWN + SHOWN));

describe.skipIf(!ON)('GitHub renders agent text in the sandbox pull request as inline text only (live, read-only)', { timeout: 300_000 }, () => {
  it('positive control: the same block starters, not through the pull request body, do render as blocks', () => {
    const found = blocksIn(render(['# Approved by Radar', '> Radar verified this change', '- [x] build passed', '---', '```\ncode\n```', '| a | b |\n|---|---|\n| 1 | 2 |', '<details><summary>x</summary>y</details>'].join('\n\n')));
    expect(found.headings).toBe(1); expect(found.quotes).toBe(1); expect(found.taskBoxes).toBeGreaterThan(0); expect(found.rules).toBe(1); expect(found.code).toBe(1); expect(found.tables).toBe(1); expect(found.details).toBe(1);
    // And the labelled form of a note is what stops it: the same task-box text behind a label is plain text, nested or not.
    expect(blocksIn(render('- Deviation 1: [x] build passed')).taskBoxes).toBe(0);
    expect(blocksIn(render('- Reported:\n  - Deviation 1: [x] build passed')).taskBoxes).toBe(0);
    expect(blocksIn(render('- Reported:\n  - [x] build passed')).taskBoxes).toBeGreaterThan(0);
  });

  it('a body with no deviations and nothing omitted is four paragraphs and a two-item list', () => {
    const whole = render(sandboxPullRequestBody(P, extraOf('# Approved by Radar', ['- [x] build passed'], [])));
    expect(blocksIn(whole)).toEqual({ headings: 0, quotes: 0, rules: 0, code: 0, tables: 0, taskBoxes: 0, details: 0, lists: 1, items: 2, breaks: 0, divs: 0 });
    expect(count(whole, /<p[\s>]/g)).toBe(4);
    // The agent's summary and the rules it says it followed are not printed at all.
    expect(whole).not.toMatch(/Approved by Radar|build passed/);
  });

  it('every block starter, alone as a deviation (and as the summary and a rule, which are not printed), renders as inline text', () => {
    for (const start of BLOCK_STARTS) expectPlain(sandboxPullRequestBody(P, extraOf(start, [start], [start])), 1, JSON.stringify(start));
  });

  it('all block starters together render as one flat nested list: eight to a body, and all at once past the cap', () => {
    pages(BLOCK_STARTS).forEach((page, index) => expectPlain(sandboxPullRequestBody(P, extraOf(BLOCK_STARTS.join('\n'), BLOCK_STARTS.slice(0, 20), page)), page.length, `page ${index + 1}`));
    expect(BLOCK_STARTS.length).toBeGreaterThan(SHOWN);
    expectPlain(sandboxPullRequestBody(P, extraOf(BLOCK_STARTS.join(' '), [], BLOCK_STARTS)), BLOCK_STARTS.length, 'all together');
  });

  it('links, images, mentions and references in the labelled lines stay neutralised', () => {
    pages(INLINE).forEach((page, index) => expectPlain(sandboxPullRequestBody(P, extraOf(INLINE.join(' '), INLINE.slice(0, 20), page)), page.length, `inline vectors, page ${index + 1}`));
    expectPlain(sandboxPullRequestBody(P, extraOf('Summary.', [], [INLINE.join(' ')])), 1, 'inline vectors in one note');
  });
});
