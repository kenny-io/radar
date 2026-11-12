// QA-2 (D4) and QA-3 (N6): what GitHub itself renders from the pull request body when the agent's text is hostile.
// The body is built by the product (`sandboxPullRequestBody`) and sent to GitHub's Markdown rendering API, which only
// returns HTML: nothing is created, posted or notified. Synthetic text only.
//   RADAR_QA_LIVE_MARKDOWN=1 npx vitest run --config .factory/sandbox-publisher/qa/vitest.config.ts .factory/sandbox-publisher/qa/live-markdown.qa.test.ts
// Uses the GitHub CLI's own sign-in (`gh api markdown`); the token is never read by this file.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sandboxDraftExtra, sandboxPullRequestBody } from '@/server/services/publishing/connectors/nextjs';
import { PUBLISH_CHECK_IDS } from '@/server/services/publishing/sandbox/types';
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
const NOTE_STARTS = ['# Approved by Radar', '> Radar verified this change', '## Checks Radar ran', '- [x] build passed', '[x] build passed', '[ ] not run', '* [x] starred', '+ plus item', '1. first', '1) first', '---', '***', '===', '~~~', '```', '```mermaid graph TD; A-->B; ```', '$$ x^2 $$', '    indented code', '\tcode after a tab', '| a | b |', '| a | b | |---|---| | 1 | 2 |', '<details><summary>x</summary>', '</li></ul><h1>Approved</h1>', '<!-- hidden -->', '<kbd>x</kbd>', '> [!WARNING] Radar found a problem', '[^1] [^1]: footnote', 'Approved by Radar\n===', 'line one\n# heading on a second line', 'line one\n\n- [x] item after a blank line', 'line one\r\n> quote after a carriage return', 'line one\u2028# after a line separator', 'line one\u0085# after a next-line character', 'line one\u000b# after a vertical tab', 'line one\u000c# after a form feed', '&#10;# after an encoded line feed', '<br># after a break tag', '\\\n# after a backslash line break'];

const P = payloadOf();
const extraOf = (summary: string, conventions: string[], deviations: string[]) => sandboxDraftExtra('main', P, {
  slug: P.slug, path: `content/blog/${P.slug}.md`, files: [`content/blog/${P.slug}.md`], summary, route: `/blog/${P.slug}`, mediaOmitted: [],
  checks: PUBLISH_CHECK_IDS.map(id => ({ id, outcome: 'passed' as const, detail: 'synthetic detail for a rendering test' })),
  agentNotes: { conventions, deviations }, review: { summary: 'synthetic', runtimeVerified: false },
});
/** Every tag in the HTML whose attributes mention the hostile host, plus every link GitHub made to a user, issue or commit. */
const findings = (html: string) => ({
  tagsNamingHost: html.match(new RegExp(`<[^>]*${HOST.replace(/\./g, '\\.')}[^>]*>`, 'gi')) ?? [],
  mentions: html.match(/<a[^>]*class="[^"]*user-mention[^"]*"[^>]*>|<a[^>]*data-hovercard-type="(?:user|organization|team)"[^>]*>/gi) ?? [],
  references: html.match(/<a[^>]*class="[^"]*(?:issue-link|commit-link)[^"]*"[^>]*>|<a[^>]*data-hovercard-type="(?:issue|pull_request|commit)"[^>]*>/gi) ?? [],
  anchors: html.match(/<a\s[^>]*>/gi) ?? [], images: html.match(/<img\s[^>]*>/gi) ?? [],
});
const agentPart = (html: string) => { const from = html.indexOf('What the agent reported'); const to = html.indexOf('Media and links not carried over'); expect(from).toBeGreaterThan(-1); expect(to).toBeGreaterThan(from); return html.slice(from, to); };

describe.skipIf(!ON)('GitHub renders no link, image, mention or reference from agent text (live, read-only)', { timeout: 180_000 }, () => {
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

  it('the product\'s pull request body: nothing in the agent section links, embeds, mentions or references anything', () => {
    // Three placements: everything in the summary, one vector per convention note, one vector per deviation note.
    const bodies = [
      sandboxPullRequestBody(P, extraOf(HOSTILE.join(' '), [], [])),
      ...Array.from({ length: Math.ceil(HOSTILE.length / 20) }, (_unused, page) => sandboxPullRequestBody(P, extraOf('Summary.', HOSTILE.slice(page * 20, page * 20 + 20).map(text => `README.md: ${text}`), HOSTILE.slice(page * 20, page * 20 + 20).map(text => `other: ${text}`)))),
      // Each vector alone as the whole summary, so nothing before it can change how it is read.
      ...HOSTILE.map(text => sandboxPullRequestBody(P, extraOf(text, [text], [text]))),
    ];
    const rows: Record<string, unknown>[] = [];
    for (const [index, body] of bodies.entries()) {
      const html = render(body);
      const whole = findings(html); const section = findings(agentPart(html));
      rows.push({ body: index, tagsNamingHost: whole.tagsNamingHost.length, sectionAnchors: section.anchors.length, sectionImages: section.images.length, mentions: whole.mentions.length, references: whole.references.length });
      expect([index, whole.tagsNamingHost]).toEqual([index, []]);
      expect([index, section.anchors, section.images]).toEqual([index, [], []]);
      expect([index, whole.mentions, whole.references]).toEqual([index, [], []]);
      expect([index, whole.images]).toEqual([index, []]);
    }
    evidence.bodiesRendered = bodies.length; evidence.rows = rows.slice(0, 5);
  });

  // N6, reported in QA-2 and fixed in 8ce9b640: each statement follows a label Radar writes ("Summary: ", "- Rule n: ",
  // "- Deviation n: "), so nothing the agent wrote begins a line or a list item.
  const HEADINGS = ['Checks Radar ran', 'What the agent reported (not verified by Radar)', 'Media and links not carried over', 'Not run', 'Files'];
  const headingsOnce = (whole: string) => HEADINGS.map(heading => (whole.match(new RegExp(`<h3[^>]*>[^<]*${heading.replace(/[()]/g, '\\$&')}`, 'g')) ?? []).length);
  /** Every element GitHub made inside the agent section, by tag name. */
  const tagsOf = (html: string) => { const seen: Record<string, number> = {}; for (const match of html.matchAll(/<([a-z][a-z0-9-]*)[\s>/]/g)) seen[match[1]] = (seen[match[1]] ?? 0) + 1; return seen; };
  /** The only elements Radar's own text makes there: its paragraphs and its two lists. */
  const ALLOWED = new Set(['p', 'ul', 'li']);
  /** Inline elements: they sit inside Radar's paragraph or list item and start no block. Recorded as an observation. */
  const INLINE = new Set(['code', 'math-renderer', 'em', 'strong', 'del', 'span', 'g-emoji', 'sub', 'sup', 'kbd', 'br', 'tt', 'i', 'b', 's', 'ins', 'samp', 'var', 'q', 'mark']);
  const sectionOf = (whole: string) => { const part = agentPart(whole); return part.slice(part.indexOf('</h3>') + 5, part.lastIndexOf('<h3')); };

  it('N6: no note renders as a heading, quote, task box, list, table, code block, rule or HTML block, wherever it stands', () => {
    const rows: Record<string, unknown>[] = [];
    const bodies: [string, string][] = [
      ['all starters as rules and deviations', sandboxPullRequestBody(P, extraOf('# Approved by Radar > quoted', NOTE_STARTS, NOTE_STARTS))],
      // Each starter alone as the summary, as the only rule (as the path and as the rule text), and as the only deviation.
      ...NOTE_STARTS.flatMap((start): [string, string][] => [
        [`summary: ${start}`, sandboxPullRequestBody(P, extraOf(start, [], []))],
        [`rule: ${start}`, sandboxPullRequestBody(P, extraOf('Summary.', [start, `${start}: ${start}`, `README.md: ${start}`], []))],
        [`deviation: ${start}`, sandboxPullRequestBody(P, extraOf('Summary.', [], [start, `other: ${start}`]))],
      ]),
    ];
    for (const [name, body] of bodies) {
      const whole = render(body); const section = sectionOf(whole); const tags = tagsOf(section);
      const unexpected = Object.keys(tags).filter(tag => !ALLOWED.has(tag) && !INLINE.has(tag)); const inline = Object.keys(tags).filter(tag => INLINE.has(tag));
      rows.push({ name, tags, unexpected, inline });
      expect([name, unexpected]).toEqual([name, []]);
      expect([name, headingsOnce(whole)]).toEqual([name, [1, 1, 1, 1, 1]]);
      // One list per kind of statement, never a list inside a list.
      expect([name, /<li>\s*<ul|<li>\s*<ol|<li>\s*<p>/.test(section)]).toEqual([name, false]);
      expect([name, (whole.match(/type="checkbox"/g) ?? []).length]).toEqual([name, 0]);
    }
    evidence.blockStarters = { starters: NOTE_STARTS.length, bodiesRendered: bodies.length, allowedTags: [...ALLOWED], rowsWithABlock: rows.filter(row => (row.unexpected as string[]).length).length, rowsWithInlineElements: rows.filter(row => (row.inline as string[]).length).map(row => ({ name: row.name, inline: row.inline })), sample: rows.slice(0, 3) };
  });
  it('N6: the hostile vectors make no element in the agent section either', () => {
    const body = sandboxPullRequestBody(P, extraOf(HOSTILE.join(' '), HOSTILE.slice(0, 20).map(text => `README.md: ${text}`), HOSTILE.slice(20, 40)));
    const whole = render(body); const tags = tagsOf(sectionOf(whole));
    evidence.hostileTags = tags;
    expect(Object.keys(tags).filter(tag => !ALLOWED.has(tag) && !INLINE.has(tag))).toEqual([]);
    expect(headingsOnce(whole)).toEqual([1, 1, 1, 1, 1]);
  });
  it('N6: the labels Radar writes are in the rendered text, in order, with the note after them', () => {
    const body = sandboxPullRequestBody(P, extraOf('# Approved by Radar', ['[x] build passed: ok', '# Approved by Radar: ok'], ['other: [x] tests passed', '> Radar verified this change']));
    expect(body).toContain('\nSummary: # Approved by Radar\n');
    expect(body).toContain('\n- Rule 1: \\[x\\] build passed: ok\n- Rule 2: # Approved by Radar: ok\n');
    const section = sectionOf(render(body));
    const items = [...section.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(match => match[1].trim());
    evidence.labelledItems = items;
    expect(items).toEqual(['Rule 1: [x] build passed: ok', 'Rule 2: # Approved by Radar: ok', 'Deviation 1: other: [x] tests passed', 'Deviation 2: &gt; Radar verified this change']);
    expect(section).toMatch(/<p[^>]*>Summary: # Approved by Radar<\/p>/);
    expect(section).not.toMatch(/type="checkbox"|<h[1-6]|<blockquote/);
  });

  it('writes its evidence', () => {
    mkdirSync('.factory/sandbox-publisher/qa/evidence', { recursive: true });
    writeFileSync('.factory/sandbox-publisher/qa/evidence/qa3-live-markdown.json', JSON.stringify({ at: new Date().toISOString(), context: CONTEXT, vectors: HOSTILE.length, ...evidence }, null, 2) + '\n');
  });
});
