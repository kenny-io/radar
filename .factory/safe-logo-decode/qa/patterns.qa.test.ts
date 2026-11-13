// D8 / AC7 / AC5: the colour patterns of the base and of the revision under test, each revision's own code
// (internals.ts), on a corpus of realistic CSS and SVG and on generated text; and a good raster logo's colours from the
// child process against the base's in-process histogram. Needs QA_BASE_CHECKOUT (a checkout of the base revision with
// node_modules); the comparisons skip themselves without it. Writes evidence/patterns.json.
import { afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { readLogo, svgColors } from '@/server/services/analysis/brand';
import { goodFiles, QA_DIR, noise } from './fixtures';
import { internals } from './internals';

const BASE = process.env.QA_BASE_CHECKOUT || '';
const sheets: Record<string, string> = {};
const fetchUrl = async (url: string) => { const p = new URL(url).pathname; return p in sheets ? { status: 200, type: 'text/css', body: Buffer.from(sheets[p]), url } : { status: 404, type: 'text/html', body: Buffer.from('nf'), url }; };
const NOW = internals(process.cwd(), fetchUrl);
const OLD = BASE ? internals(BASE, fetchUrl) : null;
const evidence: any = { base: BASE ? 'given' : 'not given', patterns: { css: { base: OLD?.cssPattern, now: NOW.cssPattern }, svg: { base: OLD?.svgPattern, now: NOW.svgPattern } }, cssCorpus: [], svgCorpus: [], generated: {}, raster: [] };
afterAll(() => fs.writeFileSync(path.join(QA_DIR, 'evidence/patterns.json'), JSON.stringify(evidence, null, 1)));
const cssOf = (which: typeof NOW, css: string) => which.cssColors(cheerio.load(`<html><head><style>${css}</style></head></html>`), 'https://x.example');
const oldSvg = (s: string) => OLD!.logoColors!(Buffer.from(s), 'image/svg+xml');

const CSS: Record<string, string> = {
  'plain :root block': `:root {\n  --color-primary: #0f766e;\n  --color-secondary: #c026d3;\n  --text: #111827;\n  --bg: #ffffff;\n}`,
  'minified': `:root{--primary:#0F766E;--primary-foreground:#fff;--accent:#C026D3;--border:#e5e7eb;--radius:.5rem}body{margin:0}a{color:var(--primary)}`,
  'comments around and inside': `/* theme */:root{/* brand */--brand:#0f766e;/* --brand-old:#ff0000; */--accent/**/:#c026d3;--main: /* x */ #123456}`,
  'rgb and rgba, commas': `:root{--primary:rgb(15, 118, 110);--secondary:rgba(192,38,211,0.9);--highlight:rgba( 245 , 158 , 11 , .5 )}`,
  'rgb, space separated and slash alpha': `:root{--primary:rgb(15 118 110);--secondary:rgb(192 38 211 / 80%);--accent:rgba(245 158 11 / .5)}`,
  'rgb percentages and decimals': `:root{--primary:rgb(100%, 0%, 0%);--secondary:rgb(12.5, 200.2, 3)}`,
  'upper-case hex and upper-case function': `:ROOT{--PRIMARY:#0F766E;--Secondary:#C026D3;--brand:RGB(1,2,3);--Accent:RGBA(250,100,0,1)}`,
  'short, 4, 5, 7 and 8 digit hex': `:root{--primary:#0a8;--secondary:#c026d3cc;--a:#0a8f;--b:#12345;--c:#1234567;--d:#C026D3FF}`,
  'spaces, tabs and new lines around the colon': `:root{\n\t--primary\t:\t#0f766e;\n  --secondary :\n      #c026d3;\n  --accent\n:\n#f59e0b;\n}`,
  'bootstrap-like': `:root,[data-bs-theme=light]{--bs-blue:#0d6efd;--bs-indigo:#6610f2;--bs-primary:#0d6efd;--bs-secondary:#6c757d;--bs-primary-rgb:13,110,253;--bs-primary-text-emphasis:#052c65;--bs-primary-bg-subtle:#cfe2ff;--bs-primary-border-subtle:#9ec5fe;--bs-body-color:#212529;--bs-body-bg:#fff;--bs-link-color:#0d6efd;--bs-border-color:#dee2e6;--bs-font-sans-serif:system-ui,-apple-system,"Segoe UI";--bs-gradient:linear-gradient(180deg, rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0));--bs-box-shadow:0 0.5rem 1rem rgba(0, 0, 0, 0.15);--bs-highlight-bg:#fff3cd}`,
  'wordpress-like (double dashes in names)': `body{--wp--preset--color--black:#000000;--wp--preset--color--vivid-red:#cf2e2e;--wp--preset--color--primary:#0073aa;--wp--preset--color--secondary:#005177;--wp--preset--gradient--vivid-cyan-blue-to-vivid-purple:linear-gradient(135deg,rgba(6,147,227,1) 0%,rgb(155,81,224) 100%);--wp--preset--font-size--small:13px;--wp--style--global--content-size:650px}`,
  'shopify-like (bare triplets)': `:root{--color-base-text:18, 18, 18;--color-base-accent-1:18,18,18;--gradient-base-accent-1:#121212;--color-button:157, 23, 77;--color-brand:#9D174D;--font-body-family:Assistant, sans-serif}`,
  'tailwind and shadcn-like (hsl triplets)': `@layer base{:root{--background:0 0% 100%;--foreground:222.2 84% 4.9%;--primary:222.2 47.4% 11.2%;--ring:215 20.2% 65.1%;--tw-ring-color:rgb(59 130 246 / 0.5);--tw-shadow:0 0 #0000;--tw-ring-offset-color:#fff;--brand:hsl(173 77% 26%);--accent:oklch(0.7 0.2 320)}}`,
  'names with text, fg, bg, border in them': `:root{--primary-text:#111111;--brand-bg:#0f766e;--main-border:#c026d3;--secondary-fg:#f59e0b;--accent-background:#2563eb;--primary:#DC2626;--highlight-border:#16a34a;--secondary-bg:#7c3aed}`,
  'var references and fallbacks': `:root{--primary:var(--blue-600, #2563eb);--secondary:var(--x);--accent:color-mix(in srgb, #c026d3 50%, white);--brand: #0f766e !important}`,
  'two blocks, dark mode override': `:root{--primary:#0f766e;--bg:#fff}@media (prefers-color-scheme:dark){:root{--primary:#5eead4;--bg:#0c0a09}}[data-theme="dark"]{--primary:#99f6e4}`,
  'selectors that look like properties (BEM modifiers)': `.btn--primary:hover{color:#fff}.card--brand:not(.x){background:#0f766e}.grid--accent :is(a){color:#f59e0b}.nav--main:focus-visible{outline:2px solid #c026d3}`,
  'three and four dashes, underscore and escape in names': `:root{---primary:#0f766e;----secondary:#c026d3;--_private-primary:#DC2626;--\\31 primary:#16a34a}`,
  'unicode and escapes in names': `:root{--couleur-primaire:#0f766e;--primär:#c026d3;--主色:#DC2626;--brand\\:x:#16a34a}`,
  'no semicolons, braces straight after': `a{--primary:#0f766e}b{--secondary:#c026d3}c{--accent:rgb(1,2,3)}`,
  'unclosed rgb( before a real one': `:root{--oops:rgb(1,2,3;--primary:#0f766e;--secondary:rgb(192,38,211)}`,
  'long but real values': `:root{--primary:rgb(  15   ,   118   ,   110  );--shadow-brand:0 0 0 1px rgba(15,118,110,.2),0 4px 6px -1px rgba(15,118,110,.1);--secondary:rgba(192, 38, 211, calc(var(--alpha) * var(--tw-bg-opacity, 1)))}`,
  'html inside a style element': `:root{--primary:#0f766e}</style><p style="--secondary:#c026d3">x</p><style>:root{--accent:#f59e0b}`,
  'empty': ``,
};
const SVGS: Record<string, string> = {
  'attributes, double quotes': `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#0F766E"/><path stroke="#c026d3" fill="none"/><circle fill="#0f766e"/></svg>`,
  'attributes, single quotes and none': `<svg><rect fill='#0F766E'/><path stroke=#c026d3 /><circle fill = "#f59e0b"/></svg>`,
  'style attributes': `<svg><rect style="fill:#0f766e;stroke:#c026d3;stroke-width:2"/><path style="fill: rgb(245, 158, 11); color : #2563eb"/></svg>`,
  'style element, minified': `<svg><style>.a{fill:#0f766e}.b{fill:#c026d3;stroke:#0f766e}.c{stop-color:#f59e0b}</style><rect class="a"/></svg>`,
  'gradients': `<svg><defs><linearGradient id="g"><stop offset="0" stop-color="#0F766E"/><stop offset="1" stop-color="rgb(192,38,211)" stop-opacity=".5"/></linearGradient></defs><rect fill="url(#g)"/></svg>`,
  'rgb forms': `<svg><rect fill="rgb(15,118,110)"/><rect fill="rgba(192, 38, 211, 0.5)"/><rect fill="rgb(245 158 11)"/><rect fill="RGB(37,99,235)"/><rect fill="rgb(100%,0%,0%)"/></svg>`,
  'short and long hex, upper case': `<svg><rect fill="#0A8"/><rect fill="#0a8"/><rect fill="#C026D3FF"/><rect fill="#c026d380"/><rect fill="#12345"/></svg>`,
  'named, none, currentColor, url': `<svg><rect fill="red"/><rect fill="none"/><rect fill="currentColor"/><rect fill="url(#a)"/><rect fill="#0f766e"/></svg>`,
  'neutrals only': `<svg><rect fill="#000"/><rect fill="#fff"/><rect fill="#808080"/><rect stroke="#111111"/></svg>`,
  'flood-color, lighting-color, background-color': `<svg><feFlood flood-color="#0f766e"/><feDiffuseLighting lighting-color="#c026d3"/><rect style="background-color:#f59e0b"/></svg>`,
  'new lines inside attributes': `<svg>\n<rect\n  fill\n  =\n  "#0f766e"\n/>\n<path stroke=\n"#c026d3"/></svg>`,
  'illustrator export': `<?xml version="1.0" encoding="utf-8"?>\n<!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->\n<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" x="0px" y="0px" viewBox="0 0 100 100" style="enable-background:new 0 0 100 100;" xml:space="preserve">\n<style type="text/css">\n\t.st0{fill:#0F766E;}\n\t.st1{fill:#C026D3;}\n\t.st2{fill:none;stroke:#0F766E;stroke-width:2;stroke-miterlimit:10;}\n</style>\n<path class="st0" d="M0,0h10v10H0V0z"/></svg>`,
  'inkscape export': `<svg xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns="http://www.w3.org/2000/svg"><sodipodi:namedview pagecolor="#ffffff" bordercolor="#666666" inkscape:pageopacity="0"/><path style="fill:#0f766e;fill-opacity:1;stroke:#c026d3;stroke-width:0.26458332px"/></svg>`,
  'empty': ``,
};

describe.skipIf(!OLD)('the base patterns and the new ones give the same colours on ordinary text (D8, AC7)', () => {
  it('the two revisions really have different patterns (so this compares something)', () => { expect(OLD!.cssPattern).not.toBe(NOW.cssPattern); expect(OLD!.svgPattern).not.toBe(NOW.svgPattern); expect(NOW.cssPattern).toContain('{0,100}'); expect(OLD!.cssPattern).toContain('[^)]*'); });
  it.each(Object.entries(CSS))('CSS: %s', async (name, css) => {
    const a = await cssOf(OLD!, css), b = await cssOf(NOW, css);
    evidence.cssCorpus.push({ name, same: JSON.stringify(a) === JSON.stringify(b), base: a, now: b });
    expect(b).toEqual(a);
  });
  it.each(Object.entries(SVGS))('SVG: %s', async (name, svg) => {
    const a = await oldSvg(svg), b = svgColors(svg);
    evidence.svgCorpus.push({ name, same: JSON.stringify(a) === JSON.stringify(b), base: a, now: b });
    expect(b).toEqual(a);
  });
  it('the corpus is not empty-handed: most examples give at least one colour', () => {
    expect(evidence.cssCorpus.filter((r: any) => r.now.primary.length + r.now.secondary.length + r.now.any.length > 0).length).toBeGreaterThan(18);
    expect(evidence.svgCorpus.filter((r: any) => r.now.length > 0).length).toBeGreaterThan(9);
  });
  it('a stylesheet (not inline) goes through the same pattern', async () => {
    sheets['/s.css'] = CSS['bootstrap-like'];
    const $ = () => cheerio.load('<html><head><link rel="stylesheet" href="/s.css"></head></html>');
    const a = await OLD!.cssColors($(), 'https://x.example'), b = await NOW.cssColors($(), 'https://x.example');
    expect(b).toEqual(a); expect(b.primary).toContain('#0D6EFD');
  });

  // Generated text: pieces of CSS glued together at random, 4,000 strings each. Every string where the two revisions
  // differ is recorded with the smallest reason found; nothing is asserted about how many there are, only what kind.
  const rnd = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];
  it('generated CSS: where the two differ, and why', async () => {
    const r = rnd(20261114);
    const before = ['', '', ';', '{', ' ', '\n', '}', '*/', 'x', '9', '-', ')', '_', '"'], dashes = ['--', '--', '--', '--', '-', '---', ''], names = ['primary', 'brand-color', 'main', 'accent', 'secondary-bg', 'x', 'a--b', 'primary-', '_p', 'Highlight', ''], ws = ['', '', '', ' ', '\n  ', '\t', '   '], colon = [':', ':', ':', ':', '', '='];
    const values = ['#0f766e', '#C026D3', '#abc', '#12', '#c026d3cc', 'rgb(15,118,110)', 'rgba(192, 38, 211, .5)', 'rgb(245 158 11 / 50%)', 'rgb(', 'rgb()', 'rgb(1,2', 'red', 'var(--x)', '0 0% 100%', 'RGB(1,2,3)', '#0F766E!important'], after = [';', ';', '}', '', ' ', '/*c*/', ';;', ')'];
    const diffs: { css: string; base: any; now: any }[] = []; let n = 0, withColours = 0;
    for (let i = 0; i < 4000; i++) {
      const css = Array.from({ length: 1 + Math.floor(r() * 8) }, () => pick(r, before) + pick(r, dashes) + pick(r, names) + pick(r, ws) + pick(r, colon) + pick(r, ws) + pick(r, values) + pick(r, after)).join(''); n++;
      const a = await cssOf(OLD!, css), b = await cssOf(NOW, css);
      if (b.primary.length + b.secondary.length + b.any.length) withColours++;
      if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push({ css, base: a, now: b });
    }
    // Two things can make them differ, and only these two:
    //  - name start: the new pattern reads a name only from where it starts, so it no longer reads the tail of something
    //    that is not a custom property (`x--primary:#…`, `-webkit--primary:#…`);
    //  - far bracket: an `rgb(` whose closing bracket is more than 100 characters away. The base read all of it as one
    //    value (hiding every declaration in between); the new pattern skips the `rgb(` and reads what follows.
    const glued = (css: string) => /[\w-]--/.test(css), far = (css: string) => /rgba?\([^)]{101}/i.test(css);
    const kinds = { nameStart: diffs.filter(d => glued(d.css) && !far(d.css)).length, farBracket: diffs.filter(d => !glued(d.css) && far(d.css)).length, both: diffs.filter(d => glued(d.css) && far(d.css)).length, neither: diffs.filter(d => !glued(d.css) && !far(d.css)) };
    evidence.generated.css = { strings: n, withColours, different: diffs.length, kinds: { ...kinds, neither: kinds.neither.length }, examples: { nameStart: diffs.filter(d => glued(d.css) && !far(d.css)).slice(0, 4), farBracket: diffs.filter(d => !glued(d.css) && far(d.css)).slice(0, 4) } };
    expect(withColours).toBeGreaterThan(2000);
    expect(kinds.neither).toEqual([]);
  });
  it('generated SVG text: where the two differ, and why', async () => {
    const r = rnd(1114);
    const before = ['<rect ', '<path d="M0 0" ', ' ', ';', 'style="', '.a{', 'x', '-', ''], props = ['fill', 'stroke', 'stop-color', 'color', 'flood-color', 'FILL', 'fil', 'background-color'], ws = ['', '', '', ' ', '\n ', '\t'], eq = ['=', '=', ':', ':', '', ' '], quote = ['"', "'", '', ''];
    const values = ['#0f766e', '#C026D3', '#abc', '#12', '#c026d3cc', 'rgb(15,118,110)', 'rgba(192, 38, 211, .5)', 'rgb(245 158 11)', 'rgb(', 'rgb(1,2', 'red', 'none', 'url(#g)', 'RGB(1,2,3)'], after = ['"/>', "'/>", ';', '}', ' ', '"', ''];
    const diffs: any[] = []; let withColours = 0;
    for (let i = 0; i < 4000; i++) {
      const s = Array.from({ length: 1 + Math.floor(r() * 8) }, () => pick(r, before) + pick(r, props) + pick(r, ws) + pick(r, eq) + pick(r, ws) + pick(r, quote) + pick(r, values) + pick(r, after)).join('');
      const a = await oldSvg(s), b = svgColors(s);
      if (b.length) withColours++;
      if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push({ s, base: a, now: b });
    }
    // Only the far bracket can make these differ (see above); where it does, the new pattern reads colours the base hid.
    const far = (x: string) => /rgba?\([^)]{101}/i.test(x);
    evidence.generated.svg = { strings: 4000, withColours, different: diffs.length, farBracket: diffs.filter(d => far(d.s)).length, nowHasMore: diffs.filter(d => d.now.length > d.base.length).length, examples: diffs.slice(0, 4) };
    expect(withColours).toBeGreaterThan(2000);
    expect(diffs.filter(d => !far(d.s))).toEqual([]);
  });
  it('the bounds themselves: what the new patterns no longer read (recorded, each is far outside ordinary CSS)', async () => {
    const cases: Record<string, string> = {
      'a name of 128 characters': `:root{--${'p'.repeat(121)}primary:#0f766e}`,
      'a name of 129 characters': `:root{--${'p'.repeat(122)}primary:#0f766e}`,
      '64 spaces before the colon': `:root{--primary${' '.repeat(64)}:#0f766e}`,
      '65 spaces before the colon': `:root{--primary${' '.repeat(65)}:#0f766e}`,
      '64 spaces after the colon': `:root{--primary:${' '.repeat(64)}#0f766e}`,
      '65 spaces after the colon': `:root{--primary:${' '.repeat(65)}#0f766e}`,
      'rgb( ) holding 100 characters': `:root{--primary:rgb(15,118,110${' '.repeat(90)})}`,
      'rgb( ) holding 101 characters': `:root{--primary:rgb(15,118,110${' '.repeat(91)})}`,
      'a name glued to a word (x--primary)': `x--primary:#0f766e`,
      'a name after a dash (---primary at the start of a block)': `{---primary:#0f766e}`,
      'a name glued to a closing bracket': `)--primary:#0f766e`,
      'not a custom property: a colour straight after a BEM selector (.a--main:#123456)': `.a--main:#123456{}`,
      'not a custom property: -webkit--primary:#123456': `a{-webkit--primary:#123456}`,
    };
    const rows: any[] = [];
    for (const [name, css] of Object.entries(cases)) { const a = await cssOf(OLD!, css), b = await cssOf(NOW, css); rows.push({ name, base: a.primary, now: b.primary, same: JSON.stringify(a) === JSON.stringify(b) }); }
    const svgCases: Record<string, string> = { '64 spaces after fill=': `<rect fill=${' '.repeat(64)}"#0f766e"/>`, '65 spaces after fill=': `<rect fill=${' '.repeat(65)}"#0f766e"/>`, '65 spaces before =': `<rect fill${' '.repeat(65)}="#0f766e"/>`, 'rgb( ) holding 101 characters': `<rect fill="rgb(15,118,110${' '.repeat(91)})"/>`, 'rgb( ) holding 100 characters': `<rect fill="rgb(15,118,110${' '.repeat(90)})"/>` };
    for (const [name, s] of Object.entries(svgCases)) { const a = await oldSvg(s), b = svgColors(s); rows.push({ name: 'SVG: ' + name, base: a, now: b, same: JSON.stringify(a) === JSON.stringify(b) }); }
    evidence.bounds = rows;
    const lost = rows.filter(r => !r.same).map(r => r.name);
    expect(lost.sort()).toEqual(['65 spaces after the colon', '65 spaces before the colon', 'SVG: 65 spaces after fill=', 'SVG: 65 spaces before =', 'SVG: rgb( ) holding 101 characters', 'a name glued to a word (x--primary)', 'a name of 129 characters', 'rgb( ) holding 101 characters', 'not a custom property: a colour straight after a BEM selector (.a--main:#123456)', 'not a custom property: -webkit--primary:#123456'].sort());
  });
});

describe.skipIf(!OLD)('a good raster logo gives the colours the base histogram gave (AC5)', () => {
  const rasters = goodFiles().filter(g => /^(png|jpg|webp|apple|og)/.test(g.name) && !/animated|47x/.test(g.name));
  it.each(rasters.map(g => [g.name, g] as const))('%s: every colour, in order', async (name, g) => {
    const base = await OLD!.logoColors!(g.body, g.type); // the base's own function, decoding in this process (good files only)
    const now = await readLogo(g.body, g.type);
    evidence.raster.push({ name, base, now: now?.colors ?? null, kept: now ? now.type : null });
    expect(now).not.toBeNull(); expect(now!.fault).toBeUndefined();
    expect(now!.colors).toEqual(base);
  });
  it('they are not all empty', () => { expect(evidence.raster.filter((r: any) => r.now?.length).length).toBeGreaterThan(20); });
});
