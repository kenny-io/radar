// The colour functions of a checkout's brand.ts as that checkout wrote them, including the ones it does not export
// (cssColors, and on the base logoColors). The text between `const toHex` and `const maxSize` is taken from the file,
// its types are removed with esbuild, and it is evaluated with its imports handed in. Nothing is copied by hand, so
// "old pattern against new pattern" compares the real code of both revisions.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { transformSync } from 'esbuild';
export interface Internals { cssColors: ($: any, origin: string) => Promise<{ primary: string[]; secondary: string[]; any: string[] }>; normColor: (v: string) => string | null; logoColors?: (body: Buffer, type: string) => Promise<string[]>; svgColors?: (s: string) => string[]; source: string; cssPattern: string; svgPattern: string }
export function internals(checkout: string, fetchUrl: (url: string, accept?: string) => Promise<any>): Internals {
  const file = fs.readFileSync(checkout + '/src/server/services/analysis/brand.ts', 'utf8');
  const from = file.indexOf('const toHex'), to = file.indexOf('const maxSize');
  if (from < 0 || to < 0) throw new Error('brand.ts does not have the expected shape in ' + checkout);
  const source = file.slice(from, to).replace(/^export /gm, '');
  const js = transformSync(source, { loader: 'ts' }).code;
  const need = createRequire(checkout + '/package.json');
  const usesCanvas = /from '@napi-rs\/canvas'/.test(file);
  const deps: any = { fetchUrl, ...(usesCanvas ? need('@napi-rs/canvas') : {}), decodeInChild: () => { throw new Error('not used by the colour functions'); }, overPixelLimits: () => false, probeImage: () => null, ImageRefused: class extends Error {} };
  const made = new Function('deps', `const { fetchUrl, loadImage, createCanvas, decodeInChild, overPixelLimits, probeImage, ImageRefused } = deps;\n${js}\nreturn { cssColors, normColor, logoColors: typeof logoColors === 'undefined' ? undefined : logoColors, svgColors: typeof svgColors === 'undefined' ? undefined : svgColors };`)(deps);
  const cssPattern = /const re = (\/.+\/gi);/.exec(source)?.[1] ?? '?', svgPattern = /matchAll\((\/.+?\/gi)\)/.exec(source)?.[1] ?? '?';
  return { ...made, source, cssPattern, svgPattern };
}
