// The same pages as steps-main.mjs, read by the page reader (src/server/services/analysis/pageReader.ts) as a crawled
// page and as a home page for brand detection, plus sitemap shapes. For each read: how long it took to settle, how it
// ended, and the longest a 10 ms timer in this (the calling) process was kept waiting meanwhile.
// The limit is 5 s, as in the product (evidence/reader-steps.txt is that run); pass a longer one to see how long a
// document would have taken.
//   node --import tsx .factory/bounded-page-parse/probe/steps-reader.mjs [limit seconds] [pages|maps]     (from the repository root)
import { pages } from './pages.mjs';
const R = await import('../../../src/server/services/analysis/pageReader.ts');
const limit = (+process.argv[2] || 5) * 1000; const only = process.argv[3];
const font = 'k open font elements, then n paragraphs (each paragraph rebuilds the k fonts)';
const cases = [['style elements', 100_000], ['images in a header', 60_000], ['stylesheet links', 45_000], ['header svg nested deep', 64_000], ['nested divs', 64_000], ['nested divs then images', 16_000], ['nested spans with text between', 100_000], [font, 3_000], [font, 30_000],
  ['links', 85_000], ['a long class on an ancestor of n images', 150_000], ['nested divs then time elements', 16_000], ['ordinary: blog index of n cards', 4_000], ['ordinary: shop home page of n products', 2_500]];
const rep = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');
const maps = {
  'sitemap: a loc inside 64,000 nested url elements': `<urlset>${'<url>'.repeat(64_000)}<loc>https://a.example/x</loc>`,
  'sitemap: one address under 200,000 nested elements': `<urlset><url><loc>${'<a>'.repeat(200_000)}x</loc></url></urlset>`,
  'sitemap: one address under 12,000 nested elements': `<urlset><url><loc>${'<a>'.repeat(12_000)}x</loc></url></urlset>`,
  'sitemap: 30,000 nested sitemap elements, then 60,000 loc': `<x>${'<sitemap>'.repeat(30_000)}${'<loc>a</loc>'.repeat(60_000)}`,
  'sitemap: ordinary, 35,000 addresses': `<urlset>${rep(35_000, i => `<url><loc>https://a.example/page-${i}</loc></url>`)}</urlset>`,
  'sitemap: 150,000 empty url elements': `<urlset>${'<url/>'.repeat(150_000)}<url><loc>https://a.example/x</loc></url></urlset>`,
  'sitemap: the 64,000 nested divs page': pages['nested divs'](64_000),
  'sitemap: the 173 KB font page': pages[font](30_000),
};
const run = async (name, kind, read) => {
  let late = 0, last = performance.now(); const tick = setInterval(() => { const now = performance.now(); late = Math.max(late, now - last - 10); last = now; }, 10);
  const began = performance.now(); let out;
  try { const data = await read(); out = `read (${JSON.stringify(data).length} characters of data)`; } catch (e) { out = e.reason ? `${e.reason}${e.reason === 'failed' ? ': ' + e.message.split('(')[1]?.slice(0, 40) : ''}` : `ERROR ${e.message}`; }
  const ms = Math.round(performance.now() - began); clearInterval(tick);
  console.log(`${name} | ${kind} | ${ms} ms | ${out} | longest timer delay here ${Math.round(late)} ms`);
};
const o = { timeoutMs: limit };
if (!only || only === 'pages') for (const [name, n] of cases) {
  const html = pages[name](n); const label = `${name.slice(0, 40)}, n = ${n} (${Math.round(html.length / 1024)} KB)`;
  await run(label, 'page', () => R.readPage(html, 'https://a.example/x', 'https://a.example', o));
  await run(label, 'brand', () => R.readBrandPage(html, 'https://a.example', o));
}
if (!only || only === 'maps') for (const [name, xml] of Object.entries(maps)) await run(`${name} (${Math.round(xml.length / 1024)} KB)`, 'sitemap', () => R.readSitemap(xml, 'https://a.example/sitemap.xml', 'a.example', o));
process.exit(0);
