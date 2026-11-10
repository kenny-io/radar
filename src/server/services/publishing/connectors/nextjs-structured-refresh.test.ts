import { beforeEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const M = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/server/ai', () => ({ ai: { run: M.run } }));
import { planRepositoryPost, type RepoSnapshot } from './nextjs-agent';
import type { PublishPayload } from '../types';

const target = { slug: 'south-district', title: 'South district', published: '2024-02-10', sections: ['Old editorial body.'], widgets: ['availability'], faq: ['How do I enquire?'] };
const peer = { slug: 'north-district', title: 'North district', published: '2023-06-12', sections: ['Unchanged peer editorial body.'], widgets: ['map'], faq: ['Where is it?'] };
const files = new Map([
  ['src/catalog/types.ts', 'export interface Guide {\n  slug: string;\n  title: string;\n  published: string;\n  sections: string[];\n  widgets: string[];\n  faq: string[];\n}\n'],
  ['src/catalog/records.ts', `import type { Guide } from './types';\nexport const records: Guide[] = [\n  ${JSON.stringify(target)},\n  ${JSON.stringify(peer)}\n];\n`],
  ['src/page.tsx', `import React from 'react';\nimport type { Guide } from './catalog/types';\nexport function Page({ record }: { record: Guide }) {\n  return <main><h1>{record.title}</h1><time>{record.published}</time><article>{record.sections.map(text => <p key={text}>{text}</p>)}</article><aside>{record.widgets.map(widget => <button key={widget}>{widget}</button>)}</aside><footer>{record.faq.map(question => <p key={question}>{question}</p>)}</footer></main>;\n}\n`],
  ['src/routes.ts', "import { records } from './catalog/records';\nexport const routeFor = (slug: string) => `/areas/${slug}`;\nexport const staticPaths = records.map(record => routeFor(record.slug));\n"],
  ['src/directory.ts', "import { records } from './catalog/records';\nimport { routeFor } from './routes';\nexport const directory = records.map(record => ({ label: record.title, href: routeFor(record.slug) }));\n"],
]);
const html = '<h2>Complete refreshed guide</h2><p>Exact original body with &amp; escaped text.</p><ul><li>Keep every item.</li></ul>';
const payload: PublishPayload = { entryId: 'editorial-refresh', title: 'Refreshed guide', slug: 'new-search-slug', html, markdown: '## Complete refreshed guide\n\nExact original body with & escaped text.\n\n- Keep every item.', blocks: [], meta: 'Updated editorial information.', keyword: 'guide', date: '2026-11-10', image: null, canonical: 'https://example.test/areas/south-district', mode: 'refresh', refreshUrl: 'https://example.test/areas/south-district', sources: [], videos: [], author: 'Company' };
const evidence = [
  { path: 'src/routes.ts', sha: 'sha:src/routes.ts', snippet: 'export const routeFor = (slug: string) => `/areas/${slug}`;', role: 'route' },
  { path: 'src/directory.ts', sha: 'sha:src/directory.ts', snippet: 'export const directory = records.map(record => ({ label: record.title, href: routeFor(record.slug) }));', role: 'listing' },
];
const oldBody = '{record.sections.map(text => <p key={text}>{text}</p>)}';
const richBody = '{record.articleHtml ? <div dangerouslySetInnerHTML={{ __html: record.articleHtml }} /> : record.sections.map(text => <p key={text}>{text}</p>)}';
function proposal() {
  return { slug: target.slug, articlePath: 'src/catalog/records.ts', route: '/areas/south-district', summary: 'Refresh the existing directory guide with an optional rich-body field and paired renderer.', changes: [
    { kind: 'edit', path: 'src/catalog/types.ts', expectedSha: 'sha:src/catalog/types.ts', content: null, edits: [{ before: '  sections: string[];', after: '  articleHtml?: string;\n  sections: string[];' }] },
    { kind: 'edit', path: 'src/catalog/records.ts', expectedSha: 'sha:src/catalog/records.ts', content: null, edits: [{ before: '"slug":"south-district",', after: '"slug":"south-district","articleHtml":{{RADAR_HTML_JSON}},' }] },
    { kind: 'edit', path: 'src/page.tsx', expectedSha: 'sha:src/page.tsx', content: null, edits: [{ before: oldBody, after: richBody }] },
  ], evidence: evidence.map(proof => ({ ...proof })) };
}
function snapshot(): RepoSnapshot {
  return { entries: [...files.keys()].map(path => ({ path, type: 'blob', sha: 'sha:' + path })), read: async path => files.get(path)! };
}
const review = () => ({ approved: true, summary: 'The optional full body is rendered on the original directory route; peers retain their legacy output and widgets.', issues: [] as string[], evidence: evidence.map(({ sha, ...proof }) => ({ ...proof })) });
function respond(plan = proposal(), verdict = review()) {
  M.run.mockImplementation(async (_task, input) => ({ json: input.purpose === 'github.integration.discover'
    ? { paths: [...files.keys()], complete: true, summary: 'Inspect the content type, shared records, page renderer, dynamic routes and directory.' }
    : input.purpose === 'github.integration.review' ? verdict : plan }));
}

/** Execute only this test's bounded authored fixture, never arbitrary connected repository code. */
function fixtureRuntime(source: Map<string, string>) {
  const cache = new Map<string, any>();
  const load = (path: string): any => {
    if (cache.has(path)) return cache.get(path);
    const content = source.get(path); if (content === undefined) throw new Error('Unknown fixture module: ' + path);
    const module = { exports: {} }; cache.set(path, module.exports);
    const code = ts.transpileModule(content, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
    const requireFixture = (name: string): any => {
      if (name === 'react') return React;
      if (name === './catalog/records') return load('src/catalog/records.ts');
      if (name === './routes') return load('src/routes.ts');
      throw new Error('Forbidden fixture import: ' + name);
    };
    new Function('require', 'module', 'exports', code)(requireFixture, module, module.exports);
    return module.exports;
  };
  const records = load('src/catalog/records.ts').records;
  const Page = load('src/page.tsx').Page;
  return { records, paths: load('src/routes.ts').staticPaths, directory: load('src/directory.ts').directory, render: (slug: string) => renderToStaticMarkup(React.createElement(Page, { record: records.find((record: any) => record.slug === slug) })) };
}
beforeEach(() => { M.run.mockReset(); });

describe('structured editorial refresh integration', () => {
  it('renders the exact host body once on its existing non-blog route while preserving peers, metadata and widgets', async () => {
    respond();
    const result = await planRepositoryPost('blog', payload, snapshot(), { businessId: 'business-1' });
    const final = new Map(files); for (const file of result.files) final.set(file.path, file.content);
    const before = fixtureRuntime(files); const after = fixtureRuntime(final);
    expect(result).toMatchObject({ slug: target.slug, route: '/areas/south-district', path: 'src/catalog/records.ts', draft: true });
    expect(after.records).toEqual([{ ...target, articleHtml: html }, peer]);
    expect(after.paths).toEqual(before.paths); expect(after.directory).toEqual(before.directory);
    expect(after.render(peer.slug)).toBe(before.render(peer.slug));
    const output = after.render(target.slug);
    expect(output.split(html)).toHaveLength(2);
    expect(output).not.toContain('Old editorial body.');
    expect(output).not.toContain('&lt;h2&gt;');
    expect(output).toContain('<time>2024-02-10</time>');
    expect(output).toContain('<button>availability</button>');
    expect(output).toContain('How do I enquire?');
    expect(result.files.map(file => file.path)).toEqual(['src/catalog/types.ts', 'src/catalog/records.ts', 'src/page.tsx']);
    for (const call of M.run.mock.calls) {
      expect(call[1].system).toContain('existing editorial page outside the blog');
      expect(call[1].system).toContain('PAIRED, ADDITIVE optional content type/schema field');
      expect(call[1].system).toContain('original renderer as the fallback');
      expect(call[1].system).toContain('do not move it into the blog or add duplicate blog registration');
    }
  });

  it('carries the same paired-refresh contract into correction and fresh review', async () => {
    const bad = proposal(); bad.evidence[0].sha = 'wrong'; respond(bad);
    const normal = M.run.getMockImplementation()!;
    M.run.mockImplementation(async (...args: any[]) => args[1].purpose === 'github.integration.repair' ? { json: proposal() } : normal(...args));
    await expect(planRepositoryPost('', payload, snapshot(), { businessId: 'business-1' })).resolves.toMatchObject({ route: '/areas/south-district' });
    expect(M.run.mock.calls.map(call => call[1].purpose)).toEqual(['github.integration.discover', 'github.integration.plan', 'github.integration.repair', 'github.integration.review']);
    for (const call of M.run.mock.calls) expect(call[1].system).toContain('PAIRED, ADDITIVE');
  });

  it.each([
    ['escaped HTML', (plan: ReturnType<typeof proposal>) => { plan.changes[2].edits[0].after = '{record.articleHtml ? <p>{record.articleHtml}</p> : record.sections.map(text => <p key={text}>{text}</p>)}'; }, 'The new HTML is escaped in a plain paragraph rather than rendered as rich content.'],
    ['missing consumer', (plan: ReturnType<typeof proposal>) => { plan.changes.pop(); }, 'The optional body field is stored but no renderer consumes it.'],
    ['peer deletion', (plan: ReturnType<typeof proposal>) => { plan.changes[1].edits.push({ before: ',\n  ' + JSON.stringify(peer), after: '' }); }, 'The shared registry change deletes an unrelated peer record.'],
    ['duplicate stale body', (plan: ReturnType<typeof proposal>) => { plan.changes[2].edits[0].after = '{record.articleHtml && <div dangerouslySetInnerHTML={{ __html: record.articleHtml }} />}' + oldBody; }, 'The old editorial body remains visible beside the complete replacement.'],
  ])('fails closed when independent source review rejects %s', async (_name, mutate, issue) => {
    const plan = proposal(); mutate(plan); respond(plan, { ...review(), approved: false, issues: [issue] });
    await expect(planRepositoryPost('', payload, snapshot(), { businessId: 'business-1' })).rejects.toMatchObject({ http: 422, diagnostic: expect.objectContaining({ code: 'review-rejected' }) });
    const calls = M.run.mock.calls.filter(call => call[1].purpose === 'github.integration.review');
    expect(calls).toHaveLength(2);
    expect(calls[0][1].system).toContain('Reject schema-only/storage-only changes');
    expect(calls[0][1].system).toContain('complete host body renders once');
  });

  it('keeps deterministic route preservation and protected-file guards for structured refreshes', async () => {
    const moved = proposal(); moved.route = '/blog/south-district'; respond(moved);
    await expect(planRepositoryPost('', payload, snapshot(), { businessId: 'business-1' })).rejects.toMatchObject({ http: 422 });
    const protectedEdit = proposal(); protectedEdit.changes[0].path = 'package.json'; respond(protectedEdit);
    await expect(planRepositoryPost('', payload, snapshot(), { businessId: 'business-1' })).rejects.toMatchObject({ http: 422 });
    expect(M.run.mock.calls.some(call => call[1].purpose === 'github.integration.review')).toBe(false);
  });
});
