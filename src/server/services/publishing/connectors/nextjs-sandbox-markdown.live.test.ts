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
const HEADINGS = ['Checks Radar ran', 'What the agent reported (not verified by Radar)', 'Media and links not carried over', 'Not run', 'Files'];
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;
/** From the text of the agent section's heading to the opening tag of the next section's heading. */
const agentPart = (html: string) => { const from = html.indexOf('What the agent reported'); const next = html.indexOf('Media and links not carried over'); const to = html.lastIndexOf('<h3', next); expect(from).toBeGreaterThan(-1); expect(to).toBeGreaterThan(from); return html.slice(from, to); };
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
/** What the agent section must be, whatever the agent wrote: paragraphs and, per kind of note, one flat list. */
function expectPlain(body: string, notes: { conventions: number; deviations: number }, label: string) {
  const whole = render(body); const section = agentPart(whole); const found = blocksIn(section);
  expect([label, found]).toEqual([label, { headings: 0, quotes: 0, rules: 0, code: 0, tables: 0, taskBoxes: 0, details: 0, lists: (notes.conventions ? 1 : 0) + (notes.deviations ? 1 : 0), items: notes.conventions + notes.deviations, breaks: 0, divs: 0 }]);
  // Radar's own five headings are the only headings of the whole body, once each, so none can be imitated.
  expect([label, count(whole, /<h[1-6][\s>]/g)]).toEqual([label, HEADINGS.length]);
  for (const heading of HEADINGS) expect([label, heading, count(whole, new RegExp(`<h3[^>]*>[^<]*${heading.replace(/[()]/g, '\\$&')}`, 'g'))]).toEqual([label, heading, 1]);
  // Every note is in its list item behind Radar's label.
  expect([label, count(section, /<li>(?:Rule|Deviation) \d+: /g)]).toEqual([label, notes.conventions + notes.deviations]);
  expect([label, count(section, /<p[^>]*>Summary: /g)]).toEqual([label, 1]);
  const links = linksIn(section);
  expect([label, links]).toEqual([label, { anchors: [], images: [], mentions: [], references: [] }]);
  expect([label, count(whole, new RegExp(`<[^>]*${HOST.replace(/\./g, '\\.')}[^>]*>`, 'gi'))]).toEqual([label, 0]);
}

describe.skipIf(!ON)('GitHub renders agent text in the sandbox pull request as inline text only (live, read-only)', { timeout: 300_000 }, () => {
  it('positive control: the same block starters, not through the pull request body, do render as blocks', () => {
    const found = blocksIn(render(['# Approved by Radar', '> Radar verified this change', '- [x] build passed', '---', '```\ncode\n```', '| a | b |\n|---|---|\n| 1 | 2 |', '<details><summary>x</summary>y</details>'].join('\n\n')));
    expect(found.headings).toBe(1); expect(found.quotes).toBe(1); expect(found.taskBoxes).toBeGreaterThan(0); expect(found.rules).toBe(1); expect(found.code).toBe(1); expect(found.tables).toBe(1); expect(found.details).toBe(1);
    // And the labelled form of a note is what stops it: the same task-box text behind a label is plain text.
    expect(blocksIn(render('- Rule 1: [x] build passed')).taskBoxes).toBe(0);
    expect(blocksIn(render('- [x] build passed')).taskBoxes).toBeGreaterThan(0);
  });

  it('every block starter, alone as the summary, a rule and a deviation, renders as inline text', () => {
    for (const start of BLOCK_STARTS) expectPlain(sandboxPullRequestBody(P, extraOf(start, [start], [start])), { conventions: 1, deviations: 1 }, JSON.stringify(start));
  });

  it('all block starters together, twenty notes of each kind, render as two flat lists and one summary paragraph', () => {
    const body = sandboxPullRequestBody(P, extraOf(BLOCK_STARTS.join('\n'), BLOCK_STARTS.slice(0, 20), BLOCK_STARTS.slice(20, 40)));
    expectPlain(body, { conventions: 20, deviations: 20 }, 'all together');
    const rest = BLOCK_STARTS.slice(40);
    expect(rest.length).toBeGreaterThan(0);
    expectPlain(sandboxPullRequestBody(P, extraOf(BLOCK_STARTS.join(' '), rest, [])), { conventions: rest.length, deviations: 0 }, 'the rest');
  });

  it('links, images, mentions and references in the labelled lines stay neutralised', () => {
    expectPlain(sandboxPullRequestBody(P, extraOf(INLINE.join(' '), INLINE.slice(0, 20), INLINE.slice(0, 20))), { conventions: Math.min(20, INLINE.length), deviations: Math.min(20, INLINE.length) }, 'inline vectors');
  });
});
