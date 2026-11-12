// QA-2, D4: what GitHub itself renders from the pull request body when the agent's text is hostile.
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
const NOTE_STARTS = ['# Approved by Radar', '> Radar verified this change', '## Checks Radar ran', '- [x] build passed', '1. first', '---', '~~~', '    indented code', '| a | b |', '<details><summary>x</summary>'];

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

  it('LISTED LIMITATION and N6: a note that begins with Markdown block syntax renders as that block', () => {
    const body = sandboxPullRequestBody(P, extraOf('# Approved by Radar > quoted', NOTE_STARTS, NOTE_STARTS));
    const whole = render(body);
    const html = agentPart(whole);
    const count = (pattern: RegExp) => (html.match(pattern) ?? []).length;
    const blocks = { headings: count(/<h[1-6][\s>]/g), quotes: count(/<blockquote/g), rules: count(/<hr/g), codeBlocks: count(/<pre/g), tables: count(/<table/g), checkedTaskBoxes: count(/<input[^>]*type="checkbox"[^>]*checked/g), details: count(/<details/g), externalAnchors: (html.match(/<a\s[^>]*href="(?!#)[^"]*"/g) ?? []).length, images: count(/<img\s/g) };
    evidence.noteStarts = blocks;
    // What holds: no link out, no image, no raw HTML block, and Radar's own five section headings are all still there, once each.
    expect(blocks.externalAnchors).toBe(0);
    expect(blocks.images).toBe(0);
    expect(blocks.details).toBe(0);
    expect(blocks.tables).toBe(0);
    for (const heading of ['Checks Radar ran', 'What the agent reported (not verified by Radar)', 'Media and links not carried over', 'Not run', 'Files']) expect((whole.match(new RegExp(`<h3[^>]*>[^<]*${heading.replace(/[()]/g, '\\$&')}`, 'g')) ?? []).length).toBe(1);
    // The summary is one paragraph whatever it starts with.
    expect(html).toContain('Summary: # Approved by Radar &gt; quoted');
    // The limitation the engineer listed: a heading and a quote do render inside the agent's list.
    expect(blocks.headings).toBeGreaterThanOrEqual(2);
    expect(blocks.quotes).toBeGreaterThanOrEqual(1);
    // N6: an escaped "[x]" at the start of a note is still a task box to GitHub, shown ticked.
    expect(body).toContain('- - \\[x\\] build passed');
    expect(blocks.checkedTaskBoxes).toBeGreaterThanOrEqual(1);
  });
  it.fails('N6: a note cannot render as a ticked task box', () => {
    const html = agentPart(render(sandboxPullRequestBody(P, extraOf('Summary.', ['[x] build passed: ok'], []))));
    expect(html).not.toMatch(/type="checkbox"/);
  });

  it('writes its evidence', () => {
    mkdirSync('.factory/sandbox-publisher/qa/evidence', { recursive: true });
    writeFileSync('.factory/sandbox-publisher/qa/evidence/qa2-live-markdown.json', JSON.stringify({ at: new Date().toISOString(), context: CONTEXT, vectors: HOSTILE.length, ...evidence }, null, 2) + '\n');
  });
});
