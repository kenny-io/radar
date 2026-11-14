// Base against the revision under test, file by file, from evidence/old.json (old-decode.mjs) and evidence/new.json
// (corpus.qa.test.ts).
//   node .factory/safe-provider-image-decode/qa/compare.mjs [--list]
import fs from 'node:fs';
const dir = new URL('./evidence/', import.meta.url);
const old = JSON.parse(fs.readFileSync(new URL('old.json', dir), 'utf8')); const neu = JSON.parse(fs.readFileSync(new URL('new.json', dir), 'utf8'));
const list = process.argv.includes('--list');
const oldOf = new Map(old.map(r => [r.group + '/' + r.name, r]));
const was = r => (r.signal ? `ended the process (${r.signal})` : r.out?.[0]?.ok ? 'cropped' : r.out?.[0]?.threw ? `threw "${r.out[0].threw}"` : 'no answer');
const now = r => (r.out[0].ok ? 'cropped' : r.out[0].refused.replace(/^The image model.s picture was refused: /, 'refused: '));
console.log(`revision under test: ${neu.children} children started, at most ${neu.mostChildrenAtOnce} at once, ${neu.inProcessLoadImageCalls} loadImage calls in the calling process, ${neu.distinctChildPrograms} child program text\n`);
const table = {}; const changed = []; const crops = { same: 0, n: 0 }; const slow = [];
for (const r of neu.rows) {
  const o = oldOf.get(r.group + '/' + r.name); const k = `${was(o)}  →  ${now(r)}`;
  (table[r.group] ??= {})[k] = (table[r.group][k] || 0) + 1;
  for (const c of r.out) { if (c.ok) { crops.n++; if (o.out?.find(x => x.size === c.size)?.sha === c.sha) crops.same++; } slow.push([c.ms, r.group + '/' + r.name + '@' + c.size, c.children]); }
  if (o.out?.[0]?.ok && !r.out[0].ok) changed.push([r.group, r.name, r.note, now(r), r.out[0].children]);
  if (list) console.log([r.group, r.name, was(o), now(r), r.out[0].children + ' child', r.out[0].ms + 'ms'].join(' | '));
}
for (const g of Object.keys(table)) { console.log(`── ${g} (${neu.rows.filter(r => r.group === g).length} files)`); for (const [k, n] of Object.entries(table[g]).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`); }
console.log(`\ncrops returned: ${crops.n}; byte-identical to the base's crop of the same file and size: ${crops.same}`);
const ended = old.filter(r => r.signal).length;
console.log(`files that ended the base's process: ${ended} of ${old.length}; of those, cropped by the revision: ${neu.rows.filter(r => oldOf.get(r.group + '/' + r.name).signal && r.out[0].ok).length}`);
const reached = neu.rows.flatMap(r => r.out).filter(c => c.children === 1); const crashed = neu.rows.flatMap(r => r.out).filter(c => /\(crashed\)/.test(c.refused || ''));
console.log(`crops that reached a child: ${reached.length}; children that crashed: ${crashed.length}; refused before any child: ${neu.rows.flatMap(r => r.out).filter(c => c.children === 0).length}`);
console.log(`\nDecoded by the base, refused by the revision (${changed.length} files):`);
for (const c of changed) console.log(`  ${c[0]}/${c[1]}  —  ${c[2]}  →  ${c[3]}${c[4] ? ' (in the child)' : ' (no child)'}`);
slow.sort((a, b) => b[0] - a[0]);
console.log('\nslowest crops:'); for (const s of slow.slice(0, 8)) console.log(`  ${s[0]} ms  ${s[1]}  (${s[2]} child)`);
const times = neu.rows.filter(r => r.group === 'good').flatMap(r => r.out).filter(c => c.ok).map(c => c.ms).sort((a, b) => a - b);
console.log(`good crops: median ${times[times.length >> 1]} ms, 90th percentile ${times[Math.floor(times.length * 0.9)]} ms, slowest ${times.at(-1)} ms (${times.length} crops)`);
