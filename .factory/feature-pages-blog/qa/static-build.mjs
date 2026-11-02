// Run against the exact production build PM hands to QA, not an older .next artifact.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const dist = process.env.NEXT_DIST_DIR || '.next';
const manifest = JSON.parse(await fs.readFile(`${dist}/prerender-manifest.json`, 'utf8'));
const slugs = ['does-chatgpt-recommend-you', 'rank-a-new-website', 'reddit-without-getting-banned', 'page-two-refresh', 'safe-backlinks-new-sites'];
const routes = ['daily-brief', 'organic-search', 'ai-visibility', 'social-marketing', 'performance', 'backlinks'].map(x => '/features/' + x).concat('/blog', slugs.map(x => '/blog/' + x));
for (const route of routes) assert(manifest.routes[route], 'route not prerendered: ' + route);
assert(manifest.routes['/blog/rss.xml'], 'RSS must be generated statically');
assert(!manifest.routes['/'], 'homepage must retain its dynamic signed-in redirect');
for (const route of ['/dashboard', '/settings', '/start-trial', '/onboarding']) assert(!manifest.routes[route], 'private/session route must remain dynamic: ' + route);
assert.equal(manifest.dynamicRoutes['/blog/[slug]']?.fallback, false, 'unknown blog slug must not fall back to runtime rendering');
const result = { buildId: await fs.readFile(`${dist}/BUILD_ID`, 'utf8'), revision: process.env.QA_REVISION || 'working-tree', routes, count: routes.length, feedStatic: true, homepageDynamic: true, privateRoutesDynamic: true, unknownBlogFallback: false };
await fs.writeFile(process.env.QA_OUTPUT || '.factory/feature-pages-blog/qa/static-build.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
