// QA-only SSR fixture: real generated route/body/content, real destination index page and registry.
// Shared visual/OG components are small shims; this is not a full destination build or deploy.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright';

const temp = process.env.QA_TEMP;
assert(temp, 'QA_TEMP must identify an isolated temporary fixture directory');
const generated = path.join(temp, 'generated');
const { compile } = await import(path.join(temp, 'node_modules/@mdx-js/mdx/index.js'));
const plan = JSON.parse(await fs.readFile(path.join(temp, 'plan.json'), 'utf8'));
const rootRequire = createRequire(path.join(process.cwd(), 'package.json'));
await fs.symlink(path.join(process.cwd(), 'node_modules'), path.join(generated, 'node_modules'), 'dir').catch(e => { if (e.code !== 'EEXIST') throw e; });
const shims = {
  '@/components/blog/post-shell': `import React from 'react'; export function PostShell({post,children}) { return <main><nav aria-label="Breadcrumb"><a href="/blog">Blog</a></nav><h1>{post.title}</h1><p>{post.description}</p><article>{children}</article></main>; }`,
  '@/components/blog/blog-index': `import React from 'react'; import {blogPosts} from '@/lib/blog'; export function BlogIndex() { return <main><h1>Blog</h1><ul>{blogPosts.map(post => <li key={post.slug}><a href={'/blog/'+post.slug}>{post.title}</a><p>{post.description}</p></li>)}</ul></main>; }`,
  '@/lib/site': `export const SITE_URL = 'https://fixture.example';`,
  '@/lib/og/template': `export const OG_SIZE = {width:1200,height:630}; export function renderOgImage(p) {return p;}`,
};
async function bundle(entry, name) {
  const output = path.join(generated, name + '.cjs');
  await build({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/jsx-runtime', 'react-dom/server'], jsx: 'automatic', plugins: [{
    name: 'qa-destination-adapters', setup(b) {
      b.onResolve({ filter: /^@\// }, args => shims[args.path] ? { path: args.path, namespace: 'qa-shim' } : { path: path.join(generated, 'src', args.path.slice(2) + '.ts') });
      b.onLoad({ filter: /.*/, namespace: 'qa-shim' }, args => ({ contents: shims[args.path], loader: 'tsx', resolveDir: generated }));
      b.onLoad({ filter: /\.mdx$/ }, async args => ({ contents: String(await compile(await fs.readFile(args.path, 'utf8'))), loader: 'js', resolveDir: path.dirname(args.path) }));
    },
  }] });
  delete rootRequire.cache[output]; return rootRequire(output);
}
const index = await bundle(path.join(generated, 'src/app/blog/page.tsx'), 'index');
const article = await bundle(path.join(generated, 'src/app/blog', plan.slug, 'page.tsx'), 'post');
const og = await bundle(path.join(generated, 'src/app/blog', plan.slug, 'opengraph-image.tsx'), 'og');
assert.equal(article.metadata.title, plan.payload.seoTitle);
assert.equal(og.default().title, plan.payload.title);
const pages = new Map([['/blog', index], ['/blog/' + plan.slug, article]]);
const server = http.createServer((request, response) => {
  const component = pages.get(new URL(request.url, 'http://localhost').pathname);
  if (!component) { response.writeHead(404); response.end('Missing'); return; }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><html lang="en"><head><title>' + (component.metadata?.title || 'Blog') + '</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + renderToStaticMarkup(React.createElement(component.default)) + '</body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const checks = [];
try {
  await page.goto(base + '/blog');
  const link = page.getByRole('link', { name: plan.payload.title, exact: true });
  assert.equal(await link.count(), 1); checks.push('Generated registry exposes exactly one new blog-index link');
  await link.focus(); await page.keyboard.press('Enter'); await page.waitForURL(base + '/blog/' + plan.slug);
  assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), plan.payload.title);
  assert.match(await page.locator('article').textContent(), /production integration planner/);
  assert.equal(await page.title(), plan.payload.seoTitle); checks.push('Keyboard blog-index navigation opens generated route, SEO title and MDX body');
  await page.reload(); assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), plan.payload.title); checks.push('Direct route survives refresh');
  await page.getByRole('link', { name: 'Blog', exact: true }).click(); await page.waitForURL(base + '/blog');
  assert.equal(await page.getByRole('link', { name: plan.payload.title, exact: true }).count(), 1); checks.push('Article breadcrumb returns to populated blog index');
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('link', { name: plan.payload.title, exact: true }).click();
  assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), plan.payload.title); checks.push('Mobile viewport opens same generated article');
  assert.deepEqual(errors, []); checks.push('No browser page errors');
  const evidence = { base, checks, errors, sourceRevision: plan.destinationRevision, paths: plan.paths, fixtureLimit: 'Real planner output, destination wrappers/index/registry and MDX compiler; shared visual and OG components shimmed. No full target build, Radar account flow or production deployment.' };
  await fs.writeFile('.factory/github-publishing-integration/qa/browser-result.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
