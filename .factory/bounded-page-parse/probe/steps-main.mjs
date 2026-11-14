// One page through every cheerio step that crawl.ts `extract`/`classifyPage` and brand.ts `detectBrand` run on `main`
// (8e3a4da3), each step timed on its own and printed as it finishes, so a run stopped by the time limit shows the step
// it was in. The statements are copied from those files; nothing is fetched.
//   node steps-main.mjs "<page name>" <n>
import * as cheerio from 'cheerio';
import { pages } from './pages.mjs';
const [name, nArg] = process.argv.slice(2); const html = pages[name](+nArg);
const step = (label, f) => { const t = performance.now(); let out, err; try { out = f(); } catch (e) { err = String(e?.message || e).slice(0, 80); } console.log(JSON.stringify({ step: label, ms: Math.round(performance.now() - t), ...(err ? { threw: err } : {}) })); return out; };
console.log(JSON.stringify({ page: name, n: +nArg, bytes: html.length }));
const $ = step('cheerio.load', () => cheerio.load(html));
if ($) {
  // crawl.ts extract
  step('extract: title, h1, description', () => [$('title').first().text(), $('h1').first().text(), $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content')]);
  step('extract: a[href] each + URL', () => { const links = new Set(); $('a[href]').each((_, el) => { try { links.add(new URL($(el).attr('href') || '', 'https://x.test/').toString()); } catch { } }); return links.size; });
  step('classify: og:type, ld+json', () => { $('meta[property="og:type"]').attr('content'); $('script[type="application/ld+json"]').each((_, el) => { $(el).text(); }); });
  step('classify: article / time[datetime]', () => $('article').length > 0 && $('article time[datetime], time[datetime]').length > 0);
  step('classify: main, body text words', () => $('main, body').first().text().split(/\s+/).length);
  const $t = step('extract: second cheerio.load', () => cheerio.load(html));
  if ($t) {
    step('extract: remove script,style,…', () => $t('script,style,noscript,svg,iframe,nav,footer,header form').remove());
    step('extract: main/body text', () => ($t('main').text() || $t('body').text()).replace(/\s+/g, ' ').trim().slice(0, 4000));
  }
  // brand.ts
  step('brand: style .map().get()', () => $('style').map((_, el) => $(el).text()).get().join('\n').length);
  step('brand: stylesheet link .map().get()', () => $('link[rel="stylesheet"]').map((_, el) => $(el).attr('href')).get().length);
  step('brand: icon link .map().get()', () => $('link[rel~="icon"]').map((_, el) => ({ href: $(el).attr('href'), sizes: $(el).attr('sizes'), type: $(el).attr('type') })).get().length);
  step('brand: apple-touch-icon .map().get()', () => $('link[rel~="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]').map((_, el) => $(el).attr('href')).get().length);
  step('brand: header/logo img select', () => $('header img, [class*="logo"] img, img[class*="logo"], img[alt*="logo" i], img[src*="logo" i]').length);
  step('brand: header/logo img .map().get()', () => $('header img, [class*="logo"] img, img[class*="logo"], img[alt*="logo" i], img[src*="logo" i]').map((_, el) => $(el).attr('src')).get().length);
  step('brand: og:image, theme-color, lang', () => [$('meta[property="og:image"]').attr('content'), $('meta[name="theme-color"]').attr('content'), $('html').attr('lang')]);
  const el = step('brand: header/logo svg select', () => $('header svg, [class*="logo"] svg').first());
  step('brand: $.html(svg)', () => (el && el.length ? $.html(el).length : 0));
}
console.log(JSON.stringify({ done: true }));
