// Where the time goes inside the libraries: one page and one step under the V8 CPU profiler, top functions by self time.
//   node profile.mjs "<page name>" <n> <step: load | select-title | map-style | map-img | remove | select-img>
import { Session } from 'node:inspector/promises';
import * as cheerio from 'cheerio';
import { pages } from './pages.mjs';
const [name, nArg, what] = process.argv.slice(2); const html = pages[name](+nArg);
const steps = {
  'load': () => cheerio.load(html),
  'select-title': $ => $('title').first().text(),
  'map-style': $ => $('style').map((_, el) => $(el).text()).get().length,
  'map-img': $ => $('header img').map((_, el) => $(el).attr('src')).get().length,
  'remove': $ => $('script,style,noscript,svg,iframe,nav,footer,header form').remove(),
  'select-img': $ => $('header img, [class*="logo"] img, img[class*="logo"], img[alt*="logo" i], img[src*="logo" i]').length,
};
const $ = what === 'load' ? null : cheerio.load(html);
const s = new Session(); s.connect(); await s.post('Profiler.enable'); await s.post('Profiler.start');
const t = performance.now(); steps[what]($); const ms = Math.round(performance.now() - t);
const { profile } = await s.post('Profiler.stop');
const self = new Map(); const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map(n => [n.id, n]));
profile.samples.forEach((id, i) => { const n = byId.get(id); const f = n.callFrame; const key = `${f.functionName || '(anonymous)'} ${f.url.replace(/.*node_modules\//, '').replace(/^file:\/\/.*\//, '')}:${f.lineNumber + 1}`; self.set(key, (self.get(key) || 0) + dt[i]); });
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log(JSON.stringify({ page: name, n: +nArg, step: what, ms, top: [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${Math.round(100 * v / total)}% ${k}`) }));
