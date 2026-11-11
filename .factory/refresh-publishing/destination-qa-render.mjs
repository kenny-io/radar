import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const [root, expectedPath] = process.argv.slice(2);
const require = createRequire(path.join(root, 'package.json'));
// CSS is checked by the real Next build/browser; this probe compares server markup.
Module._extensions['.css'] = () => {};
const ts = require('typescript');
const React = require('react');
globalThis.React = React; // Standalone tsx loader uses classic JSX for some existing components.
const { renderToStaticMarkup } = require('react-dom/server');
const file = 'apps/web/app/rent/dubai/[slug]/page.tsx';
const absolute = path.join(root, file);
function load(source, suffix) {
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const m = new Module(absolute + suffix);
  m.filename = absolute + suffix; m.paths = Module._nodeModulePaths(path.dirname(absolute));
  m._compile(compiled, m.filename);
  return m.exports.default;
}
const baseline = load(execFileSync('git', ['show', 'dbfb0f0b66b1a607bd3f0b2587a84064464c52b3:' + file], { cwd: root, encoding: 'utf8' }), '.baseline.cjs');
const proposed = load(fs.readFileSync(absolute, 'utf8'), '.proposed.cjs');
const { HUBS } = require(path.join(root, 'apps/web/app/rent/dubai/hubs.ts'));
const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
const results = [];
for (const hub of HUBS) {
  const props = { params: Promise.resolve({ slug: hub.slug }) };
  const before = renderToStaticMarkup(await baseline(props));
  const after = renderToStaticMarkup(await proposed(props));
  if (hub.slug !== '1-bedroom-apartments') assert.equal(after, before, 'Peer markup changed: ' + hub.slug);
  else {
    assert.equal(after.split(expected.html).length, 2, 'Full body must render once');
    assert.ok(!after.includes('&lt;h2&gt;What 1-bedroom rents look like'), 'Body must not be escaped');
    for (const s of hub.sections) assert.ok(!after.includes(s.body), 'Stale body duplicated');
    for (const faq of hub.faq) { assert.ok(after.includes(faq.question)); assert.ok(after.includes(faq.answer.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;'))); }
    assert.ok(after.includes('Browse properties')); assert.ok(after.includes('Write a review'));
    assert.ok(after.includes('Keep exploring')); assert.ok(after.includes('Editorial estimates by area'));
  }
  results.push({ slug: hub.slug, peerMarkupUnchanged: hub.slug === '1-bedroom-apartments' ? undefined : true, markupSha256: createHash('sha256').update(after).digest('hex') });
}
console.log(JSON.stringify({ status: 'passed', completeOriginalHtmlRendersOnce: true, staleEditorialBodyHidden: true, unchangedPeerOutputs: results.filter(r => r.peerMarkupUnchanged).length, targetFaqCtasAreaAndRelatedPreserved: true, records: results }, null, 2));
