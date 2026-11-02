// Independent public/read-only acceptance checks. No signup, payment, website analysis or external publishing.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { chromium } from 'playwright';

const base = (process.env.BASE_URL || 'http://localhost:3930').replace(/\/$/, '');
const origin = 'https://radar.thally.io';
const qa = '.factory/feature-pages-blog/qa';
const inventory = JSON.parse(await fs.readFile(`${qa}/handoff-inventory.json`, 'utf8'));
const features = ['daily-brief', 'organic-search', 'ai-visibility', 'social-marketing', 'performance', 'backlinks'].map(x => '/features/' + x);
const posts = inventory.posts.map(x => '/blog/' + x.slug);
const indexable = ['/', ...features, '/blog', ...posts, '/privacy', '/terms', '/bot'];
const metadataPages = [...indexable, '/signup', '/signin'];
const marketingPages = ['/', ...features, '/blog', ...posts];
const result = { atUTC: new Date().toISOString(), base, revision: process.env.QA_REVISION || 'working-tree', passed: [], failed: [], pages: [], images: [], browser: [], networkMutations: [] };
const cache = new Map();
const url = path => new URL(path, origin).href;
async function check(name, fn) { try { await fn(); result.passed.push(name); } catch (error) { result.failed.push({ name, message: error.message }); console.error(name + ': ' + error.message); } }
async function get(path, ua = 'Mozilla/5.0 RadarMarketingQA/1.0', headers = {}, follow = true) {
  const target = new URL(path, origin);
  const response = await fetch(base + target.pathname + target.search, { headers: { 'User-Agent': ua, ...headers }, redirect: follow ? 'follow' : 'manual', signal: AbortSignal.timeout(25000) });
  const body = Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers: Object.fromEntries(response.headers), body, text: body.toString('utf8') };
}
function tags(html) {
  const $ = load(html), content = selector => $('head ' + selector).attr('content');
  for (const selector of ['title', 'meta[name="description"]', 'link[rel="canonical"]', 'meta[property="og:title"]', 'meta[property="og:description"]', 'meta[property="og:url"]', 'meta[property="og:type"]', 'meta[property="og:image"]', 'meta[name="twitter:card"]', 'meta[name="twitter:title"]', 'meta[name="twitter:description"]', 'meta[name="twitter:image"]']) assert.equal($('head ' + selector).length, 1, 'initial head requires ' + selector);
  return { $, title: $('head title').text(), description: content('meta[name="description"]'), canonical: $('head link[rel="canonical"]').attr('href'), ogTitle: content('meta[property="og:title"]'), ogDescription: content('meta[property="og:description"]'), ogUrl: content('meta[property="og:url"]'), ogType: content('meta[property="og:type"]'), image: content('meta[property="og:image"]'), width: content('meta[property="og:image:width"]'), height: content('meta[property="og:image:height"]'), alt: content('meta[property="og:image:alt"]'), twitterCard: content('meta[name="twitter:card"]'), twitterTitle: content('meta[name="twitter:title"]'), twitterDescription: content('meta[name="twitter:description"]'), twitterImage: content('meta[name="twitter:image"]'), robots: content('meta[name="robots"]') };
}
for (const path of metadataPages) await check(`metadata ${path}`, async () => {
  const response = await get(path); assert.equal(response.status, 200);
  const m = tags(response.text); assert(m.title); assert(m.description); assert.equal(new URL(m.canonical).href, url(path)); assert.equal(new URL(m.ogUrl).href, url(path));
  assert.equal(m.ogTitle, m.title); assert.equal(m.ogDescription, m.description); assert.equal(m.twitterTitle, m.title); assert.equal(m.twitterDescription, m.description);
  assert.equal(m.ogType, posts.includes(path) ? 'article' : 'website'); assert.equal(m.twitterCard, 'summary_large_image'); assert.equal(m.twitterImage, m.image); assert.equal(new URL(m.image).origin, origin); assert.equal(m.width, '1200'); assert.equal(m.height, '630'); assert(m.alt?.length > 10);
  assert.equal(m.$('h1').length, 1); assert(!response.headers['set-cookie']);
  if (['/signup', '/signin'].includes(path)) assert.match((m.robots || '') + (response.headers['x-robots-tag'] || ''), /noindex/);
  else assert(!/noindex/.test((m.robots || '') + (response.headers['x-robots-tag'] || '')));
  cache.set(path, { ...response, m }); result.pages.push({ path, title: m.title, description: m.description, canonical: m.canonical, image: m.image, type: m.ogType });
});
await check('unique page metadata', () => { assert.equal(new Set(result.pages.map(x => x.title)).size, metadataPages.length); assert.equal(new Set(result.pages.map(x => x.description)).size, metadataPages.length); });
const imageHashes = new Set();
for (const page of result.pages) await check(`image ${page.path}`, async () => {
  const response = await get(page.image); assert.equal(response.status, 200); assert.match(response.headers['content-type'], /^image\/png/); assert(!/noindex/.test(response.headers['x-robots-tag'] || ''));
  assert(response.body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))); assert.equal(response.body.readUInt32BE(16), 1200); assert.equal(response.body.readUInt32BE(20), 630); assert(response.body.length < 1024 * 1024);
  const hash = createHash('sha256').update(response.body).digest('hex'); imageHashes.add(hash); result.images.push({ page: page.path, url: page.image, bytes: response.body.length, hash });
});
await check('distinct18 card images', () => assert.equal(imageHashes.size, 18));
const screenshotSources = new Set();
for (const path of marketingPages) for (const src of cache.get(path)?.m.$('main img').map((_, e) => cache.get(path).m.$(e).attr('src')).get() || []) screenshotSources.add(src);
for (const src of screenshotSources) await check(`marketing screenshot ${src}`, async () => { const r = await get(src); assert.equal(r.status, 200); assert.match(r.headers['content-type'], /^image\//); assert(r.body.length > 1000); });
for (const path of ['/features/daily-brief', '/blog', posts[0]]) await check(`static cookie independence ${path}`, async () => {
  const normal = cache.get(path); const fake = await get(path, undefined, { Cookie: 'radar_session=qa-invalid-not-a-real-session' });
  assert.equal(fake.status, 200); assert(fake.body.equals(normal.body), 'static public bytes differ with irrelevant session cookie'); assert(!fake.headers['set-cookie']); assert(!/private|no-store/.test(fake.headers['cache-control'] || ''));
});
for (const path of features) await check(`feature structure ${path}`, () => {
  const $ = cache.get(path).m.$; assert($('main h2').length >= 8); assert.equal($('.fp-more a[href^="/features/"]').length, 2); assert.equal($('.fp-more a[href^="/blog/"]').length, 1);
  assert($('main img').length >= 1); $('main img').each((_, e) => assert(($(e).attr('alt') || '').trim().length > 10)); assert.match($('body').text(), /Illustrative|illustrative/);
});
for (const post of inventory.posts) await check(`article content ${post.slug}`, () => {
  const path = '/blog/' + post.slug, m = cache.get(path).m, $ = m.$;
  assert($('.po-b').text().length >= post.bodyTextLength * .7, 'article appears truncated'); assert($('.po-b h2[id]').length >= 5);
  const ids = new Set($('[id]').map((_, e) => $(e).attr('id')).get()); for (const id of post.sectionIds) assert(ids.has(id), 'missing supplied section ' + id);
  assert.equal($('.po-cta a[href^="/features/"]').length, 1); assert.equal($('.po-cta a[href^="/features/"]').attr('href'), post.cta.replace('../features/', '/features/').replace('.html', ''));
  assert.equal($('.bl-l a[href^="/blog/"]').length, 2); assert.equal(new Set($('.bl-l a[href^="/blog/"]').map((_, e) => $(e).attr('href')).get()).size, 2);
  assert.equal($('head link[type="application/rss+xml"]').attr('href'), origin + '/blog/rss.xml');
  const blocks = $('script[type="application/ld+json"]').map((_, e) => JSON.parse($(e).text())).get(); const graph = blocks.flatMap(x => x['@graph'] || [x]); const schema = graph.find(x => [x['@type']].flat().includes('BlogPosting')); assert(schema, 'BlogPosting required');
  assert.equal(schema.headline, $('h1').text()); assert.equal(schema.datePublished.slice(0, 10), $('time').first().attr('datetime')?.slice(0, 10)); assert(schema.dateModified); assert(Date.parse(schema.dateModified) >= Date.parse(schema.datePublished)); assert(schema.author && schema.publisher);
  const image = Array.isArray(schema.image) ? schema.image[0] : schema.image; assert.equal(typeof image === 'string' ? image : image?.url, m.image); assert(!JSON.stringify(schema).match(/aggregateRating|reviewCount|SearchAction/));
  const canonical = typeof schema.mainEntityOfPage === 'string' ? schema.mainEntityOfPage : schema.mainEntityOfPage?.['@id']; assert.equal(new URL(canonical).href, url(path));
});
await check('blog index order and latest', () => {
  const $ = cache.get('/blog').m.$; const ordered = [...$('.bl-f a[href^="/blog/"]').map((_, e) => $(e).attr('href')).get(), ...$('a.bl-f[href^="/blog/"]').map((_, e) => $(e).attr('href')).get(), ...$('.bl-l a[href^="/blog/"]').map((_, e) => $(e).attr('href')).get()];
  assert.deepEqual([...new Set(ordered)], posts); assert.equal($('head link[type="application/rss+xml"]').attr('href'), origin + '/blog/rss.xml');
});
const visitedLinks = new Map();
for (const path of marketingPages) await check(`internal links ${path}`, async () => {
  const $ = cache.get(path).m.$;
  for (const raw of new Set($('a[href]').map((_, e) => $(e).attr('href')).get())) {
    assert(raw !== '#', 'placeholder anchor'); assert(!/javascript:|\.html(?:[?#]|$)|preview=|Radar%20Home|Radar\.html/.test(raw), 'prototype/unsafe URL ' + raw);
    const target = new URL(raw, url(path)); if (target.origin !== origin || /^mailto:/.test(raw)) continue;
    const targetPath = target.pathname + target.search; let response = visitedLinks.get(targetPath) || cache.get(target.pathname);
    if (!response) { response = await get(targetPath); visitedLinks.set(targetPath, response); }
    assert.equal(response.status, 200, 'broken internal link ' + raw);
    if (target.hash) { const d = load(response.text); assert(d('[id]').toArray().some(e => d(e).attr('id') === decodeURIComponent(target.hash.slice(1))), 'broken hash ' + raw); }
  }
});
await check('discovery boundaries', async () => {
  const robots = await get('/robots.txt'); assert.equal(robots.status, 200); assert.match(robots.text, /Sitemap: https:\/\/radar\.thally\.io\/sitemap\.xml/); assert(!/Disallow: \/(?:blog|features)/.test(robots.text));
  const sitemap = await get('/sitemap.xml'); assert.equal(sitemap.status, 200); const $ = load(sitemap.text, { xmlMode: true }); assert.deepEqual(new Set($('url > loc').map((_, e) => new URL($(e).text()).href).get()), new Set(indexable.map(url)));
  for (const path of ['/llms.txt', '/llms-full.txt']) { const r = await get(path); assert.equal(r.status, 200); assert.match(r.headers['content-type'], /text\/plain/); assert.match(r.text, /\/blog/); for (const feature of features) assert(r.text.includes(feature), 'missing feature context ' + feature); assert(!/sk_live_|pk_live_|whsec_|radar_session|@guest\.radar/.test(r.text)); }
});
for (const path of ['/blog/not-a-real-guide', '/blog/../../not-a-real-guide', '/social/not-a-card.png']) await check(`not found ${path}`, async () => assert.equal((await get(path)).status, 404));
for (const path of ['/dashboard', '/settings', '/calendar', '/social', '/start-trial', '/onboarding', '/api/me']) await check(`private guard ${path}`, async () => { const r = await get(path, undefined, {}, false); assert.match(r.headers['x-robots-tag'] || '', /noindex/); assert([307, 308, 401].includes(r.status)); });
for (const ua of ['OAI-SearchBot/1.4', 'PerplexityBot/1.0', 'Claude-SearchBot/1.0', 'Googlebot/2.1', 'Twitterbot/1.0', 'facebookexternalhit/1.1', 'LinkedInBot/1.0', 'Slackbot-LinkExpanding 1.0', 'Discordbot/2.0', 'WhatsApp/2.24.1', 'TelegramBot (like TwitterBot)']) for (const path of ['/features/daily-brief', '/blog', posts[0]]) await check(`crawler ${ua} ${path}`, async () => { const r = await get(path, ua); assert.equal(r.status, 200); tags(r.text); });

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }); const page = await context.newPage();
  await check('RSS strict XML and ordered canonical items', async () => {
    const r = await get('/blog/rss.xml'); assert.equal(r.status, 200); assert.match(r.headers['content-type'], /application\/rss\+xml/); assert(!r.headers['set-cookie']);
    const feed = await page.evaluate(xml => { const d = new DOMParser().parseFromString(xml, 'application/xml'); return { errors: d.querySelector('parsererror')?.textContent, version: d.querySelector('rss')?.getAttribute('version'), items: [...d.querySelectorAll('item')].map(e => ({ title: e.querySelector('title')?.textContent, link: e.querySelector('link')?.textContent, guid: e.querySelector('guid')?.textContent, date: e.querySelector('pubDate')?.textContent })) }; }, r.text);
    assert(!feed.errors); assert.equal(feed.version, '2.0'); assert.deepEqual(feed.items.map(x => new URL(x.link).href), posts.map(url)); for (const item of feed.items) { assert.equal(item.guid, item.link); assert(Number.isFinite(Date.parse(item.date))); assert(item.title); } result.rss = feed;
  });
  const runtimeErrors = []; page.on('pageerror', e => runtimeErrors.push(e.message)); page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) result.networkMutations.push({ method: request.method(), url: request.url() }); });
  for (const width of [360, 390, 760, 1000, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of marketingPages) await check(`browser ${width} ${path}`, async () => {
      await page.goto(base + path, { waitUntil: 'networkidle', timeout: 30000 }); await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      const facts = await page.evaluate(() => ({ title: document.title, h1: document.querySelectorAll('h1').length, overflow: document.documentElement.scrollWidth > innerWidth + 1, images: [...document.querySelectorAll('main img')].map(x => ({ loaded: x.complete && x.naturalWidth > 0, lazy: x.loading === 'lazy', alt: x.alt })), footerLinks: [...document.querySelectorAll('footer a')].map(x => x.getAttribute('href')), footerColumns: getComputedStyle(document.querySelector('.foot-g')).gridTemplateColumns.split(' ').length, featureVisible: !!document.querySelector('.dd') && getComputedStyle(document.querySelector('.dd')).display !== 'none', schema: [...document.querySelectorAll('script[type="application/ld+json"]')].map(x => JSON.parse(x.textContent)) }));
      assert.equal(facts.h1, 1); assert(!facts.overflow, 'document horizontal overflow'); assert(facts.images.every(x => x.alt && (x.loaded || x.lazy)), 'missing alt or failed eager image'); assert.equal(facts.footerColumns, width <= 760 ? 2 : 4); assert.equal(facts.featureVisible, width >= 900); for (const feature of features) assert(facts.footerLinks.includes(feature)); assert(facts.footerLinks.includes('/blog'));
      result.browser.push({ path, width, title: facts.title, overflow: facts.overflow, footerColumns: facts.footerColumns });
      if (width === 1440 && ['/features/daily-brief', '/features/social-marketing', '/features/performance', '/blog', posts[0], posts[3]].includes(path)) await page.screenshot({ path: `${qa}/${process.env.QA_SCREEN_PREFIX || 'integrated'}-${path.slice(1).replaceAll('/', '-') || 'home'}.jpg`, type: 'jpeg', quality: 75 });
    });
  }
  await check('browser runtime and mutation boundary', () => { assert.deepEqual(runtimeErrors, []); assert.deepEqual(result.networkMutations, []); });
  await context.close();
  const noJs = await browser.newContext({ javaScriptEnabled: false }); const noJsPage = await noJs.newPage();
  for (const path of [...features, '/blog', ...posts]) await check(`no JavaScript ${path}`, async () => { await noJsPage.goto(base + path, { waitUntil: 'domcontentloaded' }); assert.equal(await noJsPage.locator('h1').count(), 1); assert((await noJsPage.locator('main').innerText()).length > (posts.includes(path) ? 2500 : path === '/blog' ? 700 : 3000)); assert.equal(await noJsPage.locator('head meta[property="og:image"]').count(), 1); });
  await noJs.close();
} catch (error) { result.failed.push({ name: 'browser initialization', message: error.message }); }
finally { await browser?.close(); }
await fs.writeFile(process.env.QA_OUTPUT || `${qa}/results.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ base, passed: result.passed.length, failed: result.failed, pages: result.pages.length, images: result.images.length, browserViews: result.browser.length }, null, 2));
if (result.failed.length) process.exitCode = 1;
