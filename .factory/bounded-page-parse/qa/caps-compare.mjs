// node caps-compare.mjs <branch.jsonl> <base.jsonl>: one line per scenario of caps.mjs, the same or what differs.
import fs from 'node:fs';
const [a, b] = process.argv.slice(2).map(f => fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l)));
for (let i = 0; i < a.length; i++) {
  const x = a[i], y = b[i]; const differs = Object.keys({ ...x, ...y }).filter(k => JSON.stringify(x[k]) !== JSON.stringify(y[k]));
  console.log(JSON.stringify(differs.length ? { name: x.name, differs: Object.fromEntries(differs.map(k => [k, { branch: x[k], base: y[k] }])), same: Object.keys(x).filter(k => k !== 'name' && !differs.includes(k)) } : { name: x.name, verdict: 'the same on the branch and the base', pagesCrawled: x.pagesCrawled, homeLinks: x.homeLinks }));
}
