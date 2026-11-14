// Round 2: what detectBrand still does in the calling process with what the reader hands back (CSS text, theme-color,
// lang, stylesheet addresses, logo candidates, the inline SVG), and how late the caller's 10 ms timer is meanwhile.
// Every home page is at most 2 MB; a stylesheet is read to 300,000 characters. No robots.txt is involved.
//   npx tsx .factory/bounded-page-parse/qa/brandcost.mjs          (also runs in a checkout of the base)
import { load, serve, monitor, timed, describeError, log, sleep, O } from './lib.mjs';
const { detectBrand } = await load();
console.warn = () => {};
const fill = (s, bytes) => s.repeat(Math.floor(bytes / Buffer.byteLength(s)));
const rep = (n, f) => { const out = new Array(n); for (let i = 0; i < n; i++) out[i] = f(i); return out.join(''); };
const hex = i => (i * 7919 % 0xffffff).toString(16).padStart(6, '0');
const page = (css, head = '') => `<!doctype html><html lang="en"><head>${head}<style>${css}</style></head><body></body></html>`;
const LINKS = '<link rel="stylesheet" href="/s1.css"><link rel="stylesheet" href="/s2.css"><link rel="stylesheet" href="/s3.css">';
const CSS = {
  'the shortest declarations, one neutral colour (--a:#fff;)': n => fill('--a:#fff;', n),
  'the shortest declarations, one colour (--a:#f00;)': n => fill('--a:#f00;', n),
  'declarations of colours close to one another (--a:#f0xxxx;)': n => rep(Math.floor(n / 12), i => `--a:#f0${(i % 4096).toString(16).padStart(4, '0').replace(/[4-9a-f]/g, '1')};`),
  'declarations named primary, one colour': n => fill('--primary:#f00;', n),
  'declarations of distinct colours': n => rep(Math.floor(n / 12), i => `--a:#${hex(i)};`),
  'rgb() declarations (--a:rgb(255,0,0);)': n => fill('--a:rgb(255,0,0);', n),
  'names of 128 characters with no colon': n => fill(' --' + 'a'.repeat(128), n),
  'names, 64 spaces, colon, 64 spaces, rgb( and 100 characters with no )': n => fill(` --a${' '.repeat(64)}:${' '.repeat(64)}rgb(${'1'.repeat(100)}`, n),
};
const cases = [];
for (const [name, make] of Object.entries(CSS)) {
  cases.push([`1.9 MB of CSS in the page: ${name}`, page(make(1_900_000)), {}]);
  cases.push([`1.0 MB of CSS in the page and three stylesheets of 300,000 characters: ${name}`, page(make(1_000_000), LINKS), Object.fromEntries(['/s1.css', '/s2.css', '/s3.css'].map(p => [p, { type: 'text/css', body: make(300_000) }]))]);
}
// The most CSS a home page can bring: its own 1.95 MB and three stylesheets read to 300,000 characters each.
for (const name of ['the shortest declarations, one colour (--a:#f00;)', 'declarations of colours close to one another (--a:#f0xxxx;)', 'the shortest declarations, one neutral colour (--a:#fff;)']) cases.push([`1.95 MB of CSS in the page and three stylesheets of 300,000 characters: ${name}`, page(CSS[name](1_950_000), LINKS), Object.fromEntries(['/s1.css', '/s2.css', '/s3.css'].map(p => [p, { type: 'text/css', body: CSS[name](300_000) }]))]);
cases.push(['a theme-color of 1.9 MB', page('', `<meta name="theme-color" content="rgb(${'1 , '.repeat(470_000)}">`), {}]);
cases.push(['a lang of 1.9 MB', `<!doctype html><html lang="${'en-'.repeat(630_000)}"><head></head></html>`, {}]);
cases.push(['a stylesheet address of 1.9 MB on this site', page('', `<link rel="stylesheet" href="/${'é'.repeat(900_000)}.css">`), {}]);
cases.push(['six logo candidates of 0.3 MB each', page('', rep(6, i => `<link rel="icon" sizes="512x512" href="/${i}${'é'.repeat(150_000)}.png">`)), {}]);
cases.push(['a header SVG of 199,000 characters of fills, no other candidate', `<!doctype html><html><body><header><svg viewBox="0 0 1 1">${rep(6_500, i => `<path fill="#${hex(i)}"/>`)}</svg></header></body></html>`, {}]);
for (const [name, html, files] of cases) {
  if (process.argv[2] && !name.includes(process.argv[2])) continue;
  if (Buffer.byteLength(html) > 2 * 1024 * 1024) { log({ name, skipped: 'over 2 MB' }); continue; }
  serve(url => url.origin === O ? files[url.pathname] : undefined);
  await sleep(100); const watch = monitor();
  const r = await timed(() => detectBrand('qa-brandcost', html, O)); await sleep(20);
  log({ name, pageMb: Math.round(Buffer.byteLength(html) / 10485.76) / 100, ms: r.ms, ...watch.stop(), result: r.error ? describeError(r.error) : JSON.stringify(r.value).slice(0, 110) });
}
