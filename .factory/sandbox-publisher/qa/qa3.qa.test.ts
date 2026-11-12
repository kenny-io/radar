// QA-3 (code revision 8ce9b640): the fixes for N1 (retry compared with the default branch) and N3 (unit edges).
// Three questions per fix: does it refuse what it should, does it still accept honest work, and what gets around it.
// Tests written "it.fails" assert what should hold and does not on this revision (N7a, N7b and N8 in the QA-3 report).
import { describe, expect, it } from 'vitest';
import type { Block } from '@/lib/types';
import { blocksToHtml, blocksToMarkdown } from '@/server/services/publishing/render';
import { runPublicationGate } from '@/server/services/publishing/sandbox/gate';
import type { PublishPayload } from '@/server/services/publishing/types';
import { QA_BLOCKS, filler, gateFailure, gateInput, payloadOf, toMarkdown, treeOf, type QaTree } from './helpers';

const P = payloadOf();
const ROUTE = `/blog/${P.slug}`;
const flat = QA_BLOCKS.flatMap(block => (block[0] === 'ul' ? (block[1] as string[]) : [block[1] as string]));
const q = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const ITEM = 'Clear leaves from every gutter run twice before December';
const PARA = QA_BLOCKS[3][1] as string;
const MD = `content/blog/${P.slug}.md`;
const md = (transform: (text: string) => string = text => text, blocks: Block[] = QA_BLOCKS) => `---\ntitle: "${P.title}"\nslug: "${P.slug}"\n---\n\n` + transform(toMarkdown(blocks));
const article = (path: string, content: string, payload: PublishPayload = P) => gateInput(treeOf({ 'content/blog/first.md': 'x\n' }), payload, { files: { [path]: content }, articlePath: path, route: ROUTE });
/** 'accepted', 'accepted, not decided', or the refusal: code plus the fidelity rule words that identify it. */
async function verdict(input: Parameters<typeof runPublicationGate>[0]): Promise<string> {
  try {
    const gated = await runPublicationGate(input);
    return /not decided/.test(gated.checks.find(check => check.id === 'article-fidelity')!.detail) ? 'accepted, not decided' : 'accepted';
  } catch (error: any) {
    const reason = String(error?.diagnostic?.reason);
    return `${error?.diagnostic?.code}${/words directly before or after/.test(reason) ? ': extended' : /headings are missing or do not stand alone/.test(reason) ? ': headings' : ''}`;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// N1: a retry or migration is compared with the default-branch commit the article branch started from

describe('N1 fix: a retry is held to first-attempt rules against the default branch', () => {
  const REG = 'site/lib/registry.ts';
  const block = (slug: string, paragraphs: string[], title = `Title of ${slug}`) => `  {\n    slug: '${slug}',\n    title: '${title}',\n    sections: [\n${paragraphs.map(text => `      ${JSON.stringify(text)},`).join('\n')}\n    ],\n  },\n`;
  const peers = Array.from({ length: 12 }, (_unused, n) => block(`peer-${n}`, [0, 50, 90, 130, 170, 210].map(seed => filler(n + seed, 4))));
  const shared = (blocks: string[]) => `export const registry = [\n${blocks.join('')}];\n`;
  const flags = (off: number, count = 10) => Array.from({ length: count }, (_unused, n) => `export const f${n} = ${n < off ? 'false' : 'true'};`).join('\n') + '\n';
  const BASE = () => treeOf({ [REG]: shared(peers), 'site/lib/flags.ts': flags(0), 'README.md': '# x\n' });
  /** The branch head: the default branch plus an earlier attempt's unfinished record under an earlier title. */
  const HEAD = (extra: Record<string, string> = {}) => treeOf({ [REG]: shared([...peers, block(P.slug, flat.slice(0, -1), 'An earlier, quite different working title')]), 'site/lib/flags.ts': flags(0), 'README.md': '# x\n', ...extra });
  const finished = shared([...peers, block(P.slug, flat, P.title)]);
  const RETRY = { retry: { slug: P.slug, articlePath: REG } };
  const attempt = (files: Record<string, string>, head: QaTree = HEAD(), base: QaTree | null = BASE(), options: Record<string, unknown> = RETRY) => gateInput(head, P, { files, articlePath: REG, route: ROUTE }, options, base ?? undefined);
  const peerDetail = async (input: Parameters<typeof runPublicationGate>[0]) => (await runPublicationGate(input)).checks.find(check => check.id === 'peer-content')!.detail;

  it('an honest retry may finish its own record and rewrite its own title line', async () => {
    expect(await peerDetail(attempt({ [REG]: finished }))).toMatch(/^compared with the default-branch commit the article branch started from: 1 existing file edited; 0 of 146 original lines removed or altered \(0 altered, 0 removed/);
  });
  it.each([
    ['three peer records deleted from the shared registry (QA-2 finding N1)', () => ({ [REG]: shared([...peers.slice(3), block(P.slug, flat, P.title)]) }), /36 of its 146 existing lines on the default branch removed/],
    ['a peer title rewritten', () => ({ [REG]: finished.replace("title: 'Title of peer-4'", "title: 'Something else entirely here'") }), /1 of its 146 existing lines on the default branch removed/],
    ['a default-branch line deleted in another file', () => ({ [REG]: finished, 'site/lib/flags.ts': flags(0, 9) }), /site\/lib\/flags\.ts has 1 of its 10 existing lines on the default branch removed/],
    ['the registry re-indented', () => ({ [REG]: finished.split('\n').map(line => (line ? '  ' + line : line)).join('\n') }), /existing lines on the default branch/],
  ])('refuses a retry with %s', async (_label, files, reason) => {
    const failure = await gateFailure(() => runPublicationGate(attempt(files())));
    expect(failure.code).toBe('peer-content-changed');
    expect(failure.reason).toMatch(reason);
    expect(failure.reason).toMatch(/Lines an earlier attempt on this branch added are not existing lines and may be changed|limit for this file/);
  });
  it('a legacy migration is held to the same rule', async () => {
    expect(await verdict(attempt({ [REG]: shared([...peers.slice(3), block(P.slug, flat, P.title)]) }, HEAD(), BASE(), { legacy: { slug: P.slug, articlePath: REG } }))).toBe('peer-content-changed');
  });
  it('altered lines are counted against the default branch across attempts', async () => {
    const earlier = HEAD({ 'site/lib/flags.ts': flags(4) }); // the earlier attempt altered four default-branch lines
    expect(await verdict(attempt({ [REG]: finished, 'site/lib/flags.ts': flags(7) }, earlier))).toBe('peer-content-changed'); // 4 + 3
    expect(await peerDetail(attempt({ [REG]: finished, 'site/lib/flags.ts': flags(6) }, earlier))).toMatch(/6 of 156 original lines removed or altered \(6 altered, 0 removed.*Review the 6 existing lines the article branch altered/);
    expect(await peerDetail(attempt({ [REG]: finished, 'site/lib/flags.ts': flags(0) }, earlier))).toMatch(/0 altered, 0 removed/); // putting them back is fine
  });
  it('a file an earlier attempt added may be rewritten, and the check says it was not compared', async () => {
    const own = Array.from({ length: 30 }, (_unused, n) => `export const o${n} = ${n};`).join('\n') + '\n';
    expect(await peerDetail(attempt({ [REG]: finished, 'site/lib/own.ts': 'export const o = 1;\n' }, HEAD({ 'site/lib/own.ts': own })))).toMatch(/1 changed file exists only on the article branch, written by an earlier attempt, and is not compared/);
  });
  it('a file that is a link, or not text, on the default branch cannot be changed on a retry', async () => {
    const linked = treeOf({ [REG]: shared(peers), 'README.md': '# x\n' }, [{ path: 'site/lib/flags.ts', type: 'blob', mode: '120000', sha: 'a'.repeat(40), size: 9 }]);
    expect(await verdict(attempt({ [REG]: finished, 'site/lib/flags.ts': flags(1) }, HEAD(), linked))).toBe('non-regular-file');
    const binary = treeOf({ [REG]: shared(peers), 'README.md': '# x\n', 'site/lib/flags.ts': Buffer.from([0xff, 0xfe, 0x00, 0x01]) });
    const failure = await gateFailure(() => runPublicationGate(attempt({ [REG]: finished, 'site/lib/flags.ts': flags(1) }, HEAD(), binary)));
    expect([failure.code, failure.error.repairable]).toEqual(['peer-content-changed', false]);
  });
  it('a refresh retry keeps the refresh tolerance, measured against the default branch', async () => {
    const R = payloadOf(QA_BLOCKS, { mode: 'refresh', refreshUrl: '/blog/peer-3', canonical: '/blog/peer-3' });
    const head = treeOf({ [REG]: shared([...peers.slice(0, 3), block('peer-3', flat.slice(0, 5)), ...peers.slice(4)]), 'README.md': '# x\n' });
    const refresh = (registry: string) => gateInput(head, R, { files: { [REG]: registry }, articlePath: REG, route: '/blog/peer-3', slug: 'peer-3' }, { retry: { slug: 'peer-3', articlePath: REG } }, BASE());
    expect(await verdict(refresh(shared([...peers.slice(0, 3), block('peer-3', flat), ...peers.slice(4)])))).toBe('accepted');
    const failure = await gateFailure(() => runPublicationGate(refresh(shared([block('peer-3', flat)]))));
    expect(failure.reason).toMatch(/loses 138 of its 146 existing lines on the default branch while adding 17/);
  });

  // The limitation QA-2 listed is gone when the connector supplies the base tree, and is back, strictly, when it cannot.
  const LIST = 'site/lib/list.ts';
  const listing = (title?: string, peer = true) => `export const posts = [\n${peer ? "  { slug: 'peer-1', title: 'A peer' },\n" : ''}${title ? `  { slug: '${P.slug}', title: '${title}', description: 'Synthetic test content.' },\n` : ''}];\n`;
  const listHead = () => treeOf({ [MD]: md(undefined, QA_BLOCKS.slice(0, -1)), [LIST]: listing('An earlier, quite different working title for it'), 'README.md': '# x\n' });
  const listRetry = (files: Record<string, string>, base: QaTree | null) => gateInput(listHead(), P, { files, articlePath: MD, route: ROUTE }, { retry: { slug: P.slug, articlePath: MD } }, base ?? undefined);
  it('a retry after a title change may rewrite the listing line the earlier attempt added, but not the peer beside it', async () => {
    const base = treeOf({ [LIST]: listing(), 'README.md': '# x\n' });
    expect(await peerDetail(listRetry({ [MD]: md(), [LIST]: listing(P.title) }, base))).toMatch(/0 of 3 original lines removed or altered.*1 changed file exists only on the article branch/);
    expect(await verdict(listRetry({ [MD]: md(), [LIST]: listing(P.title, false) }, base))).toBe('peer-content-changed');
  });
  it('without a base tree the gate compares with the branch head: stricter, never weaker', async () => {
    const failure = await gateFailure(() => runPublicationGate(listRetry({ [MD]: md(), [LIST]: listing(P.title) }, null)));
    expect(failure.code).toBe('peer-content-changed'); // the earlier attempt's own line counts as existing here
    expect(await verdict(attempt({ [REG]: shared([...peers.slice(3), block(P.slug, flat, P.title)]) }, HEAD(), null))).toBe('peer-content-changed');
    expect(await peerDetail(attempt({ [REG]: shared([...peers, block(P.slug, flat, 'An earlier, quite different working title')]) }, HEAD(), null))).toMatch(/^compared with the head of the article branch: /);
  });

  // RESIDUAL (low). "Not in the base tree" is read as "written by an earlier attempt". That is wrong for a default-branch
  // file that reached the article branch some other way than a merge (a cherry-pick, say), because the merge base is
  // then older than the file: the retry may gut it, and the check says it was the earlier attempt's own.
  it('RESIDUAL: a default-branch file that the merge base does not have is not protected on a retry', async () => {
    const olderBase = treeOf({ [REG]: shared(peers), 'README.md': '# x\n' });
    const gutted = { [REG]: finished, 'site/lib/flags.ts': flags(0, 1) };
    expect(await peerDetail(attempt(gutted, HEAD(), olderBase))).toMatch(/1 changed file exists only on the article branch, written by an earlier attempt, and is not compared/);
    expect(await verdict(attempt(gutted, HEAD(), null))).toBe('peer-content-changed'); // the head comparison would have caught it
  });
  it('a default-branch file missing from the branch head is compared with the default branch when the retry writes it again', async () => {
    const head = treeOf({ [REG]: shared([...peers, block(P.slug, flat.slice(0, -1), 'An earlier, quite different working title')]), 'README.md': '# x\n' }); // flags.ts was deleted on the branch
    expect(await verdict(attempt({ [REG]: finished, 'site/lib/flags.ts': flags(0) }, head))).toBe('accepted'); // put back as it was
    const failure = await gateFailure(() => runPublicationGate(attempt({ [REG]: finished, 'site/lib/flags.ts': flags(0, 4) }, head)));
    expect(failure.reason).toMatch(/site\/lib\/flags\.ts has 6 of its 10 existing lines on the default branch removed/);
  });
  it('RESIDUAL, same cause: a default-branch file renamed on the article branch is not protected under its new name', async () => {
    const renamed = treeOf({ [REG]: shared([...peers, block(P.slug, flat.slice(0, -1), 'An earlier, quite different working title')]), 'site/lib/feature-flags.ts': flags(0), 'README.md': '# x\n' });
    const gutted = { [REG]: finished, 'site/lib/feature-flags.ts': flags(0, 1) };
    expect(await peerDetail(attempt(gutted, renamed))).toMatch(/1 changed file exists only on the article branch, written by an earlier attempt, and is not compared/);
    expect(await verdict(attempt(gutted, renamed, null))).toBe('peer-content-changed');
  });
  // KNOWN (architecture section 15): a foreign commit on the branch is not re-gated unless this attempt touches the file.
  it('KNOWN: a file gutted by a foreign commit blocks a retry that touches it and is ignored by one that does not', async () => {
    const foreign = HEAD({ 'site/lib/flags.ts': flags(0, 1) });
    expect(await verdict(attempt({ [REG]: finished, 'site/lib/flags.ts': flags(0, 1) + 'export const mine = true;\n' }, foreign))).toBe('peer-content-changed');
    expect(await verdict(attempt({ [REG]: finished }, foreign))).toBe('accepted');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// N3: a unit must stand alone in the piece of text that carries it

const VIDEO = { videos: [{ id: 'dQw4w9WgXcQ', title: 'How gutters work', channel: 'Synthetic Channel' }], sources: [{ title: 'A synthetic source about damp', url: 'https://example.test/damp', use: 'cited' }, { title: 'Second source', url: 'https://example.test/two', use: 'cited' }], bodyImages: [{ id: 'i1', after: { heading: 'Start with the gutters', occurrence: 0, block: 2 }, url: 'https://cdn.example.test/img/gutter.png', alt: 'A gutter full of leaves on a terrace house', prompt: '', seed: 1 }, { id: 'i2', after: { heading: '', occurrence: 0, block: 0 }, url: 'https://cdn.example.test/img/row.png', alt: 'Tidewater Row seen from the rope works', prompt: '', seed: 2 }] } as any;
/** The article as Radar exports it when it has two body images, one video and two sources. */
const FULL = payloadOf(QA_BLOCKS, { html: blocksToHtml(QA_BLOCKS, VIDEO), markdown: blocksToMarkdown(QA_BLOCKS, VIDEO), videos: [{ id: 'dQw4w9WgXcQ', title: 'How gutters work', channel: 'Synthetic Channel', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }], sources: [{ title: 'A synthetic source about damp', url: 'https://example.test/damp' }, { title: 'Second source', url: 'https://example.test/two' }] });
const PLAIN_MD = blocksToMarkdown(QA_BLOCKS, { videos: [], sources: [] });
const html = QA_BLOCKS.map(([kind, value]) => (kind === 'ul' ? `<ul>\n${(value as string[]).map(item => `  <li>${item.replace(/&/g, '&amp;')}</li>`).join('\n')}\n</ul>` : `<${kind}>${String(value).replace(/&/g, '&amp;')}</${kind}>`)).join('\n');
const template = (body: string) => `export const post = {\n  slug: '${P.slug}',\n  body: \`\n${body.replace(/[`$\\]/g, '\\$&')}\`,\n};\n`;

describe('N3 fix: honest carriers still pass', () => {
  // The three repositories of the live replays, as their own files are laid out.
  const sections: string[] = []; let current: { heading?: string; paragraphs: string[]; bullets: string[] } = { paragraphs: [], bullets: [] };
  const close = () => { if (current.heading || current.paragraphs.length || current.bullets.length) sections.push(`      {\n${current.heading ? `        heading: ${q(current.heading)},\n` : ''}        paragraphs: [\n${current.paragraphs.map(text => `          ${q(text)},`).join('\n')}\n        ],\n${current.bullets.length ? `        bullets: [\n${current.bullets.map(text => `          ${q(text)},`).join('\n')}\n        ],\n` : ''}      },`); };
  for (const [kind, value] of QA_BLOCKS) { if (kind === 'h2' || kind === 'h3') { close(); current = { heading: value as string, paragraphs: [], bullets: [] }; } else if (kind === 'ul') current.bullets.push(...(value as string[])); else current.paragraphs.push(value as string); }
  close();
  const typedRecord = `export type BlogPost = { slug: string };\n\nexport const BLOG_POSTS: BlogPost[] = [\n  {\n    slug: '${P.slug}',\n    title: ${q(P.title)},\n    description:\n      ${q(P.meta)},\n    lede: ${q(P.meta)},\n    keywords: [\n      'keep terrace house dry',\n    ],\n    category: 'Guides',\n    author: { name: 'The Desk', role: 'Editors' },\n    readingMinutes: 3,\n    heroImageAlt: 'A terrace of houses',\n    sections: [\n${sections.join('\n')}\n    ],\n    faq: [],\n  },\n  {\n    slug: 'peer',\n    title: 'Peer',\n    sections: [{ heading: 'Old', paragraphs: ['An older paragraph.'] }],\n  },\n];\n`;
  const hub = `export const HUBS = [\n  {\n    slug: 'x',\n    sections: [{\n${QA_BLOCKS.map(([kind, value]) => (kind === 'ul' ? `        bullets: ${JSON.stringify(value)},` : kind === 'p' ? `        body: ${JSON.stringify(value)},` : `        heading: ${JSON.stringify(value)},`)).join('\n')}\n    }],\n  },\n];\n`;
  const jsxText = QA_BLOCKS.map(([kind, value]) => (kind === 'ul' ? `      <ul>\n${(value as string[]).map(item => `        <li>${item.replace(/&/g, '&amp;')}</li>`).join('\n')}\n      </ul>` : `      <${kind}>\n        ${String(value).replace(/&/g, '&amp;').replace(/’/g, '&rsquo;')}\n      </${kind}>`)).join('\n');
  const jsxStrings = QA_BLOCKS.map(([kind, value]) => (kind === 'ul' ? `      <ul>\n${(value as string[]).map(item => `        <li>{${JSON.stringify(item)}}</li>`).join('\n')}\n      </ul>` : `      <${kind}>{${JSON.stringify(value)}}</${kind}>`)).join('\n');
  const page = (body: string) => `export default function Page() {\n  return (\n    <article>\n${body}\n    </article>\n  );\n}\n`;
  const yamlBlocks = `slug: ${P.slug}\ntitle: "${P.title}"\nblocks:\n${QA_BLOCKS.map(([kind, value]) => (kind === 'ul' ? `  - type: list\n    items:\n${(value as string[]).map(item => `      - ${JSON.stringify(item)}`).join('\n')}` : `  - type: ${kind}\n    text: ${JSON.stringify(value)}`)).join('\n')}\n`;
  const yamlPlain = `slug: ${P.slug}\nblocks:\n${QA_BLOCKS.map(([kind, value]) => (kind === 'ul' ? `  - items:\n${(value as string[]).map(item => `      - ${item.replace(/: /g, ' - ').replace(/^(.{50,60}?) /, '$1\n        ')}`).join('\n')}` : `  - ${kind}: ${String(value).replace(/: /g, ' - ').replace(/(.{60,70}?) /g, '$1\n      ')}`)).join('\n')}\n`;

  it.each<[string, string, string, PublishPayload?]>([
    ['LivedHQ: a typed registry record with heading, paragraphs and bullets per section', 'apps/web/app/blog/posts.ts', typedRecord],
    ['LivedHQ: a hub record, one field per line', 'apps/web/app/rent/dubai/hubs.ts', hub],
    ['thally-website: content.mdx holding Radar\'s Markdown export', 'src/app/blog/x/content.mdx', PLAIN_MD],
    ['radar-connector-test: an .mdx post with front matter', 'content/posts/x.mdx', md()],
    ['Radar\'s Markdown export with images, a video and sources, in .mdx', 'content/posts/x.mdx', `---\ntitle: "x"\n---\n\n${FULL.markdown}`, FULL],
    ['Radar\'s HTML export with images, a video and sources, in .html', 'content/posts/x.html', `<article>\n${FULL.html}\n</article>\n`, FULL],
    ['Radar\'s HTML export inside a JSON string', 'content/posts/x.json', JSON.stringify({ slug: P.slug, html: FULL.html }, null, 2), FULL],
    ['Radar\'s Markdown export (no video) inside a JSON string', 'content/posts/x.json', JSON.stringify({ slug: P.slug, body: PLAIN_MD }, null, 2)],
    ['Radar\'s Markdown export (no video) inside a TypeScript template literal', 'content/posts/x.ts', template(PLAIN_MD)],
    ['Markdown: a paragraph directly under its heading', MD, md(text => text.replace(/^(#{2,3} .*)\n\n/gm, '$1\n'))],
    ['Markdown: a list directly after its paragraph', MD, md(text => text.replace(/\n\n- /g, '\n- '))],
    ['Markdown: lines wrapped at 70 columns', MD, md(text => text.replace(/(.{55,70}?) /g, '$1\n'))],
    ['Markdown: star bullets', MD, md(text => text.replace(/^- /gm, '* '))],
    ['Markdown: numbered list items', MD, md(text => { let n = 0; return text.replace(/^- /gm, () => `${++n}. `); })],
    ['Markdown: list indented two spaces', MD, md(text => text.replace(/^- /gm, '  - '))],
    ['Markdown: underlined (setext) headings', MD, md(text => text.replace(/^## (.*)$/gm, (_match, heading) => `${heading}\n${'-'.repeat(String(heading).length)}`))],
    ['Markdown: headings with an {#id}', MD, md(text => text.replace(/^(#{2,3} .*)$/gm, '$1 {#sec}'))],
    ['Markdown: closed headings (## x ##)', MD, md(text => text.replace(/^(#{2,3}) (.*)$/gm, '$1 $2 $1'))],
    ['Markdown: bold lines where the site has no h3', MD, md(text => text.replace(/^### (.*)$/gm, '**$1**'))],
    ['Markdown: paragraphs as block quotes', MD, md(text => text.replace(/^(?![#-]|$)/gm, '> '))],
    ['Markdown: an image above a paragraph, blank line between', MD, md(text => text.replace('Most damp in a terrace', '![A gutter full of leaves](/img/g.png)\n\nMost damp in a terrace'))],
    ['Markdown: TOML front matter (+++)', MD, `+++\ntitle = "x"\ndate = 2026-11-12\n+++\n\n${toMarkdown(QA_BLOCKS)}`],
    ['Markdown: front matter description repeats the first paragraph, folded', MD, `---\ntitle: "x"\ndescription: >-\n  ${(QA_BLOCKS[0][1] as string).replace(/(.{60,70}?) /g, '$1\n  ')}\n---\n\n${toMarkdown(QA_BLOCKS)}`],
    ['MDX: a component wrapped around two paragraphs on its own lines', 'content/posts/x.mdx', md(text => text.replace('A hygrometer costs', '<Callout type="tip">\nA hygrometer costs').replace('“the three-day rule”.', '“the three-day rule”.\n</Callout>'))],
    ['MDX: a component around one paragraph, on the paragraph\'s own line', 'content/posts/x.mdx', md(text => text.replace(/^(Tidewater Row.*)$/m, '<Lead>$1</Lead>'))],
    ['MDX: export const metadata above the body', 'content/posts/x.mdx', `export const metadata = {\n  title: "${P.title}",\n  description: "${P.meta}",\n};\n\n${toMarkdown(QA_BLOCKS)}`],
    ['HTML: plain block elements', 'site/post.html', `<article class="post">\n${html}\n</article>\n`],
    ['HTML: sections and divs with wrapped lines', 'site/post.html', `<section>\n<div class="prose">\n${html.replace(/(.{60,70}?) /g, '$1\n  ')}\n</div>\n</section>\n`],
    ['HTML: two paragraphs in one <p>, separated by <br><br>', 'site/post.html', `<p>${flat.slice(0, 2).join('<br><br>')}</p>\n${html.split('\n').slice(2).join('\n')}`],
    ['Astro page', 'src/pages/post.astro', `---\nconst title = "${P.title}";\n---\n<Layout title={title}>\n${html}\n</Layout>\n`],
    ['Vue single-file component', 'src/pages/Post.vue', `<template>\n<article>\n${html}\n</article>\n</template>\n<script setup>\nconst title = "x";\n</script>\n`],
    ['Svelte page', 'src/routes/post/+page.svelte', `<script>\n  export let data;\n</script>\n\n<article>\n${html}\n</article>\n`],
    ['PHP template', 'posts/x.php', `<?php $title = "x"; ?>\n${html}\n`],
    ['TSX page: text children', 'src/app/blog/x/page.tsx', page(jsxText)],
    ['TSX page: string expression children', 'src/app/blog/x/page.tsx', page(jsxStrings)],
    ['YAML data: quoted scalars in lists', 'data/posts/x.yaml', yamlBlocks],
    ['YAML data: plain multi-line scalars', 'data/posts/x.yml', yamlPlain],
    ['YAML: a Markdown body in a literal block', 'data/posts/x.yaml', `slug: ${P.slug}\nbody: |\n${toMarkdown(QA_BLOCKS).split('\n').map(line => (line ? '  ' + line : '')).join('\n')}`],
    ['JSON: an array of blocks', 'data/posts/x.json', JSON.stringify({ slug: P.slug, blocks: QA_BLOCKS }, null, 2)],
    ['plain text, one unit per paragraph', 'content/posts/x.txt', flat.join('\n\n') + '\n'],
    ['reStructuredText', 'content/posts/x.rst', QA_BLOCKS.map(([kind, value]) => (kind === 'ul' ? (value as string[]).map(item => `* ${item}`).join('\n') : kind === 'p' ? value : `${value}\n${'='.repeat(String(value).length)}`)).join('\n\n') + '\n'],
  ])('%s', async (_label, path, content, payload) => {
    expect(await verdict(article(path, content, payload))).toBe('accepted');
  });

  it.each<[string, string, string]>([
    ['TSX page: the site\'s own components instead of p, li and h2', 'src/app/blog/x/page.tsx', `export default function Page() {\n  return (\n    <Prose>\n${QA_BLOCKS.map(([kind, value]) => (kind === 'ul' ? `      <List>\n${(value as string[]).map(item => `        <Item>{${JSON.stringify(item)}}</Item>`).join('\n')}\n      </List>` : kind === 'p' ? `      <P>{${JSON.stringify(value)}}</P>` : `      <Heading level={2}>{${JSON.stringify(value)}}</Heading>`)).join('\n')}\n    </Prose>\n  );\n}\n`],
  ])('passes with the edges disclosed as not decided: %s', async (_label, path, content) => {
    expect(await verdict(article(path, content))).toBe('accepted, not decided');
  });

  // What the engineer listed as honest and refused, confirmed. Each gets the repair round.
  it.each<[string, string, string, string]>([
    ['an image directly above a paragraph, no blank line', MD, md(text => text.replace('Most damp in a terrace', '![A gutter full of leaves](/img/g.png)\nMost damp in a terrace')), 'article-fidelity: extended'],
    ['a template that numbers its headings', MD, md(text => { let n = 0; return text.replace(/^## /gm, () => `## ${++n}. `); }), 'article-fidelity: headings'],
    ['the body directly under TOML front matter, no blank line', MD, `+++\ntitle = "x"\n+++\n${toMarkdown(QA_BLOCKS)}`, 'article-fidelity: extended'],
    ['list items turned into a one-column table', MD, md(text => text.replace(/((?:^- .*\n)+)/gm, rows => '| Step |\n| --- |\n' + rows.replace(/^- (.*)$/gm, '| $1 |'))), 'article-fidelity: extended'],
    ['a YAML value with a trailing comment', 'data/x.yaml', `blocks:\n${flat.map(text => `  - ${JSON.stringify(text)}${text === ITEM ? ' # reviewed' : ''}`).join('\n')}\n`, 'article-fidelity: extended'],
  ])('LISTED as refused although honest: %s', async (_label, path, content, expected) => {
    expect(await verdict(article(path, content))).toBe(expected);
  });

  // N7 (minor, new). Two honest carriers refused that the engineer did not list.
  // (a) A string that holds Markdown is read by Markdown's line rules only when it holds no block-level HTML. Radar's own
  //     Markdown export of an article with a video contains an <iframe>, so in a JSON, TypeScript or YAML string every
  //     unit after the video is refused as having words beside it, and the repair round cannot fix that.
  it.fails('N7a: Radar\'s Markdown export of an article with a video is accepted inside a JSON string', async () => {
    expect(await verdict(article('content/posts/x.json', JSON.stringify({ slug: P.slug, body: FULL.markdown }, null, 2), FULL))).toBe('accepted');
  });
  it('N7a evidence: refused in a JSON string, a template literal and a YAML block; accepted as a .md file and without the video', async () => {
    const yaml = `slug: ${P.slug}\nbody: |\n${FULL.markdown.split('\n').map(line => (line ? '  ' + line : '')).join('\n')}`;
    for (const [path, content] of [['content/posts/x.json', JSON.stringify({ slug: P.slug, body: FULL.markdown }, null, 2)], ['content/posts/x.ts', template(FULL.markdown)], ['content/posts/x.yaml', yaml]]) {
      const failure = await gateFailure(() => runPublicationGate(article(path, content, FULL)));
      const refused = Number(/(\d+) of 13 paragraphs and list items have words directly before or after them/.exec(failure.reason)?.[1]);
      expect([path, refused >= 9]).toEqual([path, true]); // every unit after the video
      expect(failure.error.repairable).toBe(true);
    }
    expect(await verdict(article('content/posts/x.md', FULL.markdown, FULL))).toBe('accepted');
    expect(await verdict(article('content/posts/x.json', JSON.stringify({ slug: P.slug, body: PLAIN_MD }, null, 2)))).toBe('accepted');
  });
  // (b) Architecture section 15 says a file of a type the gate has no rules for is disclosed, not decided. That holds
  //     only when each unit sits in a paragraph of its own. A unit on the same line as a key, or on the line after
  //     one, is refused, in every data format the gate does not parse.
  it.fails('N7b: a TOML data file with one unit per key is accepted (as not decided)', async () => {
    expect(await verdict(article('data/x.toml', `slug = "${P.slug}"\n` + flat.map((text, n) => `[[block]]\nn = ${n}\ntext = ${JSON.stringify(text)}`).join('\n\n') + '\n'))).toMatch(/^accepted/);
  });
  it('N7b evidence: TOML keys, a Python list and a PHP array are each refused with all 13 units "extended"', async () => {
    const carriers: [string, string][] = [
      ['data/x.toml', `slug = "${P.slug}"\n` + flat.map((text, n) => `[[block]]\nn = ${n}\ntext = ${JSON.stringify(text)}`).join('\n\n') + '\n'],
      ['content/x.py', `POST = {\n  "slug": "${P.slug}",\n  "blocks": [\n${flat.map(text => `    ${JSON.stringify(text)},`).join('\n')}\n  ],\n}\n`],
      ['content/x.php', `<?php\nreturn [\n  'slug' => '${P.slug}',\n  'blocks' => [\n${flat.map(text => `    ${q(text)},`).join('\n')}\n  ],\n];\n`],
    ];
    for (const [path, content] of carriers) expect((await gateFailure(() => runPublicationGate(article(path, content)))).reason).toMatch(/13 of 13 paragraphs and list items have words directly before or after them/);
  });
});

describe('N3 fix: words beside a unit are refused', () => {
  const swap = (from: string, to: string) => md(text => text.replace(from, to));
  const typed = (expression: string) => `export const post = {\n  slug: '${P.slug}',\n  blocks: [\n${flat.map(text => `    ${text === ITEM ? expression : q(text)},`).join('\n')}\n  ],\n};\n`;
  const page = (li: string, before = '') => `${before}export default function Page() {\n  return (\n    <article>\n${QA_BLOCKS.map(([kind, value]) => (kind === 'ul' ? `      <ul>\n${(value as string[]).map(item => (item === ITEM ? `        ${li}` : `        <li>{${JSON.stringify(item)}}</li>`)).join('\n')}\n      </ul>` : `      <${kind}>{${JSON.stringify(value)}}</${kind}>`)).join('\n')}\n    </article>\n  );\n}\n`;
  const htmlWith = (prefix: string) => QA_BLOCKS.map(([kind, value]) => (kind === 'ul' ? `<ul>${(value as string[]).map(item => `<li>${item === ITEM ? prefix : ''}${item}</li>`).join('')}</ul>` : `<${kind}>${String(value).replace(/&/g, '&amp;')}</${kind}>`)).join('\n');
  it.each<[string, string, string, string]>([
    ['Markdown: "Do not" in front of a list item (QA-2 finding N3)', MD, swap(`- ${ITEM}`, `- Do not ${ITEM.charAt(0).toLowerCase() + ITEM.slice(1)}`), 'article-fidelity: extended'],
    ['Markdown: the words on the list item\'s first line, the item on the next', MD, swap(`- ${ITEM}`, `- Do not\n  ${ITEM}`), 'article-fidelity: extended'],
    ['Markdown: a sentence after a paragraph on the same line', MD, swap('for a season or more.', 'for a season or more. None of this is true.'), 'article-fidelity: extended'],
    ['Markdown: a sentence after a paragraph on the next line', MD, swap('for a season or more.', 'for a season or more.\nNone of this is true.'), 'article-fidelity: extended'],
    ['Markdown: the words in an inline <span>', MD, swap(`- ${ITEM}`, `- <span>Do not</span> ${ITEM}`), 'article-fidelity: extended'],
    ['Markdown: the words written with &nbsp;', MD, swap(`- ${ITEM}`, `- Do&nbsp;not&nbsp;${ITEM}`), 'article-fidelity: extended'],
    ['Markdown: the words with a zero-width space after them', MD, swap(`- ${ITEM}`, `- Do not\u200b ${ITEM}`), 'article-fidelity: extended'],
    ['Markdown: the words in the table cell beside the item', MD, swap(`- ${ITEM}`, `| Do not | ${ITEM} |`), 'article-fidelity: extended'],
    ['Markdown: a heading with words in front (one of four)', MD, swap('## Start with the gutters', '## Do not start with the gutters'), 'article-fidelity: headings'],
    ['Markdown: the paragraph kept only in an HTML comment', MD, swap(PARA, `<!-- ${PARA} -->\nSomething else entirely is shown here instead of the paragraph.`), 'article-fidelity: extended'],
    ['TypeScript: string concatenation', 'content/x.ts', typed(`'Do not ' + ${q(ITEM)}`), 'article-fidelity: extended'],
    ['TypeScript: a template literal with the unit in ${}', 'content/x.ts', typed('`Do not ${' + q(ITEM) + '}`'), 'article-fidelity: extended'],
    ['TypeScript: the words inside the same string', 'content/x.ts', typed(q('Do not ' + ITEM)), 'article-fidelity: extended'],
    ['TSX: adjacent expressions in one element', 'src/app/x/page.tsx', page(`<li>{'Do not '}{${JSON.stringify(ITEM)}}</li>`), 'article-fidelity: extended'],
    ['TSX: text then an expression', 'src/app/x/page.tsx', page(`<li>Do not {${JSON.stringify(ITEM)}}</li>`), 'article-fidelity: extended'],
    ['TSX: a fragment holding the words', 'src/app/x/page.tsx', page(`<li><>Do not </>{${JSON.stringify(ITEM)}}</li>`), 'article-fidelity: extended'],
    ['TSX: an inline <span> holding the words', 'src/app/x/page.tsx', page(`<li><span>Do not</span> {${JSON.stringify(ITEM)}}</li>`), 'article-fidelity: extended'],
    ['HTML: the words before a <wbr>', 'site/p.html', htmlWith('Do not <wbr>'), 'article-fidelity: extended'],
    ['HTML: a label <span> in front of a paragraph', 'site/p.html', html.replace('<p>Most damp', '<p><span class="label">Tip</span> Most damp'), 'article-fidelity: extended'],
    ['YAML: the words in the same scalar', 'data/x.yaml', `blocks:\n${flat.map(text => `  - ${JSON.stringify(text === ITEM ? 'Do not ' + text : text)}`).join('\n')}\n`, 'article-fidelity: extended'],
    ['plain text: the words on the same line', 'content/x.txt', flat.map(text => (text === ITEM ? 'Do not ' + text : text)).join('\n\n') + '\n', 'article-fidelity: extended'],
  ])('%s', async (_label, path, content, expected) => {
    expect(await verdict(article(path, content))).toBe(expected);
  });
  it('the refusal names the unit by number, quotes nothing, and is repairable', async () => {
    const failure = await gateFailure(() => runPublicationGate(article(MD, swap(`- ${ITEM}`, `- Do not ${ITEM}`))));
    expect(failure.reason).toMatch(/1 of 13 paragraphs and list items have words directly before or after them in their line, element or string: item 4\. Each one must stand alone there, with nothing added/);
    expect(failure.reason).not.toMatch(/gutter|Do not/);
    expect(failure.error.repairable).toBe(true);
  });
  it('a custom element or an unlisted tag around the words passes, and is disclosed as not decided', async () => {
    for (const tag of ['x-not', 'nobr', 'Note']) expect(await verdict(article(MD, swap(`- ${ITEM}`, `- <${tag}>Do not</${tag}> ${ITEM}`)))).toBe('accepted, not decided');
  });

  // N8 (minor, new). A tag in the gate's block-level list is a certain boundary, but many of those elements render
  // nothing, or render inside the line: input, meta, link, script, style, template, svg and more. "Do not" followed by
  // one of them and then the unit reads as one sentence on the page, passes as fully word for word, and is not disclosed.
  it.fails('N8: words separated from a list item only by a hidden <input> are refused or disclosed', async () => {
    expect(await verdict(article(MD, swap(`- ${ITEM}`, `- Do not <input type="hidden"> ${ITEM}`)))).not.toBe('accepted');
  });
  it('N8 evidence: eight elements that do not break a rendered line each let the words through silently, in Markdown and in HTML', async () => {
    for (const tag of ['<input type="hidden">', '<meta name="x">', '<link rel="x">', '<script></script>', '<style></style>', '<template></template>', '<svg width="0"/>', '<button></button>']) expect([tag, await verdict(article(MD, swap(`- ${ITEM}`, `- Do not ${tag} ${ITEM}`)))]).toEqual([tag, 'accepted']);
    expect(await verdict(article('site/p.html', htmlWith('Do not <input hidden>')))).toBe('accepted');
    expect(await verdict(article(MD, swap('for a season or more.', 'for a season or more. <link rel="x"> None of this is true.')))).toBe('accepted');
  });
  // What the engineer said is not closed: text assembled when the page runs.
  it('ADMITTED: words joined to a unit at run time pass (array join, concat, a prefix field, a component, a prefix variable declared elsewhere)', async () => {
    for (const expression of [`['Do not', ${q(ITEM)}].join(' ')`, `'Do not '.concat(${q(ITEM)})`, `{ prefix: 'Do not', text: ${q(ITEM)} }`]) expect(await verdict(article('content/x.ts', typed(expression)))).toBe('accepted');
    expect(await verdict(article('src/app/x/page.tsx', page(`<li><Not />{${JSON.stringify(ITEM)}}</li>`)))).toBe('accepted');
  });
  // Outside the rule by construction: a block of its own, and marks that are not words.
  it('OBSERVATION: a separate paragraph of added words, an emoji in front, and strike-through all pass', async () => {
    expect(await verdict(article(MD, swap(`- ${ITEM}`, `Do not:\n\n- ${ITEM}`)))).toBe('accepted');
    expect(await verdict(article(MD, swap(`- ${ITEM}`, `- 🚫 ${ITEM}`)))).toBe('accepted');
    expect(await verdict(article(MD, swap(`- ${ITEM}`, `- ~~${ITEM}~~`)))).toBe('accepted');
    expect(await verdict(article(MD, swap(PARA, `<del>${PARA}</del>`)))).toBe('accepted');
  });
});
