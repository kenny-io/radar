// Independent read-only acceptance checks. Run against a production build or live URL.
// BASE_URL=http://localhost:3910 QA_OUTPUT=.factory/seo-ai-discovery/qa/local.json node .factory/seo-ai-discovery/qa/verify.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { load } from 'cheerio';
import { chromium } from 'playwright';
import robotsParser from 'robots-parser';

const base = (process.env.BASE_URL || 'https://radar.thally.io').replace(/\/$/, '');
const origin = 'https://radar.thally.io';
const publicPaths = ['/', '/features/organic-search', '/features/ai-visibility', '/features/backlinks', '/privacy', '/terms', '/bot'];
const entryPaths = ['/signup', '/signin'];
const result = { atUTC: new Date().toISOString(), base, revision: process.env.QA_REVISION || 'working-tree', passed: [], failed: [], pages: [], images: [], browser: [] };
const cache = new Map();
async function get(path, ua = 'Twitterbot/1.0', follow = true) {
  const url = new URL(path, base);
  if (url.origin === origin) url.host = new URL(base).host, url.protocol = new URL(base).protocol;
  const response = await fetch(url, { headers: { 'User-Agent': ua }, redirect: follow ? 'follow' : 'manual', signal: AbortSignal.timeout(30000) });
  const body = Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers: Object.fromEntries(response.headers), url: response.url, text: body.toString('utf8'), body };
}
async function check(name, run) {
  try { await run(); result.passed.push(name); }
  catch (error) { result.failed.push({ name, message: error.message }); }
}
function metadata(html) {
  const $ = load(html);
  const val = selector => $(selector).attr('content');
  return { $, title: $('title').text(), description: val('meta[name="description"]'), canonical: $('link[rel="canonical"]').attr('href'), robots: val('meta[name="robots"]'), ogTitle: val('meta[property="og:title"]'), ogDescription: val('meta[property="og:description"]'), ogUrl: val('meta[property="og:url"]'), ogType: val('meta[property="og:type"]'), image: val('meta[property="og:image"]'), width: val('meta[property="og:image:width"]'), height: val('meta[property="og:image:height"]'), alt: val('meta[property="og:image:alt"]'), twitterCard: val('meta[name="twitter:card"]'), twitterTitle: val('meta[name="twitter:title"]'), twitterDescription: val('meta[name="twitter:description"]'), twitterImage: val('meta[name="twitter:image"]') };
}
function assertSocialHead($) {
  for (const selector of ['link[rel="canonical"]', 'meta[property="og:title"]', 'meta[property="og:description"]', 'meta[property="og:url"]', 'meta[property="og:type"]', 'meta[property="og:image"]', 'meta[name="twitter:card"]', 'meta[name="twitter:title"]', 'meta[name="twitter:description"]', 'meta[name="twitter:image"]']) assert.equal($(`head ${selector}`).length, 1, `initial head requires ${selector}`);
}

for (const path of [...publicPaths, ...entryPaths]) await check(`metadata ${path}`, async () => {
  const response = await get(path); assert.equal(response.status, 200);
  const m = metadata(response.text); cache.set(path, { response, m });
  assert(m.title && m.description); assert.equal(new URL(m.canonical).href, new URL(path, origin).href);
  assert.equal(m.$('title').length, 1); assert.equal(m.$('meta[name="description"]').length, 1); assert.equal(m.$('link[rel="canonical"]').length, 1);
  assert.equal(m.ogTitle, m.title); assert.equal(m.ogDescription, m.description); assert.equal(new URL(m.ogUrl).href, new URL(m.canonical).href); assert.equal(m.ogType, 'website');
  assert.equal(m.twitterCard, 'summary_large_image'); assert.equal(m.twitterTitle, m.ogTitle); assert.equal(m.twitterDescription, m.description); assert.equal(m.twitterImage, m.image);
  assert(m.image?.startsWith(origin + '/')); assert(m.alt); assert.equal(m.width, '1200'); assert.equal(m.height, '630');
  assertSocialHead(m.$);
  if (entryPaths.includes(path)) assert(/noindex/.test(m.robots || response.headers['x-robots-tag'] || ''), 'entry route must noindex');
  else assert(!/noindex/.test((m.robots || '') + (response.headers['x-robots-tag'] || '')));
  result.pages.push({ path, title: m.title, description: m.description, canonical: m.canonical, image: m.image, robots: m.robots, xRobots: response.headers['x-robots-tag'] });
});
await check('unique public titles/descriptions', () => {
  const pages = [...publicPaths, ...entryPaths].map(p => cache.get(p)?.m).filter(Boolean);
  assert.equal(pages.length, publicPaths.length + entryPaths.length); assert.equal(new Set(pages.map(x => x.title)).size, pages.length); assert.equal(new Set(pages.map(x => x.description)).size, pages.length);
});

const imageUrls = [...new Set([...cache.values()].map(x => x.m.image).filter(Boolean))];
for (const image of imageUrls) await check(`image ${new URL(image).pathname}`, async () => {
  const response = await get(image); assert.equal(response.status, 200); assert.match(response.headers['content-type'], /^image\/png/);
  assert(!/noindex/.test(response.headers['x-robots-tag'] || ''), 'social assets must remain indexable');
  assert.equal(response.body.subarray(1, 4).toString(), 'PNG'); assert.equal(response.body.readUInt32BE(16), 1200); assert.equal(response.body.readUInt32BE(20), 630); assert(response.body.length > 5000);
  result.images.push({ url: image, bytes: response.body.length, width: 1200, height: 630, type: response.headers['content-type'] });
});

let sitemapUrls = [];
await check('robots and sitemap', async () => {
  const robots = await get('/robots.txt'); assert.equal(robots.status, 200); assert.match(robots.headers['content-type'], /^text\/plain/); assert(robots.text.includes(`Sitemap: ${origin}/sitemap.xml`));
  const policy = robotsParser(origin + '/robots.txt', robots.text);
  for (const ua of ['Googlebot', 'bingbot', 'OAI-SearchBot', 'PerplexityBot', 'Claude-SearchBot', 'GPTBot']) {
    for (const path of [...publicPaths, ...entryPaths, '/onboarding', '/dashboard']) assert.notEqual(policy.isAllowed(origin + path, ua), false, `${ua} cannot observe ${path}`);
    assert.equal(policy.isAllowed(origin + '/api/me', ua), false, `${ua} operational API should not be crawled`);
  }
  const sitemap = await get('/sitemap.xml'); assert.equal(sitemap.status, 200); assert.match(sitemap.headers['content-type'], /xml/);
  const $ = load(sitemap.text, { xmlMode: true }); sitemapUrls = $('url > loc').map((_, el) => $(el).text()).get();
  assert(sitemapUrls.length); assert.equal(new Set(sitemapUrls).size, sitemapUrls.length);
  assert.deepEqual([...sitemapUrls].sort(), publicPaths.map(p => new URL(p, origin).href).sort());
  for (const url of sitemapUrls) assert.equal(new URL(url).origin, origin);
  result.robots = robots.text; result.sitemapUrls = sitemapUrls;
});
await check('unknown social card returns actual 404', async () => { const response = await get('/social/not-a-radar-page.png'); assert.equal(response.status, 404); });

const discoveryPaths = ['/llms.txt', '/llms-full.txt', '/pricing.md'];
for (const path of discoveryPaths) await check(`context ${path}`, async () => {
  const response = await get(path); assert.equal(response.status, 200); assert.match(response.headers['content-type'], /text\/(plain|markdown)/); assert(!response.text.startsWith('<!DOCTYPE'));
  assert.match(response.text, /Radar/); assert.match(response.text, /Thally/);
  if (path !== '/llms.txt') {
    for (const price of ['$1', '$49', '$50']) assert(response.text.includes(price), `missing pricing fact ${price}`);
    assert.match(response.text, /(?:3|three)[ -]day/i); assert.match(response.text, /credit/i);
    assert.match(response.text, /support@thally\.io/);
  }
  assert(!/(?:sk_live_|pk_live_|whsec_|radar_session|@guest\.radar)/i.test(response.text));
  const links = [...response.text.matchAll(/\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g)].map(x => x[1]);
  for (const link of new Set(links)) {
    const url = new URL(link, base); if (url.origin !== origin && url.origin !== new URL(base).origin) continue;
    assert(!/^\/(api|dashboard|settings|article|calendar|profile|onboarding|start-trial)(\/|$)/.test(url.pathname), `private/transactional context link: ${url.pathname}`);
    const target = await get(url.pathname + url.search); assert.equal(target.status, 200, `broken context link ${url.pathname}`);
  }
  result[path] = { bytes: response.body.length, links };
});

for (const ua of ['facebookexternalhit/1.1', 'LinkedInBot/1.0', 'Twitterbot/1.0', 'OAI-SearchBot/1.4', 'PerplexityBot/1.0', 'Claude-SearchBot/1.0', 'Googlebot/2.1', 'bingbot/2.0', 'Slackbot-LinkExpanding 1.0', 'Discordbot/2.0', 'WhatsApp/2.24.1', 'TelegramBot (like TwitterBot)']) await check(`crawler ${ua}`, async () => {
  const response = await get('/', ua); assert.equal(response.status, 200); const m = metadata(response.text); assert(m.image); assert(m.canonical); assert.match(response.text, /\$50/); assert.match(response.text, /Questions/);
  assertSocialHead(m.$);
  const image = await get(m.image, ua); assert.equal(image.status, 200); assert.match(image.headers['content-type'], /^image\/png/);
});

for (const path of ['/login', '/start-trial', '/onboarding', '/start', '/dashboard', '/settings', '/calendar', '/social', '/brief', '/performance', '/backlinks', '/profile', '/article/seo-qa-probe', '/api/health', '/api/me']) await check(`indexing ${path}`, async () => {
  const response = await get(path, 'Googlebot/2.1', false); const m = metadata(response.text); assert(/noindex/.test((response.headers['x-robots-tag'] || '') + (m.robots || '')), `no explicit noindex on ${response.status}`);
  if (['/dashboard', '/settings', '/calendar', '/onboarding', '/start-trial'].includes(path)) assert([307, 308].includes(response.status));
});
await check('legacy login redirect preserves return path', async () => {
  const response = await get('/login?next=%2Fdashboard', 'Googlebot/2.1', false); assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.location, base).pathname, '/signin'); assert.equal(new URL(response.headers.location, base).searchParams.get('next'), '/dashboard');
});

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport }); const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const path of [...publicPaths, ...entryPaths]) await check(`browser ${viewport.width} ${path}`, async () => {
      await page.goto(base + path, { waitUntil: 'networkidle', timeout: 30000 });
      const facts = await page.evaluate(() => ({ title: document.title, canonical: document.querySelector('link[rel="canonical"]')?.href, schema: [...document.querySelectorAll('script[type="application/ld+json"]')].map(x => JSON.parse(x.textContent)), h1: [...document.querySelectorAll('h1')].map(x => x.textContent), overflow: document.documentElement.scrollWidth > innerWidth + 1, image: document.querySelector('meta[property="og:image"]')?.content, visibleText: document.body.innerText }));
      assert.equal(facts.canonical, new URL(path, origin).href); assert.equal(facts.h1.length, 1); assert(!facts.overflow); assert(facts.image);
      if (path === '/') {
        assert.match(facts.visibleText, /Thally/); assert.match(facts.visibleText, /\$49/);
        assert(facts.schema.length, 'homepage rendered JSON-LD required'); result.schema = facts.schema;
        const graph = facts.schema.flatMap(x => x['@graph'] || [x]);
        const org = graph.find(x => [x['@type']].flat().includes('Organization'));
        const site = graph.find(x => [x['@type']].flat().includes('WebSite'));
        const app = graph.find(x => [x['@type']].flat().some(t => ['SoftwareApplication', 'WebApplication'].includes(t)));
        assert(org && site && app); assert.equal(org.legalName, 'Fairspleet LLC'); assert.equal(site.name, 'Radar by Thally'); assert.equal(app.name, 'Radar');
        assert(graph.every(x => typeof x['@id'] === 'string' && x['@id'].startsWith('https://')));
        assert(!JSON.stringify(graph).includes('AggregateRating')); assert(!JSON.stringify(graph).includes('reviewRating'));
        const offer = [app.offers].flat()[0]; assert(offer); assert.equal(offer.priceCurrency, 'USD'); assert.equal(Number(offer.price), 50);
      }
      result.browser.push({ path, width: viewport.width, title: facts.title, h1: facts.h1, schemaBlocks: facts.schema.length, overflow: facts.overflow });
    });
    await check(`browser ${viewport.width} refresh`, async () => { await page.reload({ waitUntil: 'networkidle' }); assert.equal(new URL(page.url()).pathname, '/signin'); });
    await check(`browser ${viewport.width} public navigation`, async () => {
      await page.goto(base + '/', { waitUntil: 'networkidle' });
      // Story panels intentionally overlap during their scroll animation. Use the stable visible footer navigation.
      await page.locator('footer a[href="/features/organic-search"]').click(); await page.waitForURL('**/features/organic-search');
      await page.waitForFunction(expected => document.querySelector('link[rel="canonical"]')?.href === expected, origin + '/features/organic-search');
      assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), origin + '/features/organic-search');
      await page.goBack({ waitUntil: 'networkidle' }); assert.equal(new URL(page.url()).pathname, '/');
      await page.locator('#faq details').first().locator('summary').click(); assert(await page.locator('#faq details').first().getAttribute('open') !== null);
    });
    await check(`browser ${viewport.width} runtime errors`, () => assert.deepEqual(errors, []));
    await context.close();
  }
  const noJs = await browser.newContext({ javaScriptEnabled: false }); const noJsPage = await noJs.newPage();
  await check('browser without JavaScript can read product pricing FAQs', async () => {
    await noJsPage.goto(base, { waitUntil: 'domcontentloaded' });
    const text = await noJsPage.locator('body').innerText(); assert.match(text, /\$50/); assert.match(text, /\$49/); assert.match(text, /Thally/); assert(await noJsPage.locator('#faq details').count());
    assert.equal(await noJsPage.locator('h1').count(), 1); assert(await noJsPage.locator('meta[property="og:image"]').count());
  });
  await noJs.close();
  if (process.env.QA_CARD_GALLERY) await check('social cards render at thumbnail size', async () => {
    const gallery = await browser.newPage({ viewport: { width: 1080, height: 1000 } });
    const cards = publicPaths.map(path => ({ path, image: cache.get(path)?.m.image })).filter(x => x.image);
    await gallery.setContent('<!doctype html><html><head><style>body{margin:0;background:#ddd;font:16px sans-serif;padding:20px}main{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0}img{display:block;width:100%;height:auto}figcaption{padding:8px}</style></head><body><main>' + cards.map(x => `<figure><img src="${base + new URL(x.image).pathname}"><figcaption>${x.path}</figcaption></figure>`).join('') + '</main></body></html>');
    await gallery.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    assert(await gallery.locator('img').evaluateAll(images => images.every(image => image.naturalWidth === 1200 && image.naturalHeight === 630)));
    await gallery.screenshot({ path: process.env.QA_CARD_GALLERY, fullPage: true }); await gallery.close();
  });
} catch (error) { result.failed.push({ name: 'browser initialization', message: error.message }); }
finally { await browser?.close(); }

const output = process.env.QA_OUTPUT || '.factory/seo-ai-discovery/qa/results.json';
await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ base, passed: result.passed.length, failed: result.failed, imageCount: result.images.length, browserChecks: result.browser.length, output }, null, 2));
if (result.failed.length) process.exitCode = 1;
