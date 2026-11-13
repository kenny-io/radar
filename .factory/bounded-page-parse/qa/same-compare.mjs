// Compares two files written by same.mjs (the branch's and the base's), value by value, and lists every difference.
// node same-compare.mjs <branch.json> <base.json>
import fs from 'node:fs';
const [a, b] = process.argv.slice(2).map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
delete a.root; delete b.root;
const diffs = []; let compared = 0;
const show = v => { const s = JSON.stringify(v); return s === undefined ? 'undefined' : s.length > 160 ? s.slice(0, 160) + `…(${s.length})` : s; };
(function walk(x, y, at) {
  if (x !== null && y !== null && typeof x === 'object' && typeof y === 'object' && Array.isArray(x) === Array.isArray(y)) { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], at + '/' + k); return; }
  compared++; if (x !== y) diffs.push({ at, branch: show(x), base: show(y) });
})(a, b, '');
const count = o => ({ crawls: Object.keys(o.crawls).length, pages: Object.values(o.crawls).reduce((n, c) => n + (c.result.pages?.length || 0), 0), brands: Object.keys(o.brands).length });
console.log(JSON.stringify({ branch: count(a), base: count(b), valuesCompared: compared, differences: diffs.length }));
for (const d of diffs.slice(0, 60)) console.log(JSON.stringify(d));
