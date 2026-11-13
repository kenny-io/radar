// Realistic home pages and what their sites serve, run through detectBrand on the revision under test and on the base
// (same inputs), so every difference in behaviour shows. Everything here is safe to hand to the base: good files, and
// damaged ones only where base-loadimage.mjs showed the base's decoder survives them.
import { badFiles, good, mislabelled, goodFiles, SVG_PLAIN } from './fixtures';
type Served = { type: string; body: Buffer | string };
export interface Scenario { name: string; html: string; files: Record<string, Served>; /** Not run on the base: its decoder ends the process on this input. */ unsafeOnBase?: boolean }

const css = (vars: string) => `<style>:root{${vars}}</style>`;
const doc = (head: string, body = '<main><h1>Acme</h1></main>', lang = 'en-GB') => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Acme</title>${head}</head><body>${body}</body></html>`;
const png = (name: string): Served => ({ type: 'image/png', body: good(name) });
const HEADER_SVG = `<svg class="mark" viewBox="0 0 120 32" width="120" height="32"><path d="M0 0h120v32H0z" fill="#7C3AED"/><circle cx="16" cy="16" r="10" fill="#7c3aed"/><path d="M40 8h60" stroke="#F59E0B"/></svg>`;
const SITE_CSS = `/*! site.css */\n:root{\n  --color-primary: #0f766e;\n  --color-primary-foreground:#ffffff;\n  --color-accent : rgb(192 38 211);\n  --color-bg:#FAFAF9;\n  --radius: 8px;\n  --shadow: 0 1px 2px rgba(0,0,0,.2);\n}\nbody{font-family:system-ui;color:#111}\n.btn--primary{background:var(--color-primary)}\n@media (prefers-color-scheme: dark){:root{--color-bg:#0c0a09}}\n`;

export function scenarios(): Scenario[] {
  const out: Scenario[] = [];
  const BAD = badFiles();
  // ── Ordinary sites
  out.push({ name: 'site: icon links with sizes (32, 192, 512), apple-touch-icon, stylesheet', html: doc(`<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png"><link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"><link rel="stylesheet" href="/assets/site.css"><meta name="theme-color" content="#0f766e">`), files: { '/favicon-32.png': png('png-47x47.png'), '/icon-192.png': png('apple-180.png'), '/icon-512.png': png('png-512.png'), '/apple-touch-icon.png': png('apple-180.png'), '/assets/site.css': { type: 'text/css', body: SITE_CSS } } });
  out.push({ name: 'site: favicon.ico (sizes=any) first, apple-touch-icon PNG second', html: doc(`<link rel="icon" href="/favicon.ico" sizes="any"><link rel="apple-touch-icon" href="/apple-touch-icon.png">${css('--brand:#0f766e')}`), files: { '/favicon.ico': { type: 'image/x-icon', body: good('ico-multi.ico') }, '/apple-touch-icon.png': png('apple-180.png') } });
  out.push({ name: 'site: favicon.ico (sizes=any, vnd.microsoft.icon) only', html: doc(`<link rel="icon" href="/favicon.ico" sizes="any">`), files: { '/favicon.ico': { type: 'image/vnd.microsoft.icon', body: good('ico-multi.ico') } } });
  out.push({ name: 'site: small favicon only (32 px link), header image logo (JPEG)', html: doc(`<link rel="icon" sizes="32x32" href="/favicon.png">`, `<header><a class="site-logo" href="/"><img src="/img/logo.jpg" alt="Acme" width="256" height="128"></a><nav><a href="/about">About</a></nav></header><main><img src="/img/hero.png" alt="Team"></main>`), files: { '/favicon.png': png('png-47x47.png'), '/img/logo.jpg': { type: 'image/jpeg', body: good('jpg-baseline.jpg') }, '/img/hero.png': png('og-1200x630.png') } });
  out.push({ name: 'site: no icons, share image only (WebP)', html: doc(`<meta property="og:image" content="https://logo-qa.example/share.webp">${css('--accent:#C026D3')}`), files: { '/share.webp': { type: 'image/webp', body: good('webp-lossy.webp') } } });
  out.push({ name: 'site: share image only (PNG 1200x630), no CSS colours', html: doc(`<meta property="og:image" content="/og.png">`), files: { '/og.png': png('og-1200x630.png') } });
  out.push({ name: 'site: SVG icon link (type attribute), PNG apple icon after it', html: doc(`<link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="apple-touch-icon" href="/apple.png">`), files: { '/favicon.svg': { type: 'image/svg+xml', body: SVG_PLAIN }, '/apple.png': png('apple-180.png') } });
  out.push({ name: 'site: SVG logo image in the header', html: doc('', `<header><img class="logo" src="/logo.svg" alt="Acme logo"></header>`), files: { '/logo.svg': { type: 'image/svg+xml; charset=utf-8', body: SVG_PLAIN } } });
  out.push({ name: 'site: inline SVG in the header, no other candidate', html: doc(css('--muted:#6b7280'), `<header><a href="/">${HEADER_SVG}</a></header>`), files: {} });
  out.push({ name: 'site: inline SVG in the header, and an apple icon that is missing (404)', html: doc(`<link rel="apple-touch-icon" href="/gone.png">`, `<header><a href="/">${HEADER_SVG}</a></header>`), files: {} });
  out.push({ name: 'site: nothing at all', html: doc(''), files: {} });
  out.push({ name: 'site: GIF logo in the header, inline SVG as well', html: doc('', `<header><img src="/logo.gif" alt="logo">${HEADER_SVG}</header>`), files: { '/logo.gif': { type: 'image/gif', body: good('gif-still.gif') } } });
  out.push({ name: 'site: apple-touch-icon-precomposed and a logo class', html: doc(`<link rel="apple-touch-icon-precomposed" href="/pre.png">`, `<div class="navbar-logo"><img src="/brand.webp"></div>`), files: { '/pre.png': png('png-rgb.png'), '/brand.webp': { type: 'image/webp', body: good('webp-lossless-alpha.webp') } } });
  out.push({ name: 'site: first candidate under 48 px, second good', html: doc(`<link rel="apple-touch-icon" href="/tiny.png"><link rel="apple-touch-icon" href="/ok.png">`), files: { '/tiny.png': png('png-47x47.png'), '/ok.png': png('png-rgba.png') } });
  out.push({ name: 'site: seven candidates, only the seventh is good', html: doc([1, 2, 3, 4, 5, 6].map(i => `<link rel="apple-touch-icon" href="/tiny${i}.png">`).join('') + `<link rel="apple-touch-icon" href="/ok.png">`), files: { ...Object.fromEntries([1, 2, 3, 4, 5, 6].map(i => [`/tiny${i}.png`, png('png-47x47.png')])), '/ok.png': png('png-rgba.png') } });
  // ── Every good file, alone
  for (const g of goodFiles()) out.push({ name: `only candidate: ${g.name} as ${g.type}`, html: doc(`<link rel="apple-touch-icon" href="/logo">`), files: { '/logo': { type: g.type, body: g.body } }, unsafeOnBase: g.name.startsWith('tiff') });
  // ── Good files under another type's header
  for (const [n, m] of Object.entries(mislabelled())) out.push({ name: `mislabelled: ${n} (${m.type || 'no type'})`, html: doc(`<link rel="apple-touch-icon" href="/logo">`), files: { '/logo': { type: m.type, body: m.body } } });
  // ── Damaged or odd files the base's decoder survives (so both can be run)
  for (const n of ['png-cut-50pct', 'png-cut-last-1', 'png-trailing-bytes', 'png-cut-then-iend', 'polyglot-whole-png-then-html', 'jpg-cut-50pct', 'jpg-cut-no-end-marker', 'webp-lossy-cut-50pct', 'webp-animated', 'png-apng-two-frames', 'png-idat-noise', 'png-idat-empty', 'webp-lossy-header-then-noise', 'jpg-exif-rotated-48x100', 'jpg-exif-rotated-47x100', 'polyglot-svg-as-png', 'polyglot-svg-as-jpeg', 'polyglot-whole-png-as-svg', 'polyglot-jpeg-as-svg', 'polyglot-html-as-svg', 'polyglot-html-as-png', 'polyglot-whole-png-with-svg-in-text-chunk', 'png-declares-47x47-over-256x128-data', 'jpg-declares-64x64-over-256x128-data'])
    out.push({ name: `damaged or odd: ${n} as ${BAD[n].type}`, html: doc(`<link rel="apple-touch-icon" href="/logo">`), files: { '/logo': { type: BAD[n].type, body: BAD[n].body } } });
  // ── SVG logos
  const svgs: Record<string, [string, string | Buffer]> = {
    'plain': ['image/svg+xml', SVG_PLAIN],
    'XML declaration and doctype': ['image/svg+xml', `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n${SVG_PLAIN}`],
    'byte order mark and blank lines': ['image/svg+xml', '﻿\n\n  ' + SVG_PLAIN],
    'generator comment of 300 bytes first': ['image/svg+xml', `<!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  ${'-'.repeat(0)}${'x'.repeat(200)} -->\n${SVG_PLAIN}`],
    'comment of 9 KB first': ['image/svg+xml', `<!-- ${'licence text '.repeat(700)} -->\n${SVG_PLAIN}`],
    'doctype with an internal subset of 9 KB first': ['image/svg+xml', `<?xml version="1.0"?>\n<!DOCTYPE svg [\n${Array.from({ length: 150 }, (_, i) => `<!ENTITY ns_${i} "http://ns.adobe.com/Extensibility/${i}/padding-padding/">`).join('\n')}\n]>\n${SVG_PLAIN}`],
    'upper-case element name': ['image/svg+xml', SVG_PLAIN.replace('<svg', '<SVG').replace('</svg>', '</SVG>')],
    'prefixed element name (svg:svg)': ['image/svg+xml', `<svg:svg xmlns:svg="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><svg:rect width="10" height="10" fill="#0F766E"/></svg:svg>`],
    'header in capitals (image/SVG+XML)': ['image/SVG+XML', SVG_PLAIN],
    'colours in a style element and style attributes': ['image/svg+xml', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>.a{fill:#0f766e;stroke:rgba(192,38,211,.9)}.b { fill : #0F766E }</style><rect class="a" width="10" height="10"/><rect style="fill: rgb(15 118 110); stroke:#c026d3" width="5" height="5"/><linearGradient><stop stop-color="#0f766e"/><stop stop-color='#C026D3'/></linearGradient></svg>`],
    'only neutral colours': ['image/svg+xml', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#111111"/><path fill="#fff" d="M0 0h1"/><path fill="currentColor" d="M0 0h1"/></svg>`],
    'short hex, 8-digit hex, named colours': ['image/svg+xml', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect fill="#0a8" width="1" height="1"/><rect fill="#0A8" width="1" height="1"/><rect fill="#C026D380" width="1" height="1"/><rect fill="red" width="1" height="1"/><rect fill="none" stroke="#c026d3ff"/></svg>`],
    'UTF-16 text': ['image/svg+xml', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(SVG_PLAIN, 'utf16le')])],
    'gzip-compressed (svgz bytes, no content-encoding)': ['image/svg+xml', Buffer.from('1f8b0800000000000003', 'hex')],
    'HTML page that contains an inline svg, under the SVG header': ['image/svg+xml', `<!doctype html><html><body><h1>Sign in</h1><svg viewBox="0 0 1 1"><rect fill="#0F766E"/></svg><form action="/login"></form>${'<p>padding</p>'.repeat(10)}</body></html>`],
    'script and foreign content inside': ['image/svg+xml', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="x()"><script>alert(1)</script><foreignObject><iframe xmlns="http://www.w3.org/1999/xhtml" src="https://elsewhere.example/"/></foreignObject><rect fill="#0F766E" width="10" height="10"/><image href="file:///etc/hosts"/></svg>`],
  };
  for (const [n, [type, body]] of Object.entries(svgs)) out.push({ name: `SVG logo: ${n}`, html: doc(`<link rel="apple-touch-icon" href="/logo.svg">`), files: { '/logo.svg': { type, body: Buffer.isBuffer(body) && body.length < 80 ? Buffer.concat([body, Buffer.alloc(90)]) : body } } });
  // ── Where colours come from
  out.push({ name: 'colours: stylesheet only, no logo', html: doc(`<link rel="stylesheet" href="/assets/site.css">`), files: { '/assets/site.css': { type: 'text/css', body: SITE_CSS } } });
  out.push({ name: 'colours: theme-color only', html: doc(`<meta name="theme-color" content="#C026D3">`), files: {} });
  out.push({ name: 'colours: logo pixels only (PNG)', html: doc(`<link rel="apple-touch-icon" href="/l.png">`), files: { '/l.png': png('png-rgba.png') } });
  out.push({ name: 'colours: primary from CSS, secondary from the logo', html: doc(`<link rel="apple-touch-icon" href="/l.png">${css('--primary:#DC2626')}`), files: { '/l.png': png('png-rgba.png') } });
  out.push({ name: 'colours: grey logo, colours from CSS', html: doc(`<link rel="apple-touch-icon" href="/l.png">${css('--brand:#DC2626;--accent:#16A34A')}`), files: { '/l.png': png('png-gray.png') } });
  out.push({ name: 'colours: four stylesheets (only three are read), one on another origin', html: doc(`<link rel="stylesheet" href="https://cdn.elsewhere.example/x.css"><link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/b.css"><link rel="stylesheet" href="/c.css">`), files: { '/a.css': { type: 'text/css', body: ':root{--x:#333}' }, '/b.css': { type: 'text/css', body: ':root{--secondary-color:#16A34A}' }, '/c.css': { type: 'text/css', body: ':root{--main-color:#DC2626}' } } });
  return out;
}
