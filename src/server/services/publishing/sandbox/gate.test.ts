import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import type { Block } from '@/lib/types';
import type { RepoEntry } from '../connectors/nextjs-agent';
import { blocksToMarkdown } from '../render';
import { PublishError } from '../http';
import { PEER_CONTENT, PublicationGateError, isRepairableGateFailure, runPublicationGate } from './gate';
import { GATE_LIMITS, PUBLISH_CHECK_IDS, REPAIRABLE_GATE_CODES, SANDBOX_DIAGNOSTIC_CODES, type PublicationGateInput, type PublicationGateResult } from './types';
import { ARTICLE, BODY_IMAGE, PARAPHRASED, SOURCES, VIDEOS, paragraph, payloadFor, seeded } from './__fixtures__/article';
import { CAPABILITY, blobSha, gateInput, treeOf, type AgentOutput } from './__fixtures__/tree';
import { PEER_RECORDS, REGISTRY_PATH, recordSource, registryIntegration, registryReformatted, toRecord, typedRegistryRepository, withRecord, type PostRecord } from './__fixtures__/typedRegistry';
import { GENERATOR_PATH, INDEXED_PAGES, INDEX_PATH, PAGE_PATH, generatedIndexRepository, pageAndBrokenIndex, pageAndIndexRecord, pageAndReserialisedIndex, pageOnly } from './__fixtures__/generatedIndex';
import { AUDIT_PATH, POST_PATH, POST_ROUTE, mdxAuditRepository, mdxPost, mdxPostFrom, mdxPostParaphrased } from './__fixtures__/mdxAudit';
import { GUIDE_PATH, GUIDE_REFRESH_URL, GUIDE_ROUTE, GUIDE_SLUG, HUBS_PATH, HUB_COUNT, HUB_ROUTE, guideRefreshed, guideRepository, hubPeersWiped, hubRefreshed, hubRepository } from './__fixtures__/refresh';

const payload = payloadFor();
const articlePath = POST_PATH(payload.slug);
/** Words that only occur in the article body, and a sentence of generated peer prose: a diagnostic must contain neither. */
const ARTICLE_WORDS = /larkfield commons sits|ferry terminal|decibels|glazing|brochure|catchment/i;

async function failureOf(input: PublicationGateInput): Promise<PublicationGateError> {
  let result: PublicationGateResult;
  try { result = await runPublicationGate(input); } catch (error) { return error as PublicationGateError; }
  throw new Error('the gate passed: ' + JSON.stringify(result.checks.map(check => check.id)));
}
/** What every gate failure must look like, whatever the rule. */
function expectFailure(error: PublicationGateError, code: typeof SANDBOX_DIAGNOSTIC_CODES[number], repairable: boolean) {
  expect(error).toBeInstanceOf(PublishError);
  expect(error.diagnostic?.code).toBe(code);
  expect(error).toMatchObject({ http: 422, kind: 'config', host: '', source: 'radar', retryable: false });
  expect(error.diagnostic).toMatchObject({ stage: 'validation' });
  const reason = error.diagnostic!.reason;
  expect(error.detail).toBe(reason);
  expect(reason.length).toBeGreaterThan(20);
  expect(reason.length).toBeLessThanOrEqual(600);
  for (const text of [reason, error.diagnostic!.path ?? '', ...(error.diagnostic!.issues ?? [])]) {
    expect(text).not.toContain('rdrcap1');
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(ARTICLE_WORDS);
    expect(text).not.toMatch(/[\x00-\x1f]/);
    expect(text.length).toBeLessThanOrEqual(600);
  }
  expect(error.repairable).toBe(repairable);
  expect(isRepairableGateFailure(error)).toBe(repairable);
  expect((REPAIRABLE_GATE_CODES as readonly string[]).includes(code) || !repairable).toBe(true);
}
function expectPassed(result: PublicationGateResult) {
  expect(result.checks.map(check => check.id)).toEqual([...PUBLISH_CHECK_IDS]);
  for (const check of result.checks) {
    expect(check.outcome).toBe('passed');
    expect(check.detail.length).toBeGreaterThan(10);
    expect(check.detail.length).toBeLessThanOrEqual(400);
    expect(check.detail).not.toMatch(ARTICLE_WORDS);
    expect(check.detail).not.toMatch(/https?:\/\//);
  }
}
const detailOf = (result: PublicationGateResult, id: typeof PUBLISH_CHECK_IDS[number]) => result.checks.find(check => check.id === id)!.detail;
/** True when every line of `original` is still present in `final`, in the same order. */
function linesSurvive(original: string, final: string): boolean {
  const after = final.split('\n'); let at = 0;
  for (const line of original.split('\n')) { while (at < after.length && after[at] !== line) at++; if (at++ >= after.length) return false; }
  return true;
}
/** Evaluates the registry module, as the site would, and returns its records. */
function postsOf(source: string): PostRecord[] {
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exported: { posts?: PostRecord[] } = {};
  new Function('exports', compiled)(exported);
  return exported.posts!;
}

const mdxRepository = mdxAuditRepository();
const mdxTree = () => treeOf(mdxRepository);
const good = () => mdxPost(payload);
/** The good MDX output plus extra files the agent also wrote. */
const withFiles = (files: Record<string, string | Buffer>): AgentOutput => { const output = good(); return { ...output, files: { ...output.files, ...files } }; };

describe('publication gate: accepted integrations', () => {
  it('SBX-1: a typed registry over 150 KB gains exactly one record and every original line survives', async () => {
    const repository = typedRegistryRepository(); const registry = repository.get(REGISTRY_PATH)!;
    expect(Buffer.byteLength(registry)).toBeGreaterThan(150_000);
    expect(postsOf(registry)).toHaveLength(PEER_RECORDS);
    const tree = treeOf(repository);
    const result = await runPublicationGate(gateInput(tree, payload, registryIntegration(registry, payload)));

    expectPassed(result);
    expect(result.unchanged).toBe(false);
    expect(result.files.map(file => file.path)).toEqual([REGISTRY_PATH]);
    const final = result.files[0].content;
    const posts = postsOf(final);
    expect(posts).toHaveLength(PEER_RECORDS + 1);
    expect(posts.slice(0, PEER_RECORDS)).toEqual(postsOf(registry));
    expect(posts.filter(post => post.slug === payload.slug)).toHaveLength(1);
    const added = posts.at(-1)!;
    expect(added.intro).toEqual([ARTICLE[0][1], ARTICLE[1][1]]);
    expect(added.sections.map(section => section.heading)).toEqual(ARTICLE.filter(block => block[0] === 'h2' || block[0] === 'h3').map(block => block[1]));
    expect(added.sections.flatMap(section => section.paragraphs)).toEqual(ARTICLE.slice(2).filter(block => block[0] === 'p').map(block => block[1]));
    expect(added.sections.find(section => section.table)!.table!.rows).toHaveLength(4);
    expect(linesSurvive(registry, final)).toBe(true);
    expect(final.length).toBeGreaterThan(registry.length);

    expect(detailOf(result, 'peer-content')).toMatch(/^1 existing file edited; 0 of \d+ original lines removed or altered \(limit 6 per file, 24 in all\), \d+ lines added$/);
    expect(detailOf(result, 'article-fidelity')).toContain('13 of 13 paragraphs and 7 of 7 list items present, 20 of them word for word; 8 of 8 headings present');
    expect(detailOf(result, 'syntax')).toBe('1 changed file is UTF-8 text; 0 JSON parsed; 1 JavaScript or TypeScript parsed without syntax errors');
    expect(detailOf(result, 'ceilings')).toContain(`1 changed file (limit ${GATE_LIMITS.changedFiles})`);
    // Plain-string paragraphs cannot carry the image, video or citations: disclosed, not fatal.
    expect(result.mediaOmitted).toEqual([BODY_IMAGE.url, VIDEOS[0].id, SOURCES[0].url, SOURCES[1].url]);
    // The only blob fetched is the one file that was edited.
    expect(tree.reads).toEqual([tree.entries.get(REGISTRY_PATH)!.sha]);
  });

  it('generated JSON index over 100 KB: accepts the authored page alone, leaving the index to its generator', async () => {
    const repository = generatedIndexRepository();
    expect(Buffer.byteLength(repository.get(INDEX_PATH)!)).toBeGreaterThan(100_000);
    expect(repository.get(GENERATOR_PATH)).toContain(INDEX_PATH);
    expect(JSON.parse(repository.get('package.json')!).scripts.prebuild).toBe('node ' + GENERATOR_PATH);
    const tree = treeOf(repository);
    const result = await runPublicationGate(gateInput(tree, payload, pageOnly(payload)));
    expectPassed(result);
    expect(result.files).toEqual([{ path: PAGE_PATH(payload.slug), content: String(pageOnly(payload).files[PAGE_PATH(payload.slug)]) }]);
    expect(result.mediaOmitted).toEqual([]);
    expect(detailOf(result, 'peer-content')).toBe('no existing file was edited; every changed file is new');
    expect(tree.reads).toEqual([]);
  });
  it('generated JSON index over 100 KB: accepts one record appended to the index by a minimal edit', async () => {
    const repository = generatedIndexRepository(); const index = repository.get(INDEX_PATH)!;
    const result = await runPublicationGate(gateInput(treeOf(repository), payload, pageAndIndexRecord(index, payload)));
    expectPassed(result);
    const pages = JSON.parse(result.files.find(file => file.path === INDEX_PATH)!.content).pages;
    expect(pages).toHaveLength(INDEXED_PAGES + 1);
    expect(pages.slice(0, INDEXED_PAGES)).toEqual(JSON.parse(index).pages);
    expect(pages.at(-1)).toMatchObject({ slug: payload.slug, excerpt: ARTICLE[0][1] });
    // Every original line is still there, in order: the appended record ends with the closing brace the old last record had.
    expect(linesSurvive(index, result.files.find(file => file.path === INDEX_PATH)!.content)).toBe(true);
    expect(detailOf(result, 'peer-content')).toMatch(/^1 existing file edited; 0 of \d+ original lines removed or altered \(limit 6 per file, 24 in all\), \d+ lines added$/);
    expect(detailOf(result, 'syntax')).toContain('1 JSON parsed');
  });

  it('MDX blog whose audit bans U+2014: accepts the post with the em dash replaced', async () => {
    expect(ARTICLE[0][1]).toContain('—');
    expect(mdxRepository.get(AUDIT_PATH)).toContain('\\u2014');
    const result = await runPublicationGate(gateInput(mdxTree(), payload, good()));
    expectPassed(result);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe(articlePath);
    expect(result.files[0].content).not.toContain('—');
    expect(result.files[0].content).toMatch(/^---\ntitle: "Larkfield Commons review/);
    expect(result.mediaOmitted).toEqual([]);
    expect(detailOf(result, 'identity')).toBe('the slug, article path and public route are well formed');
  });

  it('refresh addressed by a root-relative URL: accepts the page body replaced in place', async () => {
    const repository = guideRepository(); const original = repository.get(GUIDE_PATH)!;
    for (const refreshUrl of [GUIDE_REFRESH_URL, 'https://rentals.example' + GUIDE_REFRESH_URL + '?utm_source=newsletter']) {
      const refresh = payloadFor(ARTICLE, { mode: 'refresh', refreshUrl });
      const result = await runPublicationGate(gateInput(treeOf(repository), refresh, guideRefreshed(original, refresh)));
      expectPassed(result);
      expect(detailOf(result, 'identity')).toContain('the route is the route of the page being refreshed');
      const final = result.files[0].content;
      expect(final).toContain('<title>Renting checklist</title>');
      expect(final).toContain('<footer class="site-footer">');
      expect(final).toContain('<h2>Costs you should plan for</h2>');
      expect(detailOf(result, 'peer-content')).toMatch(/^1 existing file edited; in the article file being replaced, 9 earlier lines gave way to \d+ new ones/);
    }
  });
  it('refresh whose target is a typed hub record: accepts the article as that record’s HTML string field', async () => {
    const repository = hubRepository(); const original = repository.get(HUBS_PATH)!;
    const refresh = payloadFor(ARTICLE, { mode: 'refresh', refreshUrl: 'https://rentals.example' + HUB_ROUTE + '/' });
    const result = await runPublicationGate(gateInput(treeOf(repository), refresh, hubRefreshed(original, refresh)));
    expectPassed(result);
    const before = original.split('\n'); const after = result.files[0].content.split('\n');
    expect(after).toHaveLength(before.length);
    expect(after.filter((line, i) => line !== before[i])).toHaveLength(1);
    expect(after.filter(line => line.startsWith('    slug: '))).toHaveLength(HUB_COUNT);
    expect(result.mediaOmitted).toEqual([]);
  });

  it('retry that finds the article already complete on the branch: unchanged, nothing to commit', async () => {
    const committed = String(good().files[articlePath]);
    const tree = treeOf(new Map([...mdxRepository, [articlePath, committed]]));
    const result = await runPublicationGate(gateInput(tree, payload, { files: {}, articlePath, route: POST_ROUTE(payload.slug) }, { retry: { slug: payload.slug, articlePath } }));
    expectPassed(result);
    expect(result).toMatchObject({ unchanged: true, files: [], mediaOmitted: [] });
    expect(detailOf(result, 'article-fidelity')).toContain('verified on the article file already on the branch');
    expect(detailOf(result, 'identity')).toContain('the retry keeps the slug and article path of the earlier attempt');
    expect(tree.reads).toEqual([tree.entries.get(articlePath)!.sha]);
  });
  it('retry: verifies the article on the branch when only another file still needed changing', async () => {
    const repository = generatedIndexRepository(); const output = pageAndIndexRecord(repository.get(INDEX_PATH)!, payload);
    const page = PAGE_PATH(payload.slug);
    const tree = treeOf(new Map([...repository, [page, String(output.files[page])]]));
    const result = await runPublicationGate(gateInput(tree, payload, output, { retry: { slug: payload.slug, articlePath: page } }));
    expectPassed(result);
    expect(result.unchanged).toBe(false);
    expect(result.files.map(file => file.path)).toEqual([INDEX_PATH]);
    expect(detailOf(result, 'file-modes')).toContain('1 identical to the pinned commit');
  });
  it('retry: accepts the article file rewritten in full over an incomplete earlier attempt', async () => {
    const partial = String(mdxPostFrom(payload, ARTICLE.slice(0, 9)).files[articlePath]);
    const tree = treeOf(new Map([...mdxRepository, [articlePath, partial]]));
    const result = await runPublicationGate(gateInput(tree, payload, good(), { retry: { slug: payload.slug, articlePath } }));
    expectPassed(result);
    expect(result.files).toEqual([{ path: articlePath, content: String(good().files[articlePath]) }]);
  });
  it('legacy export: accepts the article moved into the real blog under the same slug', async () => {
    const legacyPath = `content/posts/${payload.slug}.md`;
    const tree = treeOf(new Map([...mdxRepository, [legacyPath, payload.markdown]]));
    const result = await runPublicationGate(gateInput(tree, payload, good(), { legacy: { slug: payload.slug, articlePath: legacyPath } }));
    expectPassed(result);
    expect(detailOf(result, 'identity')).toContain('the migration keeps the existing slug');
  });

  it('drops candidates whose bytes equal the pinned commit and commits only real changes', async () => {
    const tree = mdxTree(); const untouched = [...mdxRepository.keys()].find(path => path.endsWith('.mdx'))!;
    const result = await runPublicationGate(gateInput(tree, payload, withFiles({ [untouched]: mdxRepository.get(untouched)! })));
    expectPassed(result);
    expect(result.files.map(file => file.path)).toEqual([articlePath]);
    expect(detailOf(result, 'file-modes')).toBe('2 regular files collected; none is or lies under a symbolic link, submodule or special file; 1 new, 0 existing changed, 1 identical to the pinned commit');
  });
  it('puts an edited file back into the line-ending style of its pinned blob', async () => {
    const repository = typedRegistryRepository(); const lf = repository.get(REGISTRY_PATH)!;
    const crlf = lf.replace(/\n/g, '\r\n');
    // The archive handed the agent LF text (a .gitattributes conversion); the blob in Git is CRLF.
    const result = await runPublicationGate(gateInput(treeOf(new Map([...repository, [REGISTRY_PATH, crlf]])), payload, registryIntegration(lf, payload)));
    expectPassed(result);
    const final = result.files[0].content;
    expect(final).not.toMatch(/[^\r]\n/);
    expect(linesSurvive(crlf, final)).toBe(true);
    expect(detailOf(result, 'peer-content')).toMatch(/; 0 of \d+ original lines removed or altered/);
    // Line endings were the only difference: nothing to commit.
    const same = await failureOf(gateInput(treeOf(new Map([...repository, [REGISTRY_PATH, crlf]])), payload, { files: { [REGISTRY_PATH]: lf }, articlePath: REGISTRY_PATH, route: '/blog/' + payload.slug }));
    expectFailure(same, 'plan-empty', false);
  });
});

describe('publication gate: one refusal per rule', () => {
  it.each([
    ['a dependency manifest', 'package.json'],
    ['a CI workflow', '.github/workflows/deploy.yml'],
    ['an environment file', '.env.production'],
    ['authentication code', 'src/auth/session.ts'],
    ['a deployment configuration', 'vercel.json'],
    ['a binary asset', 'public/images/larkfield.png'],
    ['a path that leaves the repository', '../outside/notes.md'],
    ['a path with a parent segment', 'content/blog/../../notes.md'],
    ['an absolute path', '/etc/cron.d/notes'],
    ['an installed dependency', 'node_modules/left-pad/index.js'],
  ])('protected or unsafe path: %s', async (_label, path) => {
    const error = await failureOf(gateInput(mdxTree(), payload, withFiles({ [path]: '{ "note": "written by the agent" }\n' })));
    expectFailure(error, 'protected-path', true);
    expect(error.diagnostic!.reason).toContain('repository write rules protect');
  });
  it('protected path: the same file listed twice, and a file used as a directory', async () => {
    const twice = await failureOf(gateInput(mdxTree(), payload, { ...good(), result: { changed: [{ path: articlePath, bytes: 10 }, { path: articlePath, bytes: 10 }] } }));
    expectFailure(twice, 'protected-path', true);
    expect(twice.diagnostic!.reason).toContain('more than once');
    const nested = await failureOf(gateInput(mdxTree(), payload, withFiles({ [articlePath + '/index.mdx']: 'nested' })));
    expectFailure(nested, 'protected-path', true);
    expect(nested.diagnostic!.reason).toContain('both a file and a directory');
  });

  it.each([
    ['a GitHub token', 'export const token = "' + 'ghp_' + 'a1B2c3D4e5'.repeat(4) + '";\n'],
    ['a private key', '-----BEGIN ' + 'RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA7\n-----END RSA PRIVATE KEY-----\n'],
    ['a cloud access key', 'aws_access_key_id = ' + 'AKIA' + 'IOSFODNN7EXAMPLE' + '\n'],
  ])('credential in changed content: %s', async (_label, secret) => {
    const error = await failureOf(gateInput(mdxTree(), payload, withFiles({ 'src/lib/site-settings.ts': secret })));
    expectFailure(error, 'credential-detected', false);
    expect(error.diagnostic).toMatchObject({ path: 'src/lib/site-settings.ts', reason: 'src/lib/site-settings.ts contains a credential-shaped string' });
    expect(JSON.stringify(error.diagnostic) + error.message).not.toContain(secret.trim().slice(-20));
  });
  it('capability string: this run’s capability, any capability-shaped string, and one hidden in a file name', async () => {
    const own = await failureOf(gateInput(mdxTree(), payload, withFiles({ 'content/blog/notes.mdx': 'Debug output: ' + CAPABILITY + '\n' })));
    expectFailure(own, 'credential-detected', false);
    expect(own.diagnostic!.reason).toBe('content/blog/notes.mdx contains a Radar model capability, which must never leave the sandbox');
    const other = await failureOf(gateInput(mdxTree(), payload, { ...good(), files: { [articlePath]: String(good().files[articlePath]) + '\n{/* rdrcap1.eyJvdGhlciI6dHJ1ZX0.b3RoZXI */}\n' } }));
    expectFailure(other, 'credential-detected', false);
    const named = await failureOf(gateInput(mdxTree(), payload, withFiles({ ['content/blog/' + CAPABILITY + '.mdx']: 'x' })));
    expectFailure(named, 'credential-detected', false);
    expect(named.diagnostic!.path).toBeUndefined();
    for (const error of [own, other, named]) expect(JSON.stringify(error.diagnostic) + error.message).not.toContain('rdrcap1');
  });

  it('too many files: 17 changed files, and more candidates than can be examined', async () => {
    const extra = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`content/blog/related-${i + 1}.mdx`, `---\ntitle: "Related ${i + 1}"\n---\n\nSee the main review.\n`]));
    const seventeen = await failureOf(gateInput(mdxTree(), payload, withFiles(extra)));
    expectFailure(seventeen, 'changed-file-count', true);
    expect(seventeen.diagnostic).toMatchObject({ actual: 17, limit: 16, reason: 'the change touches 17 files; the limit is 16' });
    const flood = await failureOf(gateInput(mdxTree(), payload, { ...good(), files: {}, result: { changed: Array.from({ length: 65 }, (_, i) => ({ path: `content/blog/flood-${i}.mdx`, bytes: 20 })) } }));
    expectFailure(flood, 'changed-file-count', true);
    expect(flood.diagnostic).toMatchObject({ actual: 65, limit: 64 });
  });

  it('oversize: one file over 1 MB, whether or not it was downloaded', async () => {
    const downloaded = await failureOf(gateInput(mdxTree(), payload, withFiles({ 'content/blog/archive.mdx': 'a'.repeat(1_000_001) })));
    expectFailure(downloaded, 'final-output-size', false);
    expect(downloaded.diagnostic).toMatchObject({ path: 'content/blog/archive.mdx', actual: 1_000_001, limit: 1_000_000 });
    const output = good();
    const skipped = await failureOf(gateInput(mdxTree(), payload, { ...output, result: { changed: [{ path: articlePath, bytes: 4000 }, { path: 'content/blog/archive.mdx', bytes: 5_000_000 }] } }));
    expectFailure(skipped, 'final-output-size', false);
    expect(skipped.diagnostic).toMatchObject({ actual: 5_000_000, limit: 1_000_000 });
  });
  it('oversize: changed files over 2 MB in all, and net growth over 400 KB', async () => {
    const filler = (seed: number, bytes: number) => { const text = paragraph(seeded(seed), 40) + '\n\n'; return text.repeat(Math.ceil(bytes / text.length)).slice(0, bytes); };
    const total = await failureOf(gateInput(mdxTree(), payload, withFiles({ 'content/blog/a.mdx': filler(1, 700_000), 'content/blog/b.mdx': filler(2, 700_000), 'content/blog/c.mdx': filler(3, 700_000) })));
    expectFailure(total, 'final-output-size', false);
    expect(total.diagnostic).toMatchObject({ limit: 2_000_000 });
    expect(total.diagnostic!.reason).toMatch(/^the changed files total \d+ bytes; the limit is 2000000$/);
    const growth = await failureOf(gateInput(mdxTree(), payload, withFiles({ 'content/blog/a.mdx': filler(1, 450_000) })));
    expectFailure(growth, 'final-output-size', false);
    expect(growth.diagnostic).toMatchObject({ limit: 400_000 });
    expect(growth.diagnostic!.reason).toMatch(/^the change adds \d+ bytes to the repository; the limit is 400000$/);
  });

  it.each<[string, RepoEntry[]]>([
    ['a symbolic link', [{ path: 'content', type: 'tree', mode: '040000', sha: 'a'.repeat(40) }, { path: 'content/blog', type: 'blob', mode: '120000', sha: 'b'.repeat(40) }]],
    ['a submodule', [{ path: 'content', type: 'commit', mode: '160000', sha: 'c'.repeat(40) }]],
    ['a file', [{ path: 'content', type: 'blob', mode: '100644', sha: 'd'.repeat(40) }]],
  ])('symlink or submodule ancestor: the article would be written under %s', async (_label, extra) => {
    const tree = treeOf(new Map([['README.md', '# Site\n']]), extra);
    const error = await failureOf(gateInput(tree, payload, good()));
    expectFailure(error, 'non-regular-file', false);
    expect(error.diagnostic).toMatchObject({ path: articlePath });
    expect(error.diagnostic!.reason).toContain('lies under a file, symbolic link or submodule');
  });
  it.each<[string, Partial<RepoEntry>]>([
    ['a symbolic link', { type: 'blob', mode: '120000' }],
    ['a submodule', { type: 'commit', mode: '160000' }],
    ['a directory', { type: 'tree', mode: '040000' }],
    ['an entry with no recorded mode', { type: 'blob', mode: undefined }],
  ])('regular files only: the changed path is %s in the pinned tree', async (_label, entry) => {
    const tree = treeOf(mdxRepository, [{ path: articlePath, sha: 'e'.repeat(40), type: 'blob', ...entry }]);
    const error = await failureOf(gateInput(tree, payload, good()));
    expectFailure(error, 'non-regular-file', false);
    expect(tree.reads).toEqual([]);
  });
  it('regular files only: a candidate the control plane could not collect, and a file where a directory is', async () => {
    const missing = await failureOf(gateInput(mdxTree(), payload, { ...good(), result: { changed: [{ path: articlePath, bytes: 4000 }, { path: 'content/blog/socket.mdx', bytes: 0 }] } }));
    expectFailure(missing, 'non-regular-file', false);
    expect(missing.diagnostic!.reason).toBe('content/blog/socket.mdx could not be collected from the sandbox as a regular file');
    const directory = await failureOf(gateInput(mdxTree(), payload, withFiles({ 'content/blog': 'now a file' })));
    expect(['non-regular-file', 'protected-path']).toContain(directory.diagnostic!.code);
  });

  it('non-UTF-8: bytes that are not text, and a NUL byte', async () => {
    const text = Buffer.from(String(good().files[articlePath]));
    const latin1 = await failureOf(gateInput(mdxTree(), payload, { ...good(), files: { [articlePath]: Buffer.concat([text, Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])]) } }));
    expectFailure(latin1, 'syntax-invalid', true);
    expect(latin1.diagnostic!.reason).toBe(`${articlePath} is not UTF-8 text; only text files can be published`);
    const nul = await failureOf(gateInput(mdxTree(), payload, { ...good(), files: { [articlePath]: Buffer.concat([text, Buffer.from([0x00])]) } }));
    expectFailure(nul, 'syntax-invalid', true);
  });
  it('invalid JSON: the appended index record breaks the file', async () => {
    const repository = generatedIndexRepository();
    const error = await failureOf(gateInput(treeOf(repository), payload, pageAndBrokenIndex(repository.get(INDEX_PATH)!, payload)));
    expectFailure(error, 'syntax-invalid', true);
    expect(error.diagnostic).toMatchObject({ path: INDEX_PATH, reason: `${INDEX_PATH} is not valid JSON` });
  });
  it('invalid TypeScript: the new registry record is not closed', async () => {
    const repository = typedRegistryRepository(); const registry = repository.get(REGISTRY_PATH)!;
    const record = recordSource(toRecord(ARTICLE, payload));
    const unclosed = record.slice(0, record.lastIndexOf('    ],\n  },')) + '  },';
    const error = await failureOf(gateInput(treeOf(repository), payload, { ...registryIntegration(registry, payload), files: { [REGISTRY_PATH]: withRecord(registry, unclosed) } }));
    expectFailure(error, 'syntax-invalid', true);
    expect(error.diagnostic!.path).toBe(REGISTRY_PATH);
    expect(error.diagnostic!.reason).toMatch(/^apps\/web\/app\/blog\/posts\.ts has \d+ JavaScript or TypeScript syntax errors?$/);
  });

  it('unparseable source: nesting deep enough to exhaust a parser is a refusal, not a crash', async () => {
    const script = await failureOf(gateInput(mdxTree(), payload, withFiles({ 'src/lib/table.ts': 'export const table = ' + '['.repeat(200_000) + ';\n' })));
    expectFailure(script, 'syntax-invalid', true);
    const json = await failureOf(gateInput(mdxTree(), payload, withFiles({ 'src/data/table.json': '['.repeat(200_000) })));
    expectFailure(json, 'syntax-invalid', true);
  });

  it('peers reformatted: the registry was run through a formatter', async () => {
    const repository = typedRegistryRepository(); const registry = repository.get(REGISTRY_PATH)!;
    const output = registryReformatted(registry, payload);
    // The reformatted module still evaluates to the same records plus one: only a byte-level rule can refuse it.
    expect(postsOf(String(output.files[REGISTRY_PATH]))).toHaveLength(PEER_RECORDS + 1);
    const error = await failureOf(gateInput(treeOf(repository), payload, output));
    expectFailure(error, 'peer-content-changed', true);
    expect(error.diagnostic).toMatchObject({ path: REGISTRY_PATH, limit: PEER_CONTENT.newLines });
    expect(error.diagnostic!.actual!).toBeGreaterThan(2000);
    expect(error.diagnostic!.reason).toContain('existing lines removed or altered');
  });
  it('peers reformatted: the generated index was parsed and written back without its formatting', async () => {
    const repository = generatedIndexRepository();
    const error = await failureOf(gateInput(treeOf(repository), payload, pageAndReserialisedIndex(repository.get(INDEX_PATH)!, payload)));
    expectFailure(error, 'peer-content-changed', true);
    expect(error.diagnostic!.path).toBe(INDEX_PATH);
  });
  it('peer content: one peer record deleted, and a field rewritten in every peer', async () => {
    const repository = typedRegistryRepository(); const registry = repository.get(REGISTRY_PATH)!;
    const integrated = String(registryIntegration(registry, payload).files[REGISTRY_PATH]);
    const lines = integrated.split('\n'); const starts = lines.flatMap((line, i) => (line === '  {' ? [i] : []));
    const deleted = [...lines.slice(0, starts[5]), ...lines.slice(starts[6])].join('\n');
    expect(postsOf(deleted)).toHaveLength(PEER_RECORDS);
    const removal = await failureOf(gateInput(treeOf(repository), payload, { files: { [REGISTRY_PATH]: deleted }, articlePath: REGISTRY_PATH, route: '/blog/' + payload.slug }));
    expectFailure(removal, 'peer-content-changed', true);
    expect(removal.diagnostic).toMatchObject({ actual: starts[6] - starts[5], limit: PEER_CONTENT.newLines });
    expect(removal.diagnostic!.reason).toMatch(/has \d+ of its \d+ existing lines removed or altered; the limit for this file is 6\./);
    const bylines = await failureOf(gateInput(treeOf(repository), payload, { files: { [REGISTRY_PATH]: integrated.replace(/author: 'Editorial team',/g, "author: 'Example Rentals',") }, articlePath: REGISTRY_PATH, route: '/blog/' + payload.slug }));
    expectFailure(bylines, 'peer-content-changed', true);
    expect(bylines.diagnostic!.actual).toBe(PEER_RECORDS);
  });
  it('peer content, new article: a 13-line record deleted from the index is refused', async () => {
    const repository = generatedIndexRepository(); const index = repository.get(INDEX_PATH)!;
    const output = pageAndIndexRecord(index, payload);
    const lines = String(output.files[INDEX_PATH]).split('\n');
    const start = lines.findIndex((line, i) => i > 100 && line === '    {'); const end = lines.findIndex((line, i) => i > start && line === '    },');
    expect(end - start + 1).toBe(13);
    const deleted = [...lines.slice(0, start), ...lines.slice(end + 1)].join('\n');
    // Still valid JSON with the new record in it, and the same number of pages as before: only the line rule can see the loss.
    expect(JSON.parse(deleted).pages).toHaveLength(INDEXED_PAGES);
    const error = await failureOf(gateInput(treeOf(repository), payload, { ...output, files: { ...output.files, [INDEX_PATH]: deleted } }));
    expectFailure(error, 'peer-content-changed', true);
    expect(error.diagnostic).toMatchObject({ path: INDEX_PATH, actual: 13, limit: 6 });
    expect(error.diagnostic!.reason).toBe(`${INDEX_PATH} has 13 of its ${index.split('\n').length - 1} existing lines removed or altered; the limit for this file is 6. Add the article without reformatting or rewriting existing lines`);
  });
  /** A small authored registry next to the blog: one seven-line record per category, plus a few one-line settings. */
  const categories = (() => {
    const record = (i: number) => ['  {', `    "slug": "category-${i}",`, `    "title": "Category ${i}",`, `    "order": ${i},`, `    "featured": ${i % 2 === 0},`, `    "updatedAt": "2026-0${1 + (i % 9)}-10"`, '  },'];
    const lines = ['[', ...Array.from({ length: 12 }, (_, i) => record(i + 1)).flat()];
    lines[lines.length - 1] = '  }';
    return [...lines, ']', ''].join('\n');
  })();
  const CATEGORIES_PATH = 'src/data/categories.json';
  const settings = "import { postSlugs } from './blog';\n\nexport const postsPerPage = 8;\nexport const postCount = 8;\nexport const lastPublished = '2026-08-15';\nexport const featured = ['harbour-notes', 'quarry-walks'];\nexport const feedTitle = 'Example Rentals blog';\nexport const feedLimit = 20;\nexport const showAuthors = false;\nexport const allSlugs = () => postSlugs();\n";
  const SETTINGS_PATH = 'src/lib/blog-settings.ts';
  const sideFiles = () => treeOf(new Map([...mdxRepository, [CATEGORIES_PATH, categories], [SETTINGS_PATH, settings]]));
  it('peer content, new article: a 7-line record deleted is refused', async () => {
    expect(JSON.parse(categories)).toHaveLength(12);
    const lines = categories.split('\n'); const start = lines.indexOf('    "slug": "category-5",') - 1;
    const deleted = [...lines.slice(0, start), ...lines.slice(start + 7)].join('\n');
    expect(JSON.parse(deleted)).toHaveLength(11);
    const error = await failureOf(gateInput(sideFiles(), payload, withFiles({ [CATEGORIES_PATH]: deleted })));
    expectFailure(error, 'peer-content-changed', true);
    expect(error.diagnostic).toMatchObject({ path: CATEGORIES_PATH, actual: 7, limit: PEER_CONTENT.newLines });
  });
  it.each([
    ['a 3-line touch', 3, { postCount: true, lastPublished: true, featured: true }],
    ['a 6-line touch, at the limit', 6, { postCount: true, lastPublished: true, featured: true, postsPerPage: true, feedLimit: true, showAuthors: true }],
  ])('peer content, new article: %s on existing lines still passes and is counted', async (_label, touched, edits: Record<string, boolean>) => {
    let edited = settings.replace('postCount = 8', 'postCount = 9').replace("lastPublished = '2026-08-15'", `lastPublished = '${payload.date}'`).replace("['harbour-notes', 'quarry-walks']", `['${payload.slug}', 'harbour-notes']`);
    if (edits.postsPerPage) edited = edited.replace('postsPerPage = 8', 'postsPerPage = 9').replace('feedLimit = 20', 'feedLimit = 21').replace('showAuthors = false', 'showAuthors = true');
    const result = await runPublicationGate(gateInput(sideFiles(), payload, withFiles({ [SETTINGS_PATH]: edited })));
    expectPassed(result);
    expect(result.files.map(file => file.path).sort()).toEqual([articlePath, SETTINGS_PATH].sort());
    expect(detailOf(result, 'peer-content')).toBe(`1 existing file edited; ${touched} of 10 original lines removed or altered (limit 6 per file, 24 in all), ${touched} lines added`);
  });
  it('peer content, new article: one line more than the per-file limit is refused', async () => {
    const edited = settings.replace(/ = (8|20|false|'2026-08-15');/g, ' = 0;').replace("['harbour-notes', 'quarry-walks']", '[]').replace("'Example Rentals blog'", "'Blog'");
    const error = await failureOf(gateInput(sideFiles(), payload, withFiles({ [SETTINGS_PATH]: edited })));
    expectFailure(error, 'peer-content-changed', true);
    expect(error.diagnostic).toMatchObject({ path: SETTINGS_PATH, actual: 7, limit: 6 });
  });
  it('peer content, new article: touches inside each file’s limit add up past the total', async () => {
    const glossary = (seed: number) => { const random = seeded(seed); return Array.from({ length: 1200 }, (_, i) => `${i + 1}. ${paragraph(random, 1)}`).join('\n') + '\n'; };
    const files = new Map(Array.from({ length: 5 }, (_, i): [string, string] => [`content/glossary/part-${i + 1}.md`, glossary(600 + i)]));
    const edited = Object.fromEntries([...files].map(([path, text]) => [path, text.split('\n').map((line, i) => (i % 100 === 0 && i < 500 ? line + ' See the review.' : line)).join('\n')]));
    const error = await failureOf(gateInput(treeOf(new Map([...mdxRepository, ...files])), payload, withFiles(edited)));
    expectFailure(error, 'peer-content-changed', true);
    expect(error.diagnostic).toMatchObject({ actual: 25, limit: PEER_CONTENT.newTotalLines });
    // Five lines in each of four files is inside both limits.
    const four = Object.fromEntries(Object.entries(edited).slice(0, 4));
    const result = await runPublicationGate(gateInput(treeOf(new Map([...mdxRepository, ...files])), payload, withFiles(four)));
    expectPassed(result);
    expect(detailOf(result, 'peer-content')).toBe('4 existing files edited; 20 of 4800 original lines removed or altered (limit 6 per file, 24 in all), 20 lines added');
  });
  it('peer content, retry and legacy of a new article: the article file keeps the replace rule, other files the flat limit', async () => {
    const partial = String(mdxPostFrom(payload, ARTICLE.slice(0, 9)).files[articlePath]);
    const tree = treeOf(new Map([...mdxRepository, [articlePath, partial], [CATEGORIES_PATH, categories]]));
    const lines = categories.split('\n'); const start = lines.indexOf('    "slug": "category-5",') - 1;
    const deleted = [...lines.slice(0, start), ...lines.slice(start + 7)].join('\n');
    const error = await failureOf(gateInput(tree, payload, withFiles({ [CATEGORIES_PATH]: deleted }), { retry: { slug: payload.slug, articlePath } }));
    expectFailure(error, 'peer-content-changed', true);
    expect(error.diagnostic).toMatchObject({ path: CATEGORIES_PATH, actual: 7, limit: 6 });
  });
  it('peer content, refresh: a file other than the article file keeps the earlier tolerance', async () => {
    const repository = guideRepository(); const original = repository.get(GUIDE_PATH)!;
    const refresh = payloadFor(ARTICLE, { mode: 'refresh', refreshUrl: GUIDE_REFRESH_URL });
    const output = guideRefreshed(original, refresh);
    const tree = () => treeOf(new Map([...repository, [SETTINGS_PATH, settings], [CATEGORIES_PATH, categories]]));
    const eight = settings.replace(/ = (8|20|false|'2026-08-15');/g, ' = 0;').replace("['harbour-notes', 'quarry-walks']", '[]').replace("'Example Rentals blog'", "'Blog'").replace('postSlugs();', 'postSlugs().sort();');
    const passedResult = await runPublicationGate(gateInput(tree(), refresh, { ...output, files: { ...output.files, [SETTINGS_PATH]: eight } }));
    expectPassed(passedResult);
    expect(detailOf(passedResult, 'peer-content')).toMatch(/^2 existing files edited; 8 of 10 original lines removed or altered \(limit 60 in all\), 8 lines added; in the article file being replaced, /);
    // Twelve lines of an 87-line file is past max(10, 1%).
    const error = await failureOf(gateInput(tree(), refresh, { ...output, files: { ...output.files, [CATEGORIES_PATH]: categories.replace(/"order": \d+,/g, '"order": 0,') } }));
    expectFailure(error, 'peer-content-changed', true);
    expect(error.diagnostic).toMatchObject({ path: CATEGORIES_PATH, actual: 12, limit: PEER_CONTENT.lineFloor });
  });
  it('peer content: existing lines kept but shuffled count as a rewrite, within the time the gate has', async () => {
    const random = seeded(9);
    const lines = Array.from({ length: 30_000 }, (_, i) => `entry ${i}: ${Math.floor(random() * 1e9)}`);
    const shuffled = lines.map((line, i) => ({ line, key: (i * 7919) % lines.length })).sort((a, b) => a.key - b.key).map(item => item.line);
    const tree = treeOf(new Map([...mdxRepository, ['content/redirects.txt', lines.join('\n') + '\n']]));
    const started = Date.now();
    const error = await failureOf(gateInput(tree, payload, withFiles({ 'content/redirects.txt': shuffled.join('\n') + '\n' })));
    expectFailure(error, 'peer-content-changed', true);
    expect(error.diagnostic!.reason).toContain('was rewritten');
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 30_000);
  it('peer content on refresh: the hub file keeps only the refreshed record', async () => {
    const repository = hubRepository();
    const refresh = payloadFor(ARTICLE, { mode: 'refresh', refreshUrl: 'https://rentals.example' + HUB_ROUTE });
    const error = await failureOf(gateInput(treeOf(repository), refresh, hubPeersWiped(repository.get(HUBS_PATH)!, refresh)));
    expectFailure(error, 'peer-content-changed', true);
    expect(error.diagnostic!.reason).toContain('other records in the file must stay');
  });

  const without = (index: number) => ARTICLE.filter((_, i) => i !== index);
  it.each<[string, () => AgentOutput, RegExp]>([
    ['paragraph omitted', () => mdxPostFrom(payload, without(13)), /1 of 20 paragraphs and list items are missing or rewritten: paragraph 18\./],
    ['tail truncated', () => mdxPostFrom(payload, ARTICLE.slice(0, 15)), /the article is cut short: the last 4 of 20 paragraphs and list items are missing or incomplete, starting at paragraph 21/],
    ['paraphrased', () => mdxPostParaphrased(payload), /3 of 20 paragraphs and list items are missing or rewritten: paragraph 3, paragraph 11, paragraph 21/],
    ['duplicated', () => { const output = good(); const text = String(output.files[articlePath]); return { ...output, files: { [articlePath]: text + '\n' + blocksToMarkdown(ARTICLE.slice(0, 12)) } }; }, /\d+ of 13 paragraphs appear more than once \(at most 1 may repeat\)/],
    ['padded', () => { const random = seeded(31); const output = good(); return { ...output, files: { [articlePath]: String(output.files[articlePath]) + '\n## More from our blog\n\n' + Array.from({ length: 16 }, () => paragraph(random, 4)).join('\n\n') + '\n' } }; }, /the article file adds \d+ words; the supplied article has \d+, so at most \d+ are allowed/],
  ])('article fidelity: %s', async (_label, output, reason) => {
    const error = await failureOf(gateInput(mdxTree(), payload, output()));
    expectFailure(error, 'article-fidelity', true);
    expect(error.diagnostic!.path).toBe(articlePath);
    expect(error.diagnostic!.reason).toMatch(/^the article was not carried over faithfully: /);
    expect(error.diagnostic!.reason).toMatch(reason);
    expect(error.diagnostic!.issues!.length).toBeGreaterThan(0);
  });
  it('article fidelity: a paragraph left out of a typed registry record', async () => {
    const repository = typedRegistryRepository();
    const error = await failureOf(gateInput(treeOf(repository), payload, registryIntegration(repository.get(REGISTRY_PATH)!, payload, without(13))));
    expectFailure(error, 'article-fidelity', true);
    expect(error.diagnostic!.reason).toContain('paragraph 18');
    expect(error.diagnostic!.issues).toEqual(['1 of 20 paragraphs and list items are missing or rewritten: paragraph 18 (numbers are unit indexes in article.json, counted from 0)']);
  });
  it('article fidelity: the article must be in the file the report names', async () => {
    const elsewhere = await failureOf(gateInput(mdxTree(), payload, { ...good(), articlePath: 'content/blog/another-post.mdx' }));
    expectFailure(elsewhere, 'article-fidelity', true);
    expect(elsewhere.diagnostic!.reason).toBe('the reported article file is not among the changed files, so the article was not written where the report says');
    const empty = await failureOf(gateInput(mdxTree(), payloadFor([]), good()));
    expectFailure(empty, 'article-fidelity', false);
  });

  it('identity: a refresh may not move the page, and needs the page address', async () => {
    const repository = guideRepository(); const original = repository.get(GUIDE_PATH)!;
    const refresh = payloadFor(ARTICLE, { mode: 'refresh', refreshUrl: GUIDE_REFRESH_URL });
    const moved = await failureOf(gateInput(treeOf(repository), refresh, { ...guideRefreshed(original, refresh), route: '/blog/' + GUIDE_SLUG }));
    expectFailure(moved, 'identity-changed', false);
    expect(moved.diagnostic!.reason).toBe('the refresh would change the public route of the existing page');
    for (const refreshUrl of [null, 'ftp://rentals.example/guides/renting-checklist', 'not a url']) {
      const unknown = payloadFor(ARTICLE, { mode: 'refresh', refreshUrl });
      expectFailure(await failureOf(gateInput(treeOf(repository), unknown, guideRefreshed(original, unknown))), 'identity-changed', false);
    }
    expect(GUIDE_ROUTE).toBe('/guides/renting-checklist');
  });
  it('identity: a retry keeps slug and article path, a migration keeps the slug', async () => {
    const retry = { slug: payload.slug, articlePath };
    expectFailure(await failureOf(gateInput(mdxTree(), payload, { ...good(), slug: payload.slug + '-2' }, { retry })), 'identity-changed', false);
    const movedPath = POST_PATH(payload.slug + '-copy');
    expectFailure(await failureOf(gateInput(mdxTree(), payload, { ...good(), files: { [movedPath]: good().files[articlePath] }, articlePath: movedPath }, { retry })), 'identity-changed', false);
    expectFailure(await failureOf(gateInput(mdxTree(), payload, { ...good(), slug: 'renamed-review' }, { legacy: { slug: payload.slug, articlePath: 'content/posts/old.md' } })), 'identity-changed', false);
  });
  it.each([
    ['a slug with a path separator', { slug: 'reviews/larkfield' }],
    ['an empty slug', { slug: '' }],
    ['a route that is not a site path', { route: 'blog/larkfield-commons-review' }],
    ['a protocol-relative route', { route: '//elsewhere.example/blog/larkfield' }],
    ['a route with a parent segment', { route: '/blog/%2e%2e/admin' }],
    ['a route with whitespace', { route: '/blog/larkfield review' }],
  ])('identity: %s', async (_label, report) => {
    expectFailure(await failureOf(gateInput(mdxTree(), payload, { ...good(), ...report })), 'identity-changed', false);
  });
  it('identity: an article path the write rules protect', async () => {
    const error = await failureOf(gateInput(mdxTree(), payload, { ...good(), files: { 'package.json': '{}' }, articlePath: 'package.json' }));
    expectFailure(error, 'protected-path', true);
  });

  it('outcome: an agent run that did not complete, and an agent that declined', async () => {
    const failed = await failureOf(gateInput(mdxTree(), payload, { ...good(), result: { status: 'agent_error', agentError: 'AgentResult:error_max_turns' } }));
    expectFailure(failed, 'agent-failed', false);
    expect(failed.diagnostic!.reason).toBe('the agent run did not complete (agent_error, AgentResult:error_max_turns)');
    expectFailure(await failureOf(gateInput(mdxTree(), payload, { ...good(), result: { status: 'deadline' } })), 'agent-failed', false);
    const reason = 'The blog is rendered from https://cms.example.com/api?key=abc123 and `const posts = await fetch(CMS_URL)` so there is no file to edit. ' + 'Larkfield Commons sits ten minutes from the ferry terminal. '.repeat(20);
    const declined = await failureOf(gateInput(mdxTree(), payload, { ...good(), files: {}, report: { status: 'cannot_integrate', reason } }));
    expect(declined.diagnostic!.code).toBe('agent-declined');
    expect(declined.repairable).toBe(false);
    expect(declined.diagnostic!.reason).toContain('The blog is rendered from');
    expect(declined.diagnostic!.reason).not.toMatch(/https?:|cms\.example|abc123|await fetch/);
    expect(declined.diagnostic!.reason.length).toBeLessThanOrEqual(600);
  });
  it('nothing to publish: no files, or only files identical to the pinned commit', async () => {
    const none = await failureOf(gateInput(mdxTree(), payload, { ...good(), files: {} }));
    expectFailure(none, 'plan-empty', false);
    const untouched = [...mdxRepository.keys()].find(path => path.endsWith('.mdx'))!;
    expectFailure(await failureOf(gateInput(mdxTree(), payload, { files: { [untouched]: mdxRepository.get(untouched)! }, articlePath: untouched, route: '/blog/x' })), 'plan-empty', false);
    // A retry with nothing changed and no article on the branch is not "already complete".
    expectFailure(await failureOf(gateInput(mdxTree(), payload, { ...good(), files: {} }, { retry: { slug: payload.slug, articlePath } })), 'plan-empty', false);
  });
  it('retry with nothing changed: an incomplete article on the branch is refused, not reported as complete', async () => {
    const partial = String(mdxPostFrom(payload, ARTICLE.slice(0, 15)).files[articlePath]);
    const tree = treeOf(new Map([...mdxRepository, [articlePath, partial]]));
    const error = await failureOf(gateInput(tree, payload, { ...good(), files: {} }, { retry: { slug: payload.slug, articlePath } }));
    expectFailure(error, 'article-fidelity', true);
    expect(error.diagnostic!.reason).toContain('the article is cut short');
  });
});

describe('publication gate: what it reads and what it reports', () => {
  it('judges the downloaded bytes, not the runner’s summary of them', async () => {
    const input = gateInput(mdxTree(), payload, good());
    input.result.changed = input.result.changed.map(change => ({ ...change, bytes: 1 }));
    const result = await runPublicationGate(input);
    expect(result.files[0].content).toBe(String(good().files[articlePath]));
    expect(blobSha(Buffer.from(result.files[0].content))).toBe(blobSha(input.finals.get(articlePath)!));
  });
  it('fails on the first violated rule, in the designed order', async () => {
    // A protected path, a credential and a missing paragraph together: the path rule is reported.
    const output: AgentOutput = { ...mdxPostFrom(payload, ARTICLE.slice(0, 5)), };
    output.files['package.json'] = '{ "token": "' + 'ghp_' + 'a1B2c3D4e5'.repeat(4) + '" }';
    expect((await failureOf(gateInput(mdxTree(), payload, output))).diagnostic!.code).toBe('protected-path');
    // A credential and a missing paragraph: the credential is reported.
    const leaking = mdxPostFrom(payload, ARTICLE.slice(0, 5));
    leaking.files['src/lib/keys.ts'] = 'export const k = "' + 'ghp_' + 'a1B2c3D4e5'.repeat(4) + '";';
    expect((await failureOf(gateInput(mdxTree(), payload, leaking))).diagnostic!.code).toBe('credential-detected');
  });
  it('emits only codes from the shared diagnostic list and marks exactly the repairable ones', async () => {
    const error = await failureOf(gateInput(mdxTree(), payload, { ...good(), files: {} }));
    expect(SANDBOX_DIAGNOSTIC_CODES).toContain(error.diagnostic!.code);
    expect(isRepairableGateFailure(new Error('other'))).toBe(false);
    expect(isRepairableGateFailure(new PublishError(422, 'x', '', 'config', { code: 'article-fidelity', stage: 'validation', reason: 'x' }))).toBe(false);
  });
  it('does not let a hostile path or report put markup, addresses or secrets into a diagnostic', async () => {
    const hostile = 'content/blog/`rm -rf`-https://evil.example/x?token=abc-' + 'ghp_' + 'a1B2c3D4e5'.repeat(4) + '.exe\u0007.png';
    const error = await failureOf(gateInput(mdxTree(), payload, withFiles({ [hostile]: 'x' })));
    expect(['credential-detected', 'protected-path']).toContain(error.diagnostic!.code);
    const text = JSON.stringify(error.diagnostic) + error.message;
    expect(text).not.toMatch(/evil\.example|ghp_|rm -rf|\\u0007/);
  });
});
