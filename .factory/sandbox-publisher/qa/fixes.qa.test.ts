// QA-2 (revision 3d3dd9c7): attempts to get around the fixes for D1 (peer content) and D2 (fidelity), and a check that
// honest edits to other registry shapes still pass. Tests written "it.fails" assert what the criterion asks for and
// do not hold on this revision; each is listed in the QA-2 report (N1 to N4).
// QA-3 (8ce9b640): N1 and N3 were fixed; their tests here now assert the fixed behavior, and qa3.qa.test.ts holds the
// attempts to get around those fixes. N2 and N4 are accepted limitations (architecture section 15) and stay as written.
import { describe, expect, it } from 'vitest';
import type { Block } from '@/lib/types';
import { nearIdenticalLine, runPublicationGate } from '@/server/services/publishing/sandbox/gate';
import { QA_BLOCKS, filler, gateFailure, gateInput, payloadOf, toMarkdown, treeOf } from './helpers';

const P = payloadOf();
const mdPath = `content/blog/${P.slug}.md`;
const md = (blocks: Block[] = QA_BLOCKS, transform: (text: string) => string = text => text) => `---\ntitle: "${P.title}"\n---\n\n` + transform(toMarkdown(blocks));
const ROUTE = `/blog/${P.slug}`;
/** 'accepted', or the diagnostic code the gate refused with. */
const outcome = async (input: Parameters<typeof runPublicationGate>[0]) => runPublicationGate(input).then(() => 'accepted', (error: any) => String(error?.diagnostic?.code));
const peerDetail = async (input: Parameters<typeof runPublicationGate>[0]) => (await runPublicationGate(input)).checks.find(check => check.id === 'peer-content')!.detail;

// A TypeScript registry with one record per line, beside a Markdown article file.
const record = (n: number) => `  { slug: 'peer-article-${n}', title: 'Peer article number ${n}', date: '2026-01-0${1 + (n % 9)}', summary: '${filler(n, 1)}' },`;
const registry = (lines: string[]) => `export const posts = [\n${lines.join('\n')}\n];\n`;
const PEERS = Array.from({ length: 40 }, (_unused, n) => record(n));
const MINE = `  { slug: '${P.slug}', title: 'QA', date: '2026-11-12', summary: 'Synthetic.' },`;
const withRegistry = (final: string) => gateInput(treeOf({ 'site/lib/posts.ts': registry(PEERS), 'content/blog/first.md': 'x\n' }), P, { files: { [mdPath]: md(), 'site/lib/posts.ts': final }, articlePath: mdPath, route: ROUTE });
const beside = (path: string, original: string, final: string) => gateInput(treeOf({ [path]: original, 'content/blog/first.md': 'x\n' }), P, { files: { [mdPath]: md(), [path]: final }, articlePath: mdPath, route: ROUTE });

describe('D1 fix: what is now refused', () => {
  it.each([
    ['two adjacent peer records swapped', registry([...PEERS.slice(0, 5), PEERS[6], PEERS[5], ...PEERS.slice(7), MINE])],
    ['a peer record moved to the end', registry([...PEERS.slice(0, 5), ...PEERS.slice(6), MINE, PEERS[5]])],
    ['a peer deleted and a near-identical line added in another hunk', registry([...PEERS.slice(0, 5), ...PEERS.slice(6), MINE, PEERS[5].replace('number 5', 'number 5!')])],
    ['a peer record replaced in place by the new record', registry([...PEERS.slice(0, 5), MINE, ...PEERS.slice(6)])],
    ['a peer record cut down to its slug', registry([...PEERS.slice(0, 5), `  { slug: 'peer-article-5' },`, ...PEERS.slice(6), MINE])],
    ['a peer record replaced by a blank line', registry([...PEERS.slice(0, 5), '', ...PEERS.slice(6), MINE])],
    ['seven lines altered in one file (limit 6)', registry([...PEERS.map((line, n) => (n < 7 ? line.replace("' },", "', featured: true },") : line)), MINE])],
    ['every peer re-indented', registry([...PEERS.map(line => '  ' + line), MINE])],
  ])('refuses %s', async (_label, final) => {
    expect(await outcome(withRegistry(final))).toBe('peer-content-changed');
  });
  it('refuses 25 altered lines spread over five files (limit 24 in all)', async () => {
    const files: Record<string, string> = { 'content/blog/first.md': 'x\n' }; const finals: Record<string, string> = { [mdPath]: md() };
    for (let f = 0; f < 5; f++) { const lines = Array.from({ length: 8 }, (_u, n) => `export const item${f}_${n} = 'value-${n}'`); files[`site/lib/part${f}.ts`] = lines.join('\n') + '\n'; finals[`site/lib/part${f}.ts`] = lines.map((line, n) => (n < 5 ? line + ';' : line)).join('\n') + '\n'; }
    const failure = await gateFailure(() => runPublicationGate(gateInput(treeOf(files), P, { files: finals, articlePath: mdPath, route: ROUTE })));
    expect(failure.code).toBe('peer-content-changed');
    expect(failure.reason).toMatch(/alters 25 existing lines across the edited files; the limit is 24/);
  });
  it('the near-identical rule itself: gains are free, losses are bounded by 24 characters and half the line', () => {
    expect(nearIdenticalLine("  'peer-3'", "  'peer-3',")).toBe(true);
    expect(nearIdenticalLine('  "count": 170,', '  "count": 171,')).toBe(true);
    expect(nearIdenticalLine("import { a, b } from './posts';", "import { a, b, c } from './posts';")).toBe(true);
    expect(nearIdenticalLine('  "generatedAt": "2026-01-01T08:00:00.000Z",', '  "generatedAt": "2026-11-12T09:30:15.123Z",')).toBe(true);
    expect(nearIdenticalLine(PEERS[5], MINE)).toBe(false);
    expect(nearIdenticalLine(PEERS[5], PEERS[6])).toBe(false);
    expect(nearIdenticalLine(PEERS[5], '')).toBe(false);
    expect(nearIdenticalLine('', PEERS[5])).toBe(false);
    expect(nearIdenticalLine('    }', '  }')).toBe(false);
  });
});

describe('D1 fix: honest edits to other registry shapes still pass', () => {
  const noComma = "export const slugs = [\n  'a-first-post',\n  'b-second-post'\n];\n";
  const imports = "import { first, second } from './posts';\nimport a from './a';\n\nexport const all = [first, second];\n";
  const sitemap = '<?xml version="1.0"?>\n<urlset>\n  <url><loc>https://x.test/a</loc></url>\n</urlset>\n';
  const yaml = 'posts:\n  - slug: a\n    title: A\n  - slug: b\n    title: B\n';
  const index = `{\n  "count": 170,\n  "generatedAt": "2026-01-01T08:00:00.000Z",\n  "slugs": [\n    "peer-article-168",\n    "peer-article-169"\n  ]\n}\n`;
  it.each([
    ['one line appended to a one-record-per-line registry', 'site/lib/posts.ts', registry(PEERS), registry([...PEERS, MINE]), /0 altered, 0 removed/],
    ['one line inserted in the middle (sorted registry)', 'site/lib/posts.ts', registry(PEERS), registry([...PEERS.slice(0, 20), MINE, ...PEERS.slice(20)]), /0 altered, 0 removed/],
    ['one line inserted at the top (newest first)', 'site/lib/posts.ts', registry(PEERS), registry([MINE, ...PEERS]), /0 altered, 0 removed/],
    ['an array whose last entry had no trailing comma', 'site/slugs.js', noComma, noComma.replace("'b-second-post'\n", `'b-second-post',\n  '${P.slug}'\n`), /1 altered, 0 removed/],
    ['an import list and an array that each gain a name on their own line', 'site/index.ts', imports, imports.replace('{ first, second }', '{ first, second, terraceHouse }').replace('[first, second]', '[first, second, terraceHouse]'), /2 altered, 0 removed/],
    ['a sitemap entry before the closing tag', 'public/sitemap.xml', sitemap, sitemap.replace('</urlset>', `  <url><loc>https://x.test/blog/${P.slug}</loc></url>\n</urlset>`), /0 altered, 0 removed/],
    ['a YAML list that gains an entry', 'data/posts.yaml', yaml, yaml + `  - slug: ${P.slug}\n    title: QA\n`, /0 altered, 0 removed/],
    ['a counter, a timestamp and a list in a JSON index', 'data/index.json', index, index.replace('170', '171').replace('2026-01-01T08:00:00.000Z', '2026-11-12T09:30:15.123Z').replace('"peer-article-169"\n', `"peer-article-169",\n    "${P.slug}"\n`), /3 altered, 0 removed/],
    ['a CRLF file edited with LF line endings', 'site/slugs.js', "export const slugs = [\r\n  'a',\r\n  'b',\r\n];\r\n", `export const slugs = [\n  'a',\n  'b',\n  '${P.slug}',\n];\n`, /0 altered, 0 removed/],
    ['a file with no final newline', 'data/list.txt', 'a-first-post\nb-second-post', `a-first-post\nb-second-post\n${P.slug}`, /0 altered, 0 removed/],
  ] as const)('%s', async (_label, path, original, final, detail) => {
    expect(await peerDetail(beside(path, original, final))).toMatch(detail);
  });

  // N4 (minor): honest edits the stricter rule now refuses. Each gets the single repair round, with a reason that says
  // which file lost a line; none of these shapes was met in the live replays.
  it.each([
    ['a "latest post" pointer whose value is more than half its line', 'data/site.yaml', 'title: Site\nlatest: peer-article-169\n', `title: Site\nlatest: ${P.slug}\n`],
    ['a hand-kept "latest three" list that drops its oldest entry', 'site/latest.ts', "export const latest = [\n  'post-c',\n  'post-b',\n  'post-a',\n];\n", `export const latest = [\n  '${P.slug}',\n  'post-c',\n  'post-b',\n];\n`],
    ['an index file whose trailing blank line was dropped while appending', 'content/index.md', '# Posts\n\n- [A](/a)\n- [B](/b)\n\n', `# Posts\n\n- [A](/a)\n- [B](/b)\n- [QA](${ROUTE})\n`],
  ])('N4: refused although honest: %s', async (_label, path, original, final) => {
    const failure = await gateFailure(() => runPublicationGate(beside(path, original, final)));
    expect(failure.code).toBe('peer-content-changed');
    expect(failure.error.repairable).toBe(true);
    expect(failure.reason).toMatch(/existing lines removed/);
  });
});

describe('D1 fix: what still gets through', () => {
  // N1, reported in QA-2 and fixed in 8ce9b640: a retry or migration no longer exempts the article file. These calls
  // hand the gate no base tree, so it compares with the branch head (the connector normally supplies the default-branch
  // tree; that path is in qa3.qa.test.ts).
  const regPath = 'site/lib/registry.ts';
  const block = (slug: string, paragraphs: string[]) => `  {\n    slug: '${slug}',\n    title: 'Title of ${slug}',\n    sections: [\n${paragraphs.map(text => `      ${JSON.stringify(text)},`).join('\n')}\n    ],\n  },\n`;
  const units = QA_BLOCKS.flatMap(blockOf => (blockOf[0] === 'ul' ? (blockOf[1] as string[]) : [blockOf[1] as string]));
  const peerBlocks = Array.from({ length: 12 }, (_unused, n) => block(`peer-${n}`, [0, 50, 90, 130, 170, 210].map(seed => filler(n + seed, 4))));
  const shared = (blocks: string[]) => `export const registry = [\n${blocks.join('')}];\n`;
  const branchHead = shared([...peerBlocks, block(P.slug, units.slice(0, -1))]); // an earlier attempt's commit, one paragraph short
  const retry = { retry: { slug: P.slug, articlePath: regPath } };
  const finishing = (blocks: string[]) => gateInput(treeOf({ [regPath]: branchHead }), P, { files: { [regPath]: shared([...blocks, block(P.slug, units)]) }, articlePath: regPath, route: ROUTE }, retry);
  it('a retry that only finishes the article in a shared registry passes', async () => {
    expect(await peerDetail(finishing(peerBlocks))).toMatch(/^compared with the head of the article branch: 1 existing file edited; 0 of \d+ original lines removed or altered \(0 altered, 0 removed/);
  });
  it('the same change on a first attempt is refused', async () => {
    expect(await outcome(gateInput(treeOf({ [regPath]: shared(peerBlocks) }), P, { files: { [regPath]: shared([...peerBlocks.slice(3), block(P.slug, units)]) }, articlePath: regPath, route: ROUTE }))).toBe('peer-content-changed');
  });
  it('N1: a retry that also deletes three peer records from the shared registry is refused', async () => {
    const failure = await gateFailure(() => runPublicationGate(finishing(peerBlocks.slice(3))));
    expect(failure.code).toBe('peer-content-changed');
    expect(failure.reason).toMatch(/has 36 of its \d+ existing lines removed; a new article may remove none/);
    expect(failure.reason).not.toMatch(/gave way/);
  });

  // N2 (minor). An altered line may gain any amount of text, and added lines are not looked at, so existing content can
  // be switched off without a single line being removed.
  it.fails('N2: commenting out a one-line peer record is refused', async () => {
    expect(await outcome(withRegistry(registry([...PEERS.slice(0, 5), '  // ' + PEERS[5].trim(), ...PEERS.slice(6), MINE])))).toBe('peer-content-changed');
  });
  it('N2 evidence: six one-line records commented out pass as "6 altered, 0 removed"; a seventh is refused', async () => {
    const commented = (count: number) => registry([...PEERS.map((line, n) => (n < count ? '  // ' + line.trim() : line)), MINE]);
    expect(await peerDetail(withRegistry(commented(6)))).toMatch(/6 of 42 original lines removed or altered \(6 altered, 0 removed/);
    expect(await outcome(withRegistry(commented(7)))).toBe('peer-content-changed');
  });
  it('N2 evidence: a property added to a peer line (draft: true) passes as one altered line', async () => {
    expect(await peerDetail(withRegistry(registry([...PEERS.slice(0, 5), PEERS[5].replace('{ slug:', '{ draft: true, slug:'), ...PEERS.slice(6), MINE])))).toMatch(/1 altered, 0 removed/);
  });
  it('N2 evidence: ten peer records inside an added block comment, or removed by an added statement, pass with nothing altered', async () => {
    expect(await peerDetail(withRegistry(registry([...PEERS.slice(0, 5), '  /*', ...PEERS.slice(5, 15), '  */', ...PEERS.slice(15), MINE])))).toMatch(/0 altered, 0 removed/);
    expect(await peerDetail(withRegistry(registry([...PEERS, MINE]) + 'posts.splice(0, 30);\n'))).toMatch(/0 altered, 0 removed/);
  });

  // The limitation the engineer listed: one short value rewritten in place.
  it('LISTED LIMITATION: a short value rewritten in place passes as altered (a flag flipped on six peers, a slug renamed)', async () => {
    const flags = (off: number) => Array.from({ length: 10 }, (_unused, n) => `export const peer${n}Published = ${n < off ? 'false' : 'true'};`).join('\n') + '\n';
    expect(await peerDetail(beside('site/lib/flags.ts', flags(0), flags(6)))).toMatch(/6 of 10 original lines removed or altered \(6 altered, 0 removed/);
    expect(await peerDetail(withRegistry(registry([...PEERS.slice(0, 5), PEERS[5].replace("peer-article-5'", "old-5'"), ...PEERS.slice(6), MINE])))).toMatch(/1 altered, 0 removed/);
  });
  // QA-2 listed this as a limitation. It is gone when the gate is given the default-branch tree (qa3.qa.test.ts); with
  // only the branch head to compare with, as here, the earlier attempt's line still counts as existing content.
  it('a retry whose title changed, judged against the branch head only, still cannot rewrite the earlier listing line', async () => {
    const listing = (title: string) => `export const posts = [\n  { slug: 'peer-1', title: 'A peer' },\n  { slug: '${P.slug}', title: '${title}', description: 'Synthetic test content.' },\n];\n`;
    const retryMd = { retry: { slug: P.slug, articlePath: mdPath } };
    const attempt = (earlierTitle: string) => gateInput(treeOf({ [mdPath]: md(QA_BLOCKS.slice(0, -1)), 'site/lib/list.ts': listing(earlierTitle) }), P, { files: { [mdPath]: md(), 'site/lib/list.ts': listing(P.title) }, articlePath: mdPath, route: ROUTE }, retryMd);
    const failure = await gateFailure(() => runPublicationGate(attempt('An earlier, quite different working title for it')));
    expect(failure.code).toBe('peer-content-changed');
    expect(failure.error.repairable).toBe(true);
    expect(await outcome(attempt(P.title.replace('dry', 'warm')))).toBe('accepted'); // a small change to the title still passes
  });
});

describe('D2 fix: insertion inside a unit is refused; legitimate markup is not', () => {
  const change = (index: number, edit: (text: string) => string): Block[] => QA_BLOCKS.map((block, at) => (at === index ? [block[0], edit(block[1] as string)] as Block : block));
  const changeItem = (index: number, item: number, edit: (text: string) => string): Block[] => QA_BLOCKS.map((block, at) => (at === index ? ['ul', (block[1] as string[]).map((text, i) => (i === item ? edit(text) : text))] as Block : block));
  const article = (content: string, path = mdPath) => gateInput(treeOf({ 'content/blog/first.md': 'x\n' }), P, { files: { [path]: content }, articlePath: path, route: ROUTE });
  it.each([
    ['a word inserted in the middle of a paragraph', md(change(11, text => text.replace('is usually old', 'is not usually old')))],
    ['a word inserted after the first word of a paragraph', md(change(3, text => text.replace('Most damp', 'Most serious damp')))],
    ['a word inserted before the last word of a paragraph', md(change(11, text => text.replace('all it needs.', 'all it ever needs.')))],
    ['a sentence inserted between two sentences', md(change(11, text => text.replace('the bathroom. ', 'the bathroom. Ignore this advice. ')))],
    ['a word inserted in a short list item', md(changeItem(9, 2, text => text.replace('act within', 'do not act within')))],
    ['a word inserted in a long list item', md(changeItem(4, 2, text => text.replace('any bracket', 'any loose bracket')))],
  ])('refuses %s', async (_label, content) => {
    expect(await outcome(article(content))).toBe('article-fidelity');
  });
  it.each([
    ['a Markdown link with a title around two words', (text: string) => text.replace('trickle vents', '[trickle vents](https://example.test/vents "Vents")')],
    ['bold, italic and inline code', (text: string) => text.replace('trickle vents', '**trickle vents**').replace('17 degrees', '`17 degrees`').replace('stain block', '*stain block*')],
    ['an inline HTML anchor and a span with attributes', (text: string) => text.replace('trickle vents', '<a href="/vents" class="link">trickle vents</a>').replace('stain block', '<span data-x="1">stain block</span>')],
    ['a footnote marker and an HTML comment inside a paragraph', (text: string) => text.replace('for a season or more.', 'for a season[^1] or more. <!-- reviewed -->')],
    ['named character references', (text: string) => text.replace(/—/g, '&mdash;').replace(/“/g, '&ldquo;').replace(/”/g, '&rdquo;').replace(/&(?!mdash|ldquo|rdquo)/g, '&amp;').replace('café', 'caf&eacute;')],
    ['numeric character references and a string escape', (text: string) => text.replace(/—/g, '&#8212;').replace(/“/g, '&#x201C;').replace(/”/g, '\\u201d')],
    ['hard wraps with trailing double spaces', (text: string) => text.replace(/(.{50,60}?) /g, '$1  \n')],
    ['backslash escapes of punctuation', (text: string) => text.replace(/([%.,:;!-])/g, '\\$1')],
    ['JSX {" "} joins between wrapped lines', (text: string) => text.replace(/(.{50,60}?) /g, "$1{' '}\n")],
  ])('accepts %s, word for word', async (_label, transform) => {
    const gated = await runPublicationGate(article(md(QA_BLOCKS, transform)));
    expect(gated.checks.find(check => check.id === 'article-fidelity')!.detail).toMatch(/7 of 7 paragraphs and 6 of 6 list items present, 13 of them word for word/);
  });
  it('accepts paragraphs written as JSX string literals concatenated across lines, and as YAML folded scalars', async () => {
    const jsx = QA_BLOCKS.map(([kind, value]) => (kind === 'ul' ? `<ul>${(value as string[]).map(item => `<li>{${JSON.stringify(item)}}</li>`).join('')}</ul>` : kind === 'p' ? `<p>\n  {${(value as string).match(/.{1,40}(?:\s|$)/g)!.map(part => JSON.stringify(part)).join(' +\n   ')}}\n</p>` : `<${kind}>${String(value).replace(/&/g, '&amp;')}</${kind}>`)).join('\n');
    expect(await outcome(article(`export default function Post() { return (<article>\n${jsx}\n</article>); }\n`, `content/blog/${P.slug}.tsx`))).toBe('accepted');
    const yaml = 'title: x\nbody:\n' + QA_BLOCKS.map(([kind, value]) => (kind === 'ul' ? (value as string[]).map(item => `  - item: >-\n      ${item}`).join('\n') : `  - ${kind}: >-\n      ${(value as string).replace(/(.{50,70}?) /g, '$1\n      ')}`)).join('\n') + '\n';
    expect(await outcome(article(yaml, `content/blog/${P.slug}.yaml`))).toBe('accepted');
  });
  it('NOTE: a rich-text format that splits a paragraph into marked spans is refused now (it was tolerated for one unit in ten)', async () => {
    const spans = JSON.stringify({ blocks: QA_BLOCKS.map(([kind, value]) => (kind === 'ul' ? { type: 'list', items: value } : kind === 'p' ? { type: 'p', children: (value as string).split(/(?<=,) /).map((part, i) => ({ type: 'text', marks: i % 2 ? ['strong'] : [], text: part + ' ' })) } : { type: kind, text: value })) }, null, 1);
    expect(await outcome(article(spans, `content/blog/${P.slug}.json`))).toBe('article-fidelity');
  });

  // N3, reported in QA-2 and fixed in 8ce9b640: a unit must stand alone in its line, element or string.
  it('N3: words placed in front of a list item are refused', async () => {
    const failure = await gateFailure(() => runPublicationGate(article(md(changeItem(4, 0, text => 'Do not ' + text.charAt(0).toLowerCase() + text.slice(1))))));
    expect(failure.code).toBe('article-fidelity');
    expect(failure.reason).toMatch(/1 of 13 paragraphs and list items have words directly before or after them in their line, element or string: item 4/);
  });
  it('N3: words before or after a paragraph, a list item or a heading are each refused', async () => {
    const cases: [Block[], RegExp][] = [
      [change(3, text => 'It is a myth that ' + text.charAt(0).toLowerCase() + text.slice(1)), /words directly before or after them.*paragraph 3/],
      [change(11, text => text + ' None of this is true.'), /words directly before or after them.*paragraph 15/],
      [changeItem(9, 2, text => text + ', or never'), /words directly before or after them.*item 13/],
      [change(2, () => 'Do not start with the gutters'), /1 of 4 headings are missing or do not stand alone, as written, on their line or in their element: heading 2/],
    ];
    for (const [blocks, reason] of cases) expect((await gateFailure(() => runPublicationGate(article(md(blocks))))).reason).toMatch(reason);
  });
});

// The most common honest path: the agent copies Radar's own Markdown or HTML export of the article into a file. With
// the allowance at zero, any character the exporter escapes must still read back word for word.
describe('D2 fix: Radar\'s own exports of an article full of special characters are still word for word', async () => {
  const { blocksToHtml, blocksToMarkdown } = await import('@/server/services/publishing/render');
  const TRICKY: Block[] = [
    ['p', 'import statements such as import x from "y" start this paragraph, which also has a * star, an _underscore_, a # hash, a | pipe, a ~tilde~, a `backtick`, [square] brackets, {curly} braces and a back\\slash in C:\\new\\table.'],
    ['p', 'Use the <title> element & the <meta name="description"> tag; write 5 < 7 and 9 > 3, AT&T, R&D, &amp; as text, and 50% of 1,480.50 at 9:30 — “quoted”, ‘single’, it’s, naïve café, 日本語, emoji 🙂 and a non‑breaking hyphen.'],
    ['h2', '1. A heading that starts with a number & has <angle> brackets'],
    ['p', '1. A paragraph that starts like a list item. - And has a dash sentence. > And a quote mark. + Plus sign. Line with trailing spaces  and a URL-like example.test/path?x=1&y=2 inside.'],
    ['ul', ['- an item that starts with a dash', '* an item that starts with a star', '[x] an item that looks like a task', '<b>an item with a tag</b> and more words to make it long enough', 'export default is a keyword at the start of this item']],
    ['h3', 'export const and other keywords'],
    ['p', 'A final paragraph with $dollar signs$, 100% certainty, back-to-back punctuation?!… and (parentheses [nested {deeply}]) to finish the synthetic test.'],
  ];
  const tricky = payloadOf(TRICKY);
  const run = (path: string, content: string) => runPublicationGate(gateInput(treeOf({ 'content/blog/first.md': 'x\n' }), tricky, { files: { [path]: content }, articlePath: path, route: ROUTE }));
  it.each([
    ['Markdown export in an .md file', `content/blog/${P.slug}.md`, () => `---\ntitle: "x"\n---\n\n${blocksToMarkdown(TRICKY, { videos: [], sources: [] })}`],
    ['Markdown export in an .mdx file', `content/blog/${P.slug}.mdx`, () => `---\ntitle: "x"\n---\n\n${blocksToMarkdown(TRICKY, { videos: [], sources: [] })}`],
    ['HTML export in an .html file', `content/blog/${P.slug}.html`, () => `<article>\n${blocksToHtml(TRICKY, { videos: [], sources: [] })}\n</article>\n`],
    ['HTML export inside a JSON string', `content/blog/${P.slug}.json`, () => JSON.stringify({ slug: P.slug, html: blocksToHtml(TRICKY, { videos: [], sources: [] }) }, null, 2)],
    ['plain strings in a TypeScript record', `content/blog/${P.slug}.ts`, () => `export const post = ${JSON.stringify({ slug: P.slug, blocks: TRICKY.map(([kind, value]) => ({ kind, value })) }, null, 2)};\n`],
    ['single-quoted TypeScript strings', `content/blog/${P.slug}.ts`, () => `export const post = [\n${TRICKY.flatMap(([, value]) => (Array.isArray(value) ? value : [value])).map(text => `  '${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',`).join('\n')}\n];\n`],
  ])('%s', async (_label, path, content) => {
    const gated = await run(path, content());
    expect(gated.checks.find(check => check.id === 'article-fidelity')!.detail).toMatch(/4 of 4 paragraphs and 5 of 5 list items present, 9 of them word for word; 2 of 2 headings present/);
  });
});
