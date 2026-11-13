// Would the engineer's tests notice a wrong statement in the reader? Each mutant is one small change to a scratch copy
// of the branch (never the worktree); sameAsMain.test.ts is run against it, and then the rest of the analysis tests
// for the mutants it lets through.
// node mutate.mjs <scratch checkout of the branch, with node_modules>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const root = process.argv[2]; const dir = 'src/server/services/analysis';
const M = (file, from, to, name) => ({ file, from, to, name });
const R = 'pageReader.ts';
const MUTANTS = [
  M(R, ".text().trim().slice(0, 300);\n  const h1", ".text().trim().slice(0, 299);\n  const h1", 'title cut at 299'),
  M(R, "$('title').first()", "$('title').last()", 'last title instead of first'),
  M(R, "$('h1').first().text().replace(/\\s+/g, ' ')", "$('h1').first().text()", 'h1 whitespace not collapsed'),
  M(R, "$('h1').first()", "$('h1').last()", 'last h1 instead of first'),
  M(R, "($('meta[name=\"description\"]').attr('content') || $('meta[property=\"og:description\"]').attr('content') || '')", "($('meta[property=\"og:description\"]').attr('content') || $('meta[name=\"description\"]').attr('content') || '')", 'og:description before description'),
  M(R, ".trim().slice(0, 500);", ".trim().slice(0, 501);", 'description cut at 501'),
  M(R, "if (sameSite(new URL(n).hostname, new URL(origin).hostname)) links.add(n);", "links.add(n);", 'links to other sites kept'),
  M(R, "$('a[href]').each(", "$('a[href], area[href]').each(", 'area elements count as links'),
  M(R, "if (LISTING_PATH.test(path) || path === '/') return", "if (LISTING_PATH.test(path)) return", 'home page not always a page'),
  M(R, "if (og === 'article' || ld) return", "if (og === 'article') return", 'JSON-LD ignored'),
  M(R, "(BlogPosting|Article|NewsArticle|TechArticle)", "(BlogPosting|Article|TechArticle)", 'NewsArticle not an article'),
  M(R, "const og = ($('meta[property=\"og:type\"]').attr('content') || '').toLowerCase();", "const og = ($('meta[property=\"og:type\"]').attr('content') || '');", 'og:type case-sensitive'),
  M(R, "$('article time[datetime], time[datetime]').length > 0", "$('article time[datetime]').length > 0", 'time must be inside article'),
  M(R, "return { kind: 'page', sure: words < 600 };", "return { kind: 'page', sure: words <= 600 };", 'word limit off by one'),
  M(R, "$('main, body').first().text()", "$('body').first().text()", 'words counted from body only'),
  M(R, "$t('script,style,noscript,svg,iframe,nav,footer,header form').remove();", "$t('script,style,noscript,svg,iframe,footer,header form').remove();", 'nav text kept'),
  M(R, "$t('script,style,noscript,svg,iframe,nav,footer,header form').remove();", "$t('script,style,noscript,svg,iframe,nav,footer,form').remove();", 'every form removed'),
  M(R, "($t('main').text() || $t('body').text())", "$t('body').text()", 'text from body only'),
  M(R, ".replace(/\\s+/g, ' ').trim().slice(0, 4000);", ".replace(/\\s+/g, ' ').trim().slice(0, 4001);", 'text cut at 4001'),
  M(R, "$('sitemap > loc').each((_, el) => { sitemaps.push($(el).text().trim()); });", "$('sitemap > loc').each((_, el) => { sitemaps.push($(el).text()); });", 'child sitemap address not trimmed'),
  M(R, "$('sitemap > loc')", "$('sitemap loc')", 'any loc under sitemap'),
  M(R, "$('url > loc').each((_, el) => { const n = normUrl($(el).text().trim(), sm);", "$('url > loc').each((_, el) => { const n = normUrl($(el).text(), sm);", 'page address not trimmed (harmless: URL trims)'),
  M(R, "if (sameSite(new URL(n).hostname, host)) out.push(n);", "out.push(n);", 'sitemap addresses of other sites kept'),
  M(R, "cheerio.load(xml, { xmlMode: true })", "cheerio.load(xml)", 'sitemap parsed as HTML'),
  M(R, "x === 'any' ? 512", "x === 'any' ? 64", '"any" is 64'),
  M(R, "(i.size >= 96 || i.svg)", "(i.size > 96 || i.svg)", 'icon of exactly 96 dropped'),
  M(R, ".sort((a, b) => b.size - a.size)", ".sort((a, b) => a.size - b.size)", 'smallest icon first'),
  M(R, "/svg/.test($(el).attr('type') || '') || /\\.svg(\\?|$)/.test($(el).attr('href') || '')", "/svg/.test($(el).attr('type') || '')", 'SVG icon by type only'),
  M(R, "$('link[rel~=\"apple-touch-icon\"], link[rel=\"apple-touch-icon-precomposed\"]')", "$('link[rel~=\"apple-touch-icon\"]')", 'precomposed icon ignored'),
  M(R, "img[alt*=\"logo\" i], img[src*=\"logo\" i]", "img[alt*=\"logo\"], img[src*=\"logo\" i]", 'alt match case-sensitive'),
  M(R, "'header img, [class*=\"logo\"] img, img[class*=\"logo\"],", "'header img, img[class*=\"logo\"],", 'image under a logo class ignored'),
  M(R, "return [...new Set([...icons, ...apple, ...headerImgs, ...(og ? [og] : [])])];", "return [...new Set([...icons, ...apple, ...(og ? [og] : []), ...headerImgs])];", 'og:image before header images'),
  M(R, "return [...new Set([...icons, ...apple, ...headerImgs, ...(og ? [og] : [])])];", "return [...icons, ...apple, ...headerImgs, ...(og ? [og] : [])];", 'candidates not de-duplicated'),
  M(R, "$('header svg, [class*=\"logo\"] svg').first()", "$('header svg').first()", 'SVG under a logo class ignored'),
  M(R, "if (html.length > 200000) return null;", "if (html.length > 150000) return null;", 'SVG limit 150,000'),
  M(R, "return html.includes('xmlns') ? html : html.replace('<svg', '<svg xmlns=\"http://www.w3.org/2000/svg\"');", "return html;", 'xmlns not added'),
  M(R, "$('style').map((_, el) => $(el).text()).get().join('\\n')", "$('style').map((_, el) => $(el).text()).get().join('')", 'style texts joined without a newline'),
  M(R, "$('style').map((_, el) => $(el).text())", "$('head style').map((_, el) => $(el).text())", 'only styles in head'),
  M(R, ".get().filter(Boolean).slice(0, 3);", ".get().filter(Boolean).slice(0, 2);", 'two stylesheets'),
  M(R, "$('link[rel=\"stylesheet\"]')", "$('link[rel~=\"stylesheet\"]')", 'rel contains stylesheet'),
  M(R, "$('meta[name=\"theme-color\"]').attr('content') || ''", "$('meta[name=\"theme-color\"]').last().attr('content') || ''", 'last theme-color'),
  M(R, "$('html').attr('lang') || null", "$('[lang]').attr('lang') || null", 'lang from any element'),
  M(R, "function normUrl(href, base) {\n  try {\n    const u = new URL(href, base);\n    if (!/^https?:$/.test(u.protocol)) return null;\n    u.hash = ''; u.search = '';", "function normUrl(href, base) {\n  try {\n    const u = new URL(href, base);\n    if (!/^https?:$/.test(u.protocol)) return null;\n    u.hash = '';", 'reader keeps the query of a link'),
  M(R, "    let s = u.toString(); if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);\n    return s;\n  } catch { return null; }\n}\n\n/** Article vs page", "    let s = u.toString();\n    return s;\n  } catch { return null; }\n}\n\n/** Article vs page", 'reader keeps a trailing slash'),
  M(R, "const sameSite = (host, base) => host.replace(/^www\\./, '') === base.replace(/^www\\./, '');\nfunction normUrl(href, base) {", "const sameSite = (host, base) => host === base;\nfunction normUrl(href, base) {", 'reader: www. is another site'),
  M('crawl.ts', "first.links.forEach(push); fromSitemap.forEach(push);", "fromSitemap.forEach(push); first.links.forEach(push);", 'sitemap addresses queued before home links'),
  M('crawl.ts', "for (const loc of map.sitemaps) queue.push(loc);", "for (const loc of map.sitemaps) queue.unshift(loc);", 'child sitemaps read first'),
  M('brand.ts', "page.candidates.slice(0, 6)", "page.candidates.slice(0, 5)", 'five candidates tried'),
  M('brand.ts', "let css = page.css;", "let css = page.css.trim();", 'page CSS trimmed'),
];
const run = files => spawnSync('npx', ['vitest', 'run', ...files], { cwd: root, encoding: 'utf8', timeout: 600_000 });
const rows = [];
for (const m of MUTANTS) {
  const file = path.join(root, dir, m.file); const original = fs.readFileSync(file, 'utf8');
  if (original.split(m.from).length !== 2) { rows.push({ mutant: m.name, error: `the text to change occurs ${original.split(m.from).length - 1} times` }); console.log(JSON.stringify(rows.at(-1))); continue; }
  fs.writeFileSync(file, original.replace(m.from, m.to));
  try {
    const same = run([`${dir}/sameAsMain.test.ts`]);
    const row = { mutant: m.name, file: m.file, sameAsMain: same.status === 0 ? 'NOT NOTICED' : 'noticed', failed: (same.stdout.match(/Tests\s+(\d+) failed/) || [])[1] };
    if (same.status === 0) { const rest = run([`${dir}/pageReader.test.ts`, `${dir}/brand.test.ts`, `${dir}/unreadable.test.ts`, `${dir}/devsite.test.ts`]); row.otherAnalysisTests = rest.status === 0 ? 'NOT NOTICED' : 'noticed'; }
    rows.push(row); console.log(JSON.stringify(row));
  } finally { fs.writeFileSync(file, original); }
}
console.log(JSON.stringify({ mutants: rows.length, noticedBySameAsMain: rows.filter(r => r.sameAsMain === 'noticed').length, noticedOnlyByOtherTests: rows.filter(r => r.sameAsMain === 'NOT NOTICED' && r.otherAnalysisTests === 'noticed').length, notNoticed: rows.filter(r => r.otherAnalysisTests === 'NOT NOTICED').map(r => r.mutant), couldNotApply: rows.filter(r => r.error).map(r => r.mutant) }));
console.log(execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }) || 'scratch checkout clean');
