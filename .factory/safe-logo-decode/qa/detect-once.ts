// One detectBrand call in this process, against a site that exists only in this script (global fetch is replaced, so
// nothing leaves the machine). Meant to be started as a child by run-base-repro.mjs: a crash here ends this process.
//   cd <checkout> && STORAGE_DIR=<relative dir> node --import tsx <this file> <checkout> <case json file>
// The case: { html, files: { [path]: { type, file? , text? } } }. Prints one JSON line when detectBrand settles.
import fs from 'node:fs';
const [checkout, caseFile] = process.argv.slice(2);
const c = JSON.parse(fs.readFileSync(caseFile, 'utf8')) as { html: string; files: Record<string, { type: string; file?: string; text?: string; repeat?: [string, number] }> };
const bodyOf = (f: { file?: string; text?: string; repeat?: [string, number] }) => (f.file ? fs.readFileSync(f.file) : f.repeat ? Buffer.from(f.repeat[0].repeat(f.repeat[1])) : Buffer.from(f.text ?? ''));
globalThis.fetch = (async (url: any) => {
  const f = c.files[new URL(String(url)).pathname];
  return f ? new Response(bodyOf(f), { status: 200, headers: { 'content-type': f.type } }) : new Response('<html><body>Not found</body></html>', { status: 404, headers: { 'content-type': 'text/html' } });
}) as typeof fetch;
const beat = setInterval(() => {}, 50); // keeps the loop busy enough to notice a block; not needed for the result
const { detectBrand } = await import(checkout + '/src/server/services/analysis/brand.ts');
const html = c.html.replace(/\{\{repeat\|([^|}]+)\|(\d+)\}\}/g, (_m: string, s: string, n: string) => s.repeat(+n));
// QA_ALSO_PARSE=1: first time the HTML parse alone (cheerio.load, from the checkout's own node_modules), which detectBrand also does.
let parseMs: number | undefined;
if (process.env.QA_ALSO_PARSE) { const { createRequire } = await import('node:module'); const cheerio = createRequire(checkout + '/package.json')('cheerio'); const t0 = Date.now(); try { cheerio.load(html); } catch { /* */ } parseMs = Date.now() - t0; console.log(JSON.stringify({ parseMs })); }
const t = Date.now();
try { const result = await detectBrand('qa-base', html, 'https://1.2.3.4'); console.log(JSON.stringify({ settled: 'resolved', ms: Date.now() - t, parseMs, result })); }
catch (e: any) { console.log(JSON.stringify({ settled: 'rejected', ms: Date.now() - t, parseMs, error: String(e?.message || e).slice(0, 200) })); }
// QA_REPORT_CANVAS=1: is the canvas library's native code mapped into THIS process after detection? (AC1)
if (process.env.QA_REPORT_CANVAS) { const { createRequire } = await import('node:module'); const cache = Object.keys(createRequire(import.meta.url).cache); const shared = ((process as any).report?.getReport()?.sharedObjects ?? []) as string[]; console.log(JSON.stringify({ canvasModulesInRequireCache: cache.filter(k => k.includes('@napi-rs/canvas')).length, canvasNativeLibrariesMapped: shared.filter(x => /napi-rs|skia|canvas/i.test(x)) })); }
clearInterval(beat);
