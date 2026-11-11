// QA only. Runs the production planner against an immutable, read-only real destination snapshot.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { planAppPost } from '../../../src/server/services/publishing/connectors/nextjs-integration';
import type { PublishPayload } from '../../../src/server/services/publishing/types';

const base = process.env.QA_TEMP!;
assert(base, 'QA_TEMP must identify an isolated temporary fixture directory');
const commit = 'c44cde2f12d5170a2fbaf4e038b467b12efb161f';
const entries = JSON.parse(await fs.readFile(path.join(base, 'tree.json'), 'utf8')).tree;
const read = async (name: string) => {
  const file = path.join(base, 'source', name);
  try { return await fs.readFile(file, 'utf8'); } catch {
    const encoded = execFileSync('gh', ['api', `repos/thallylabs/thally-website/contents/${name}?ref=${commit}`, '--jq', '.content'], { encoding: 'utf8' });
    const source = Buffer.from(encoded, 'base64').toString('utf8');
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, source);
    return source;
  }
};
const payload: PublishPayload = {
  entryId: 'e_QA_integration', title: 'QA: Reachable publishing from Radar', slug: 'qa-reachable-publishing',
  html: '', markdown: 'A generated article should be reachable from the blog index.\n\n## Publishing evidence\n\nThis body came from the production integration planner.\n',
  blocks: [], meta: 'A synthetic publishing integration acceptance check.', seoTitle: 'QA Radar Integration', keyword: 'publishing', date: '2026-11-05',
  image: null, canonical: null, mode: 'new', refreshUrl: null, sources: [], videos: [], author: 'QA',
};
const plan = await planAppPost('src/app/blog', payload, { entries, read });
assert.equal(plan.slug, payload.slug);
assert.equal(plan.files.filter(f => f.path === 'src/lib/blog.ts').length, 1);
assert(plan.files.some(f => f.path.endsWith('/page.tsx')));
assert(plan.files.some(f => f.path.endsWith('/body.tsx')));
assert(plan.files.some(f => f.path.endsWith('/opengraph-image.tsx')));
assert.equal(plan.files.find(f => f.path.endsWith('/content.mdx'))?.content, payload.markdown);
for (const file of plan.files) {
  const target = path.join(base, 'generated', file.path);
  await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, file.content);
}
const indexPath = path.join(base, 'generated', 'src/app/blog/page.tsx');
await fs.mkdir(path.dirname(indexPath), { recursive: true }); await fs.writeFile(indexPath, await read('src/app/blog/page.tsx'));
await fs.writeFile(path.join(base, 'plan.json'), JSON.stringify({ slug: plan.slug, paths: plan.files.map(f => f.path), destinationRevision: commit, payload }, null, 2));
console.log(JSON.stringify({ slug: plan.slug, paths: plan.files.map(f => f.path), destinationRevision: commit }, null, 2));
