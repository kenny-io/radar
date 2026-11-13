// Lists every scenario where the base and the revision under test answered differently.
//   node .factory/safe-logo-decode/qa/compare-report.mjs
import fs from 'node:fs';
import path from 'node:path';
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'evidence');
const base = JSON.parse(fs.readFileSync(path.join(dir, 'compare-base.json'), 'utf8')), now = JSON.parse(fs.readFileSync(path.join(dir, 'compare-new.json'), 'utf8'));
const show = r => (r ? `${r.logo ? `logo ${r.logo.type} .${r.logo.ext} from ${r.logo.from}` : 'no logo'}; primary ${r.primary}; secondary ${r.secondary}; language ${r.language}` : '(not run)');
const key = r => r && JSON.stringify([r.logo && [r.logo.type, r.logo.ext, r.logo.from, r.logo.bytes], r.primary, r.secondary, r.language]);
const names = Object.keys(now); let same = 0; const diffs = [];
for (const n of names) { if (!base[n]) { diffs.push({ scenario: n, base: '(not run on the base: its decoder ends the process on this input)', now: show(now[n]) }); continue; } if (key(base[n]) === key(now[n])) same++; else diffs.push({ scenario: n, base: show(base[n]), now: show(now[n]), fetchOrderChanged: JSON.stringify(base[n].asked) !== JSON.stringify(now[n].asked) || undefined }); }
fs.writeFileSync(path.join(dir, 'compare-diff.json'), JSON.stringify({ scenarios: names.length, same, different: diffs.length, diffs }, null, 1));
console.log(`${names.length} scenarios: ${same} the same, ${diffs.length} different\n`);
for (const d of diffs) console.log(`${d.scenario}\n    base: ${d.base}\n    now:  ${d.now}`);
console.log('\nSAME (sample):'); for (const n of names.filter(n => base[n] && key(base[n]) === key(now[n])).slice(0, 200)) console.log(`  ${n}  →  ${show(now[n])}`);
