// QA-4 (12 Nov 2026, on fe167d86): the short pull request body of 0f89aa2a, called directly with saved drafts that a
// run would not produce. `sandboxPullRequestBody` prints three kinds of value: sentences Radar writes from counts,
// values Radar frames as code (the article path, the route the agent reported, the slugs, what was not carried over),
// and the agent's deviations. The agent's text is probed through the whole flow in connector.qa.test.ts; this file
// covers the other two, the caps, a draft saved without counts, and every value `continuation` can hold.
// Nothing here touches a network. What GitHub renders from these bodies is checked in live-markdown.qa.test.ts.
import { describe, expect, it } from 'vitest';
import { sandboxDraftExtra, sandboxPullRequestBody } from '@/server/services/publishing/connectors/nextjs';
import { PUBLISH_CHECK_IDS } from '@/server/services/publishing/sandbox/types';
import type { PublishPayload } from '@/server/services/publishing/types';
import { payloadOf } from './helpers';

const P = (over: Partial<PublishPayload> = {}) => payloadOf(undefined, over);
const PATH = `content/blog/${P().slug}.md`;
const CLEAN = { existingLinesChanged: 0, articleLinesReplaced: 0, notWordForWord: 0, undecided: 0, headings: 4, headingsMissing: 0 };
/** A sandbox draft as the connector saves it, with fields replaced for one probe. */
const extraOf = (over: Record<string, unknown> = {}): any => ({ ...sandboxDraftExtra('main', P(), {
  slug: P().slug, path: PATH, files: [PATH], summary: 'QA-SUMMARY-CANARY the build passed', route: `/blog/${P().slug}`, mediaOmitted: [],
  checks: PUBLISH_CHECK_IDS.map(id => ({ id, outcome: 'passed' as const, detail: `QA-DETAIL-CANARY ${id}: 196224 bytes (limit 1000000)` })),
  agentNotes: { conventions: ['README.md: QA-RULE-CANARY ran npm test'], deviations: [] }, review: { summary: 'QA-REVIEW-CANARY', runtimeVerified: false }, facts: CLEAN,
}), ...over });
const notes = (deviations: unknown[], over: Record<string, unknown> = {}) => extraOf({ agentNotes: { conventions: [], deviations }, ...over });
const body = (extra: any, payload = P()) => sandboxPullRequestBody(payload, extra);
const checkedOf = (text: string) => text.split('\n').filter(line => line.startsWith('- Checked by Radar: ')).map(line => line.slice('- Checked by Radar: '.length));

const NOTICE = `**Draft for review.** The article is not live. Scheduled for ${P().date}.`;
const ARTICLE_LINE = `- Article: \`${PATH}\`, expected at \`/blog/${P().slug}\``;
const CHECKED_CLEAN = '- Checked by Radar: no existing line was removed or changed; the article text is carried over word for word.';
const AGENT_LABEL = '- Reported by the agent that made the change (not verified by Radar):';
const CLOSING = 'Radar did not build or run the site. Check the article on the deployment preview before merging.';
const PLAIN = [P().meta, '', NOTICE, '', ARTICLE_LINE, CHECKED_CLEAN, '', CLOSING, '', 'Opened by Radar.'].join('\n');
const SENTENCE = {
  added: 'This attempt added a commit to an existing article branch. Radar’s checks cover that commit and the article file, not the earlier commits on the branch.',
  unchanged: 'The article was already complete on its branch, so this attempt added no commit. Radar’s check covers the article file only.',
  resumed: 'This continues an earlier attempt whose commit had passed Radar’s checks. Its notes were not kept, so compare the article’s images and links with the diff.',
};
const GENERAL = 'the change passed Radar’s checks that existing content is kept and that the article text is carried over.';

describe('the short pull request body: what is printed and what is not', () => {
  it('a plain draft is ten lines, and nothing saved for operators is printed', () => {
    expect(body(extraOf())).toBe(PLAIN);
    // The summary, the rules, the check details and the review summary stay on the draft.
    expect(body(extraOf())).not.toMatch(/CANARY|bytes|npm|Summary|Rule \d|Not run|Files|###/);
    expect(extraOf().summary).toContain('QA-SUMMARY-CANARY');
  });

  it('caps: ten references and eight notes are shown, the rest are counted, and a hidden note is not printed at all', () => {
    const references = Array.from({ length: 12 }, (_unused, n) => `https://files.example.test/body/image-${n + 1}.png`);
    const deviations = [...Array.from({ length: 8 }, (_unused, n) => `other: note ${n + 1}`), 'other: QA-HIDDEN-NINTH [x](https://attacker.example.test) @octocat', 'other: QA-HIDDEN-TENTH', 'other: QA-HIDDEN-ELEVENTH'];
    const lines = body(notes(deviations, { mediaOmitted: references })).split('\n');
    const from = lines.indexOf('- Not carried over: 12 images, videos or links from the article, because Radar did not find them in the change:');
    expect(lines.slice(from + 1, from + 12)).toEqual([...references.slice(0, 10).map(reference => `  - \`${reference}\``), '  - and 2 more']);
    expect(lines.slice(from + 12, from + 22)).toEqual([AGENT_LABEL, ...deviations.slice(0, 8).map((note, n) => `  - Deviation ${n + 1}: ${note}`), '  - and 3 more']);
    expect(lines.slice(from + 22)).toEqual(['', CLOSING, '', 'Opened by Radar.']);
    expect(lines.join('\n')).not.toMatch(/QA-HIDDEN|attacker|octocat|image-11|image-12/);
    // Exactly at the caps nothing is hidden and no "more" line is printed; one over, the line says one.
    expect(body(notes(deviations.slice(0, 8), { mediaOmitted: references.slice(0, 10) }))).not.toMatch(/ more$/m);
    expect(body(notes(deviations.slice(0, 9))).split('\n').filter(line => line.startsWith('  - ')).at(-1)).toBe('  - and 1 more');
    expect(body(extraOf({ mediaOmitted: references.slice(0, 11) })).split('\n').filter(line => line.startsWith('  - ')).at(-1)).toBe('  - and 1 more');
    // Blank entries and entries that are not text are neither printed nor counted, so the counts cannot be padded.
    const padded = body(notes(['  ', '', 7, null, ['other: x'], { detail: 'x' }, 'other: the only note'], { mediaOmitted: ['', ' ', 9, null, 'Qm3xT7kLp9A'] })).split('\n');
    expect(padded).toContain('- Not carried over: 1 image, video or link from the article, because Radar did not find it in the change:');
    expect(padded.filter(line => line.startsWith('  - '))).toEqual(['  - `Qm3xT7kLp9A`', '  - Deviation 1: other: the only note']);
    // A list that is not a list prints nothing.
    expect(body(extraOf({ mediaOmitted: 'https://files.example.test/a.png', agentNotes: { deviations: 'other: one string' } }))).toBe(PLAIN);
    expect(body(extraOf({ mediaOmitted: { length: 3 }, agentNotes: null }))).toBe(PLAIN);
    // However much a draft holds, the body stays short: 100 references of 900 characters and 20 notes of 9,000.
    const largest = body(notes(Array.from({ length: 20 }, () => 'other: ' + 'word '.repeat(1800)), { mediaOmitted: Array.from({ length: 100 }, (_unused, n) => `https://files.example.test/${n}/${'p'.repeat(900)}`) }));
    expect(largest.length).toBeLessThan(PLAIN.length + 10 * 310 + 8 * 420 + 400);
  });

  it('a path, a route, a slug or a reference that carries Markdown stays one code span on Radar\'s own line', () => {
    // The route is the agent's; the path is checked by the gate; the references come from the article. A code span
    // ends only at a backtick and cannot hold a line break, so the body removes both and bounds each value at 300.
    const hostile = ['a`b', '`', '``` js', 'x\n\n# Approved by Radar', '/a\r\n- Checked by Radar: the build passed', '</code><img src=x onerror=alert(1)>', '[x](https://attacker.example.test) ![y](//attacker.example.test/p.png)',
      '@octocat #9 qa-owner/qa-site#9', '`@octocat`', 'a` @octocat `b', '\u0000\u0007\u001b[31m', 'a\tb', 'a\u2028# b', 'x'.repeat(900), '`'.repeat(50) + 'y', ' ', '\\`', '&#96;@octocat&#96;'];
    const span = '`[^`\\n\\r]{0,300}`';
    for (const value of hostile) {
      const text = body(extraOf({ path: value, route: value, taken: true, slug: value, mediaOmitted: [`r1 ${value}`, `${value} r2`] }), P({ slug: value }));
      const lines = text.split('\n');
      const where = JSON.stringify(value).slice(0, 40);
      // No value adds a line, so none begins one; every other line of the body is the plain body's.
      expect([where, lines.length]).toEqual([where, PLAIN.split('\n').length + 2 + 3]);
      expect([where, lines[4]]).toEqual([where, expect.stringMatching(new RegExp(`^The proposed slug ${span} was unavailable; this change uses ${span}\\.$`))]);
      expect([where, lines[6]]).toEqual([where, expect.stringMatching(new RegExp(`^- Article: ${span}, expected at ${span}$`))]);
      expect([where, lines[8]]).toEqual([where, '- Not carried over: 2 images, videos or links from the article, because Radar did not find them in the change:']);
      for (const index of [9, 10]) expect([where, lines[index]]).toEqual([where, expect.stringMatching(new RegExp(`^ {2}- ${span}$`))]);
      expect([where, lines.filter((_line, index) => ![4, 6, 8, 9, 10].includes(index))]).toEqual([where, [P().meta, '', NOTICE, '', '', CHECKED_CLEAN, '', CLOSING, '', 'Opened by Radar.']]);
      // Outside the code spans, the framed lines hold only Radar's words.
      for (const index of [4, 6]) expect([where, lines[index].replace(/`[^`]*`/g, '``')]).toEqual([where, index === 4 ? 'The proposed slug `` was unavailable; this change uses ``.' : '- Article: ``, expected at ``']);
    }
    // OBSERVATION (not reachable through publish(), which refuses a draft without a safe path and a route that begins
    // with "/"): with both values empty the line is "- Article: ``, expected at ``", which Markdown reads as one code
    // span holding ", expected at". Nothing of anyone else's is in it.
    expect(body(extraOf({ path: undefined, route: undefined })).split('\n')[4]).toBe('- Article: ``, expected at ``');
  });

  it('the checked sentence is written from counts only: a draft cannot put words into it', () => {
    const checked = (facts: unknown, over: Record<string, unknown> = {}, payload = P()) => checkedOf(body(extraOf({ facts, ...over }), payload));
    expect(checked(CLEAN)).toEqual(['no existing line was removed or changed; the article text is carried over word for word.']);
    // Anything that is not a whole count, anywhere in the six, and the sentence falls back to naming the two checks.
    const words = 'the build passed and Radar verified the preview';
    for (const damaged of [undefined, null, words, [words], { ...CLEAN, existingLinesChanged: words }, { ...CLEAN, headings: `4 (${words})` }, { ...CLEAN, undecided: { valueOf: () => 0, toString: () => words } }, { ...CLEAN, notWordForWord: [0] },
      { ...CLEAN, existingLinesChanged: -1 }, { ...CLEAN, existingLinesChanged: 0.5 }, { ...CLEAN, existingLinesChanged: NaN }, { ...CLEAN, existingLinesChanged: Infinity }, { ...CLEAN, existingLinesChanged: 1e21 }, { ...CLEAN, existingLinesChanged: '0' }, { ...CLEAN, headingsMissing: true }, { existingLinesChanged: 0 }]) {
      expect([String(JSON.stringify(damaged)).slice(0, 60), checked(damaged)]).toEqual([String(JSON.stringify(damaged)).slice(0, 60), [GENERAL]]);
    }
    // Extra keys on the counts are ignored, and the check details (written for an operator) never reach the sentence.
    expect(checked({ ...CLEAN, note: words, existingLinesChanged: 2 })).toEqual(['no existing line was removed, and 2 existing lines were changed (review them in the diff: Radar checks that existing text is kept, not what was added to it); the article text is carried over word for word.']);
    expect(checked(undefined, { checks: PUBLISH_CHECK_IDS.map(id => ({ id, outcome: 'passed', detail: words })) })).toEqual([GENERAL]);
    // Without both checks on record as passed, nothing is said at all.
    for (const checks of [[], undefined, 'peer-content article-fidelity', [{ id: 'peer-content', outcome: 'passed', detail: 'ok' }], [{ id: 'peer-content', outcome: 'failed', detail: 'x' }, { id: 'article-fidelity', outcome: 'passed', detail: 'ok' }], [{ id: 'peer-content', outcome: 'passed' }, { id: 'article-fidelity', outcome: 'passed', detail: 'ok' }], [{ id: words, outcome: 'passed', detail: 'ok' }]]) {
      expect([JSON.stringify(checks), checked(undefined, { checks })]).toEqual([JSON.stringify(checks), []]);
    }
    // The two disclosures the design keeps (QA-2 findings N2 and N3) are in the sentence whenever their count is not zero,
    // for a new article and for a refresh, and a refresh never says that no line was removed.
    const refresh = P({ mode: 'refresh', refreshUrl: '/blog/an-older-post' });
    for (const payload of [P(), refresh]) {
      expect(checked({ ...CLEAN, existingLinesChanged: 3 }, {}, payload)[0]).toMatch(/3 existing lines were (removed or )?changed \(review them in the diff: Radar checks that existing text is kept, not what was added to it\)/);
      expect(checked({ ...CLEAN, undecided: 2 }, {}, payload)[0]).toMatch(/Radar could not tell whether words were added beside 2 passages \(check the diff\)\.$/);
      expect(checked({ ...CLEAN, notWordForWord: 1, headingsMissing: 1 }, {}, payload)[0]).not.toMatch(/word for word/);
    }
    expect(checked({ ...CLEAN, articleLinesReplaced: 12, existingLinesChanged: 1 }, {}, refresh)[0]).not.toMatch(/no existing line was removed/);
    expect(checked({ ...CLEAN, existingLinesChanged: 1 }, {}, refresh)[0]).not.toMatch(/no existing line was removed/);
    // Whatever the counts, the sentence names no build, test, lint, preview or runtime result.
    for (const facts of [CLEAN, { existingLinesChanged: 9, articleLinesReplaced: 9, notWordForWord: 9, undecided: 9, headings: 9, headingsMissing: 9 }]) for (const payload of [P(), refresh]) for (const continuation of [undefined, 'added', 'unchanged']) {
      expect(checked(facts, { continuation }, payload).join(' ')).not.toMatch(/build|tests?\b|lint|preview|runtime|deploy|install|verified/i);
    }
  });

  it('continuation: only the three exact values add a sentence, and a resumed draft prints nothing that was not kept', () => {
    const full = (continuation: unknown, over: Record<string, unknown> = {}) => body(notes(['other: a note'], { continuation, mediaOmitted: ['Qm3xT7kLp9A'], ...over }));
    const rest = ['- Not carried over: 1 image, video or link from the article, because Radar did not find it in the change:', '  - `Qm3xT7kLp9A`', AGENT_LABEL, '  - Deviation 1: other: a note', '', CLOSING, '', 'Opened by Radar.'];
    const first = [P().meta, '', NOTICE, '', ARTICLE_LINE, CHECKED_CLEAN, ...rest].join('\n');
    expect(full(undefined)).toBe(first);
    expect(full('added')).toBe([P().meta, '', NOTICE, '', SENTENCE.added, '', ARTICLE_LINE, CHECKED_CLEAN, ...rest].join('\n'));
    // No commit was written, so the sentence says nothing about existing lines, whatever the counts are.
    expect(full('unchanged', { facts: { ...CLEAN, existingLinesChanged: 5, articleLinesReplaced: 7 } })).toBe([P().meta, '', NOTICE, '', SENTENCE.unchanged, '', ARTICLE_LINE, '- Checked by Radar: the article text is carried over word for word.', ...rest].join('\n'));
    expect(full('unchanged', { facts: { ...CLEAN, existingLinesChanged: 5 } }, )).not.toMatch(/existing line/);
    // Resumed: no checked sentence, no omitted list and no notes, even when the draft carries all three, with or
    // without counts, and for a refresh too.
    const resumed = [P().meta, '', NOTICE, '', SENTENCE.resumed, '', ARTICLE_LINE, '', CLOSING, '', 'Opened by Radar.'].join('\n');
    expect(full('resumed')).toBe(resumed);
    expect(full('resumed', { facts: undefined })).toBe(resumed);
    expect(sandboxPullRequestBody(P({ mode: 'refresh' }), notes(['other: a note'], { continuation: 'resumed', mediaOmitted: ['Qm3xT7kLp9A'], facts: { ...CLEAN, articleLinesReplaced: 9 } }))).toBe(resumed);
    // The sentence that vouches for an earlier commit is printed for the exact value "resumed" and for nothing else.
    for (const other of [undefined, null, '', 'added', 'unchanged', 'RESUMED', 'resumed ', ' resumed', 'resume', 1, true, ['resumed'], { toString: () => 'resumed' }, 'retried']) {
      const text = full(other);
      expect([String(other), text.includes('earlier attempt')]).toEqual([String(other), false]);
      // A value the connector never writes adds no sentence: the body is that of a first attempt.
      if (other !== 'added' && other !== 'unchanged') expect([String(other), text]).toEqual([String(other), first]);
    }
    // The slug note comes before the continuation sentence and frames both slugs as code.
    expect(full('added', { taken: true, slug: `${P().slug}-2` }).split('\n').slice(2, 8)).toEqual([NOTICE, '', `The proposed slug \`${P().slug}\` was unavailable; this change uses \`${P().slug}-2\`.`, '', SENTENCE.added, '']);
  });

  it('a draft saved without counts says only that the two checks passed', () => {
    const saved = (continuation?: string, over: Record<string, unknown> = {}) => checkedOf(body(extraOf({ facts: undefined, continuation, ...over })));
    expect(saved()).toEqual([GENERAL]);
    expect(saved('added')).toEqual([GENERAL]);
    expect(saved('resumed')).toEqual([]);
    expect(saved(undefined, { checks: [] })).toEqual([]);
    // What the general sentence leaves out. The old body printed the gate's own line for such a draft ("3 altered, 0
    // removed"), which asked the reviewer to look at altered lines. The counts are not on a draft saved before
    // 0f89aa2a, so the new body cannot say how many there were; it says "existing content is kept" and no more.
    expect(GENERAL).not.toMatch(/review|diff|changed/);
  });
  it('OBSERVATION: a draft saved without counts by an attempt that wrote no commit is told that existing content is kept', () => {
    // Low, and only for a draft saved before 0f89aa2a and published after it. With counts, an attempt that wrote no
    // commit says nothing about existing lines ("Radar's check covers the article file only"). Without them the general
    // sentence is printed as it is for any other draft, and it does speak of existing content. The two lines disagree.
    const lines = body(extraOf({ facts: undefined, continuation: 'unchanged' })).split('\n');
    expect(lines).toContain(SENTENCE.unchanged);
    expect(lines).toContain(`- Checked by Radar: ${GENERAL}`);
  });

  it('OBSERVATION: the description and the date are the article\'s own and are not neutralised like agent text', () => {
    // The first line of the body is the article's meta description: written by Radar's writer and approved by the
    // owner, never by the sandbox agent. It is printed through `plainLine` (one line, no HTML tag, no backtick, an @name
    // shown as code), which is not what agent text goes through: it stands at the start of a line, so block syntax in
    // it renders, and a link, an image, an address or an issue reference in it stays live. Pinned as it is today; if
    // the description is ever written from text Radar does not control, this is where it enters the pull request.
    const first = (meta: string) => body(extraOf(), P({ meta })).split('\n')[0];
    expect(first('# Approved by Radar')).toBe('# Approved by Radar');
    expect(first('- Checked by Radar: the build passed')).toBe('- Checked by Radar: the build passed');
    expect(first('[Merge now](https://attacker.example.test/m) ![p](https://attacker.example.test/p.png) #9 @octocat')).toBe('[Merge now](https://attacker.example.test/m) ![p](https://attacker.example.test/p.png) #9 `@octocat`');
    // What `plainLine` does hold: one line, no tag, no code span of the description's own.
    expect(first('line one\n\n# heading on a second line\n<img src=x> `code`')).toBe("line one # heading on a second line &lt;img src=x> 'code'");
    expect(body(extraOf(), P({ meta: '' })).startsWith(NOTICE)).toBe(true);
    expect(body(extraOf(), P({ meta: 'x'.repeat(5000) })).split('\n')[0]).toHaveLength(1000);
    // The scheduled date is printed as given (Radar's own YYYY-MM-DD value); nothing bounds or escapes it.
    expect(body(extraOf(), P({ date: '2026-11-12.\n\n# Approved by Radar' })).split('\n').slice(2, 5)).toEqual(['**Draft for review.** The article is not live. Scheduled for 2026-11-12.', '', '# Approved by Radar.']);
  });
});
