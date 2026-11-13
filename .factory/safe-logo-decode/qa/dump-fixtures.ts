// Writes every QA fixture to a directory (argument 1) with a manifest, so plain Node scripts can read them.
//   node --import tsx .factory/safe-logo-decode/qa/dump-fixtures.ts <dir>
import fs from 'node:fs';
import path from 'node:path';
import { badFiles, goodFiles, mislabelled } from './fixtures';
const dir = process.argv[2]; fs.mkdirSync(dir, { recursive: true });
const manifest: { name: string; kind: string; type: string; file: string; bytes: number }[] = [];
const put = (kind: string, name: string, type: string, body: Buffer) => { const file = path.join(dir, `${kind}--${name.replace(/[^\w.-]/g, '_')}`); fs.writeFileSync(file, body); manifest.push({ name, kind, type, file, bytes: body.length }); };
for (const g of goodFiles()) put('good', g.name, g.type, g.body);
for (const [name, b] of Object.entries(badFiles())) put('bad', name, b.type, b.body);
for (const [name, b] of Object.entries(mislabelled())) put('mislabelled', name, b.type, b.body);
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(manifest.length, 'files in', dir);
