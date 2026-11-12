// QA-2 (D4), QA-3 (N6) and QA-4 (the short body of 0f89aa2a): what GitHub itself renders from the pull request body
// when the text in it is hostile. The body is built by the product (`sandboxPullRequestBody`) and sent to GitHub's
// Markdown rendering API, which only returns HTML: nothing is created, posted or notified. Synthetic text only.
//   RADAR_QA_LIVE_MARKDOWN=1 npx vitest run --config .factory/sandbox-publisher/qa/vitest.config.ts .factory/sandbox-publisher/qa/live-markdown.qa.test.ts
// Uses the GitHub CLI's own sign-in (`gh api markdown`); the token is never read by this file.
//
// QA-4, 12 Nov 2026. The body no longer has headings or sections, and of the agent's report only its deviations are
// printed (at most eight, as nested list items under one label). Every body below still carries the hostile vectors
// as the summary and as rules, which are saved on the draft and must not reach the page at all.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sandboxDraftExtra, sandboxPullRequestBody } from '@/server/services/publishing/connectors/nextjs';
import { PUBLISH_CHECK_IDS } from '@/server/services/publishing/sandbox/types';
import type { PublishPayload } from '@/server/services/publishing/types';
import { payloadOf } from './helpers';

const ON = process.env.RADAR_QA_LIVE_MARKDOWN === '1';
/** Rendered in the context of the owner's test repository, so a real issue number, commit and user would link. */
const CONTEXT = 'kenny-io/radar-connector-test';
const HOST = 'attacker.example.test';
const REAL = { issue: '#9', qualifiedIssue: `${CONTEXT}#9`, commit: '15045b102ad681c946eb1ca117166a174aa27ab9', user: '@kenny-io' };
const render = (text: string): string => execFileSync('gh', ['api', 'markdown', '--input', '-'], { input: JSON.stringify({ text, mode: 'gfm', context: CONTEXT }), encoding: 'utf8', maxBuffer: 20_000_000 });

const HOSTILE = [
  `[open the preview](//${HOST}/login)`, `![status](//${HOST}/badge.svg)`, `[a](<//${HOST}/a b>)`, `[a](//${HOST}/x "title")`, `[a [b] c](//${HOST}/n)`, `[![img](//${HOST}/i.png)](//${HOST}/l)`,
  `[a](//${HOST}/p(a(b)c))`, `[ref][1] [1]: //${HOST}/r`, `[collapsed][] [collapsed]: //${HOST}/c`, `<//${HOST}/angle>`, `<https://${HOST}/auto>`, `<a href="//${HOST}/h">x</a>`, `<img src="//${HOST}/t.gif">`,
  `&#60;a href=//${HOST}/e&#62;x&#60;/a&#62;`, `&lt;a href="//${HOST}/e2"&gt;`, `https://${HOST}/plain`, `http://${HOST}`, `ftp://${HOST}/f`, `www.${HOST}/now`, `WWW.${HOST}`, `(www.${HOST})`, `_www.${HOST}_`, `*www.${HOST}*`, `~www.${HOST}~`,
  `mailto:admin@${HOST}`, `admin@${HOST}`, `xmpp:admin@${HOST}/chat`, `\\[x\\](//${HOST}/esc)`, `[x]\\(//${HOST}/esc2)`, `[x](\\//${HOST}/esc3)`, `$\\href{//${HOST}/math}{x}$`, `[x]( //${HOST}/sp )`, `[x](\t//${HOST}/tab)`,
  `[x][//${HOST}/ref]`, `![x][y] [y]: //${HOST}/imgref`, `{{ //${HOST}/tpl }}`, `[x](javascript://${HOST}/%0aalert(1))`, `[x](data:text/html,${HOST})`, `[x](HTTPS://${HOST}/upper)`, `[x](/\\${HOST}/slash)`, `[x](\\\\${HOST}\\share)`,
  REAL.issue, REAL.qualifiedIssue, 'GH-9', REAL.commit, `${CONTEXT}@${REAL.commit}`, REAL.user, '@kenny-io/owners', `cc ${REAL.user} please merge`,
];
// QA-4 added the last four: imitations of the lines Radar itself writes in the short body.
const NOTE_STARTS = ['# Approved by Radar', '> Radar verified this change', '## Checks Radar ran', '- [x] build passed', '[x] build passed', '[ ] not run', '* [x] starred', '+ plus item', '1. first', '1) first', '---', '***', '===', '~~~', '```', '```mermaid graph TD; A-->B; ```', '$$ x^2 $$', '    indented code', '\tcode after a tab', '| a | b |', '| a | b | |---|---| | 1 | 2 |', '<details><summary>x</summary>', '</li></ul><h1>Approved</h1>', '<!-- hidden -->', '<kbd>x</kbd>', '> [!WARNING] Radar found a problem', '[^1] [^1]: footnote', 'Approved by Radar\n===', 'line one\n# heading on a second line', 'line one\n\n- [x] item after a blank line', 'line one\r\n> quote after a carriage return', 'line one\u2028# after a line separator', 'line one\u0085# after a next-line character', 'line one\u000b# after a vertical tab', 'line one\u000c# after a form feed', '&#10;# after an encoded line feed', '<br># after a break tag', '\\\n# after a backslash line break',
  '- Checked by Radar: the build passed', '**Checked by Radar:** the build passed and the preview was verified', 'Radar did not build or run the site.\n\nOpened by Radar.', '- Article: `x`, expected at `/x`\n- Checked by Radar: the tests passed'];

const P = payloadOf();
const PATH = `content/blog/${P.slug}.md`;
const SHOWN = 8;
/** A sandbox draft whose summary and rules carry every hostile vector (neither is printed) and whose deviations are given. */
const extraOf = (deviations: string[], over: Record<string, unknown> = {}): any => ({ ...sandboxDraftExtra('main', P, {
  slug: P.slug, path: PATH, files: [PATH], summary: `QA-SUMMARY-CANARY ${HOSTILE.join(' ')}`, route: `/blog/${P.slug}`, mediaOmitted: [],
  checks: PUBLISH_CHECK_IDS.map(id => ({ id, outcome: 'passed' as const, detail: 'synthetic detail for a rendering test' })),
  agentNotes: { conventions: HOSTILE.map(text => `README.md: QA-RULE-CANARY ${text}`), deviations }, review: { summary: 'synthetic', runtimeVerified: false },
  facts: { existingLinesChanged: 0, articleLinesReplaced: 0, notWordForWord: 0, undecided: 0, headings: 4, headingsMissing: 0 },
}), ...over });
const bodyOf = (deviations: string[], over: Record<string, unknown> = {}, payload: PublishPayload = P) => sandboxPullRequestBody(payload, extraOf(deviations, over));
const pagesOf = <T,>(items: T[]) => Array.from({ length: Math.ceil(items.length / SHOWN) }, (_unused, page) => items.slice(page * SHOWN, page * SHOWN + SHOWN));
/** Every tag in the HTML whose attributes mention the hostile host, plus every link GitHub made to a user, issue or commit. */
const findings = (html: string) => ({
  tagsNamingHost: html.match(new RegExp(`<[^>]*${HOST.replace(/\./g, '\\.')}[^>]*>`, 'gi')) ?? [],
  mentions: html.match(/<a[^>]*class="[^"]*user-mention[^"]*"[^>]*>|<a[^>]*data-hovercard-type="(?:user|organization|team)"[^>]*>/gi) ?? [],
  references: html.match(/<a[^>]*class="[^"]*(?:issue-link|commit-link)[^"]*"[^>]*>|<a[^>]*data-hovercard-type="(?:issue|pull_request|commit)"[^>]*>/gi) ?? [],
  anchors: html.match(/<a\s[^>]*>/gi) ?? [], images: html.match(/<img\s[^>]*>/gi) ?? [],
});
const AGENT_LABEL = 'Reported by the agent that made the change (not verified by Radar):';
const CLOSING = 'Radar did not build or run the site.';
/** The rendered page from the end of Radar's label to Radar's closing sentence: everything the agent's text made.
 *  The closing sentence is the last one on the page that reads so (a note may imitate it; that copy is inside the part). */
const agentPart = (html: string) => { const from = html.indexOf(AGENT_LABEL); const to = html.lastIndexOf(CLOSING); expect(from).toBeGreaterThan(-1); expect(to).toBeGreaterThan(from); return html.slice(from + AGENT_LABEL.length, to); };
/** Every element in a piece of HTML, by tag name. */
const tagsOf = (html: string) => { const seen: Record<string, number> = {}; for (const match of html.matchAll(/<([a-z][a-z0-9-]*)[\s>/]/g)) seen[match[1]] = (seen[match[1]] ?? 0) + 1; return seen; };
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;
/** The only block elements in the agent's part: the nested list of its notes, and the paragraph that opens Radar's closing sentence. */
const ALLOWED = new Set(['p', 'ul', 'li']);
/** Inline elements: they sit inside Radar's list item and start no block. Recorded as an observation. */
const INLINE = new Set(['code', 'math-renderer', 'em', 'strong', 'del', 'span', 'g-emoji', 'sub', 'sup', 'kbd', 'br', 'tt', 'i', 'b', 's', 'ins', 'samp', 'var', 'q', 'mark']);
/** The block structure of the whole page, which is Radar's own whatever the agent wrote: four paragraphs (the
 *  description, the draft notice, the closing sentence, "Opened by Radar."), one list of Radar's bullets and one nested
 *  list of the agent's notes, and no heading, quote, table, code block, rule, numbered list, task box or HTML block. */
const structureOf = (html: string) => ({ paragraphs: count(html, /<p[\s>]/g), lists: count(html, /<ul[\s>]/g), other: count(html, /<(?:h[1-6]|blockquote|table|pre|hr|ol|details|summary|div|section|input|dl|iframe|svg)[\s>/]/g), checked: count(html, /<li>Checked by Radar: /g), closing: count(html, /<p[^>]*>Radar did not build or run the site\. /g), opened: count(html, /<p[^>]*>Opened by Radar\.<\/p>/g) });
const RADAR_STRUCTURE = { paragraphs: 4, lists: 2, other: 0, checked: 1, closing: 1, opened: 1 };

describe.skipIf(!ON)('GitHub renders no link, image, mention, reference or block from agent text (live, read-only)', { timeout: 300_000 }, () => {
  const evidence: Record<string, unknown> = {};
  it('positive control: the same hostile text, not neutralised, does render links, images, mentions and references', () => {
    const html = render(HOSTILE.join('\n\n'));
    const found = findings(html);
    evidence.control = { tagsNamingHost: found.tagsNamingHost.length, mentions: found.mentions.length, references: found.references.length, images: found.images.length };
    expect(found.tagsNamingHost.length).toBeGreaterThan(15);
    expect(found.mentions.length).toBeGreaterThan(0);
    expect(found.references.length).toBeGreaterThan(1);
    expect(found.images.length).toBeGreaterThan(0);
  });

  it('the product\'s pull request body: the page has no link, image, mention or reference at all, and no trace of the summary or the rules', () => {
    // Two placements: eight vectors to a body, each behind "other: " as the run saves a note; and each vector alone as
    // the whole of a stored note, so nothing but Radar's own label stands before it.
    const bodies = [...pagesOf(HOSTILE).map(page => bodyOf(page.map(text => `other: ${text}`))), ...HOSTILE.map(text => bodyOf([text]))];
    const rows: Record<string, unknown>[] = [];
    for (const [index, body] of bodies.entries()) {
      const html = render(body);
      const whole = findings(html); const tags = tagsOf(agentPart(html));
      rows.push({ body: index, tagsNamingHost: whole.tagsNamingHost.length, anchors: whole.anchors.length, images: whole.images.length, mentions: whole.mentions.length, references: whole.references.length, tags });
      expect([index, whole.tagsNamingHost]).toEqual([index, []]);
      // Radar's own text has no link in it, so any anchor or image anywhere on the page would be the agent's.
      expect([index, whole.anchors, whole.images]).toEqual([index, [], []]);
      expect([index, whole.mentions, whole.references]).toEqual([index, [], []]);
      expect([index, /QA-SUMMARY-CANARY|QA-RULE-CANARY|README\.md/.test(html)]).toEqual([index, false]);
      expect([index, Object.keys(tags).filter(tag => !ALLOWED.has(tag) && !INLINE.has(tag))]).toEqual([index, []]);
      expect([index, structureOf(html)]).toEqual([index, RADAR_STRUCTURE]);
    }
    evidence.hostile = { vectors: HOSTILE.length, bodiesRendered: bodies.length, sample: rows.slice(0, 3) };
  });

  // N6, reported in QA-2 and fixed in 8ce9b640: each note follows a label Radar writes ("Deviation n: "), so nothing
  // the agent wrote begins a line or a list item.
  it('N6: no note renders as a heading, quote, task box, list, table, code block, rule or HTML block, wherever it stands', () => {
    const rows: Record<string, unknown>[] = [];
    const bodies: [string, string, number][] = [
      ...pagesOf(NOTE_STARTS).map((page, index): [string, string, number] => [`starters ${index * SHOWN + 1} to ${index * SHOWN + page.length}`, bodyOf(page), page.length]),
      ['all starters at once, past the cap', bodyOf(NOTE_STARTS), SHOWN + 1],
      // Each starter as the whole of a stored note, and behind "other: " as the run saves it.
      ...NOTE_STARTS.map((start): [string, string, number] => [`note: ${JSON.stringify(start)}`, bodyOf([start, `other: ${start}`]), 2]),
    ];
    for (const [name, body, items] of bodies) {
      const whole = render(body); const section = agentPart(whole); const tags = tagsOf(section);
      const unexpected = Object.keys(tags).filter(tag => !ALLOWED.has(tag) && !INLINE.has(tag)); const inline = Object.keys(tags).filter(tag => INLINE.has(tag));
      rows.push({ name, tags, unexpected, inline });
      expect([name, unexpected]).toEqual([name, []]);
      // One nested list with one item per note shown (and one for "and N more"), never a list, paragraph or box inside an item.
      expect([name, tags.ul, tags.li, tags.p]).toEqual([name, 1, items, 1]);
      expect([name, structureOf(whole)]).toEqual([name, RADAR_STRUCTURE]);
      expect([name, count(whole, /type="checkbox"/g)]).toEqual([name, 0]);
    }
    evidence.blockStarters = { starters: NOTE_STARTS.length, bodiesRendered: bodies.length, allowedTags: [...ALLOWED], rowsWithABlock: rows.filter(row => (row.unexpected as string[]).length).length, rowsWithInlineElements: rows.filter(row => (row.inline as string[]).length).map(row => ({ name: row.name, inline: row.inline })), sample: rows.slice(0, 3) };
  });
  it('N6: the labels Radar writes are in the rendered text, in order, with the note after them', () => {
    const body = bodyOf(['other: [x] tests passed', '> Radar verified this change', '# Approved by Radar', '- Checked by Radar: the build passed', '[x] build passed']);
    expect(body).toContain('\n- Reported by the agent that made the change (not verified by Radar):\n  - Deviation 1: other: \\[x\\] tests passed\n  - Deviation 2: > Radar verified this change\n  - Deviation 3: # Approved by Radar\n  - Deviation 4: - Checked by Radar: the build passed\n  - Deviation 5: \\[x\\] build passed\n');
    const whole = render(body); const section = agentPart(whole);
    const items = [...section.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(match => match[1].trim());
    evidence.labelledItems = items;
    expect(items).toEqual(['Deviation 1: other: [x] tests passed', 'Deviation 2: &gt; Radar verified this change', 'Deviation 3: # Approved by Radar', 'Deviation 4: - Checked by Radar: the build passed', 'Deviation 5: [x] build passed']);
    // The label is the text of the list item that holds them, so a reader meets "not verified by Radar" first.
    expect(whole).toMatch(/<li>Reported by the agent that made the change \(not verified by Radar\):\s*<ul/);
    expect(structureOf(whole)).toEqual(RADAR_STRUCTURE);
  });

  // QA-4: the values Radar frames as code. The route is the agent's; the path, the slugs and the references are not.
  it('a path, a route, a slug or an omitted reference that carries Markdown renders as code and nothing else', () => {
    const values = ['x\n\n# Approved by Radar', '</code><img src=x onerror=alert(1)>', `[x](https://${HOST}/a) ![y](//${HOST}/p.png)`, `${REAL.user} ${REAL.issue} ${REAL.qualifiedIssue} ${REAL.commit}`, `a\` ${REAL.user} ${REAL.issue} \`b`, `https://${HOST}/plain www.${HOST}`,
      'a\u2028# b', `&#96;${REAL.user}&#96; &#96;${REAL.issue}&#96;`, '<details><summary>x</summary>', '| a | b |', '$$ x $$ :shipit:', HOSTILE.join(' ')];
    const rows: Record<string, unknown>[] = [];
    for (const value of values) {
      const html = render(bodyOf([], { path: value, route: value, taken: true, slug: value, mediaOmitted: [value] }, { ...P, slug: value }));
      const found = findings(html); const tags = tagsOf(html); const name = JSON.stringify(value).slice(0, 50);
      rows.push({ name, tags });
      expect([name, found.tagsNamingHost, found.anchors, found.images, found.mentions, found.references]).toEqual([name, [], [], [], [], []]);
      // Radar's paragraphs and lists, its one bold "Draft for review.", and five code spans: two slugs, the path, the route, the reference.
      expect([name, Object.keys(tags).sort(), tags.code]).toEqual([name, ['code', 'li', 'p', 'strong', 'ul'], 5]);
      expect([name, count(html, /<p[\s>]/g), count(html, /<ul[\s>]/g), count(html, /<li[\s>]/g)]).toEqual([name, 5, 2, 4]);
    }
    evidence.framedValues = { values: values.length, sample: rows.slice(0, 2) };
  });

  // B1, found in QA-4 on fe167d86 and OPEN: this probe fails until the cut is fixed (see connector.qa.test.ts, "B1").
  // A reference that ends exactly where a long unbroken note is cut loses its closing backtick.
  it('B1: a reference at the point where a long note is cut is still not linked', () => {
    const room = 400 - ' … (truncated by Radar)'.length;
    const rows: Record<string, unknown>[] = [];
    for (const reference of [REAL.issue, REAL.qualifiedIssue, 'GH-9', REAL.user, REAL.commit]) {
      const body = bodyOf([`other: ${'='.repeat(room - 'other: '.length - 1 - reference.length)}${reference} is not in the new post.`]);
      const found = findings(render(body));
      rows.push({ reference, endOfLine: body.split('\n').find(line => line.startsWith('  - Deviation 1: '))!.slice(-50), mentions: found.mentions.length, references: found.references.length, linkedTo: found.anchors.map(anchor => /href="([^"]*)"/.exec(anchor)?.[1] ?? '') });
    }
    evidence.cutReference = rows;
    expect(rows.filter(row => (row.mentions as number) + (row.references as number) > 0).map(row => [row.reference, row.linkedTo])).toEqual([]);
  });

  it('OBSERVATION: the article\'s description is printed as its own line, so Markdown in it renders', () => {
    // Not agent text: the description is written by Radar's writer and approved by the owner. Pinned as it is today
    // (pr-body.qa.test.ts has the same observation without a network): a heading, a link and a reference in it render.
    const heading = render(bodyOf([], {}, { ...P, meta: '# Approved by Radar' }));
    const linked = findings(render(bodyOf([], {}, { ...P, meta: `[Merge now](https://${HOST}/m) ${REAL.issue} ${REAL.user}` })));
    evidence.description = { heading: count(heading, /<h1[\s>]/g), anchorsNamingHost: linked.tagsNamingHost.length, references: linked.references.length, mentions: linked.mentions.length };
    expect(count(heading, /<h1[\s>]/g)).toBe(1);
    expect(linked.tagsNamingHost.length).toBe(1);
    expect(linked.references.length).toBe(1);
    expect(linked.mentions).toEqual([]); // an @name in the description is shown as code
  });

  it('writes its evidence', () => {
    mkdirSync('.factory/sandbox-publisher/qa/evidence', { recursive: true });
    writeFileSync('.factory/sandbox-publisher/qa/evidence/qa4-live-markdown.json', JSON.stringify({ at: new Date().toISOString(), revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), context: CONTEXT, vectors: HOSTILE.length, ...evidence }, null, 2) + '\n');
  });
});
