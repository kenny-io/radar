// Home pages built to be expensive for what detectBrand does with the page itself (not with a logo or stylesheet):
// many candidates, long attributes, deep nesting. All fit in the 2 MB the crawler's fetch allows. Each is a ladder of
// growing sizes so the cost can be seen without waiting on the largest when a smaller one is already slow.
// Run by structures-run.ts, each step in its own process with a time limit.
export interface Structure { name: string; sizes: number[]; html: (n: number) => string }
const wrap = (head: string, body: string) => `<!doctype html><html lang="fr"><head><title>x</title><style>:root{--brand-primary:#2563eb}</style>${head}</head><body>${body}</body></html>`;
export const structures: Structure[] = [
  { name: 'icon links with sizes', sizes: [5_000, 35_000], html: n => wrap(Array.from({ length: n }, (_, i) => `<link rel="icon" sizes="512x512" href="/i${i}.png">`).join(''), '') },
  { name: 'one icon link whose sizes attribute has n entries', sizes: [50_000, 450_000], html: n => wrap(`<link rel="icon" sizes="${'9x9 '.repeat(n)}" href="/i.png">`, '') },
  { name: 'apple-touch-icon links', sizes: [5_000, 40_000], html: n => wrap(Array.from({ length: n }, (_, i) => `<link rel="apple-touch-icon" href="/a${i}">`).join(''), '') },
  { name: 'images in a header', sizes: [5_000, 60_000], html: n => wrap('', `<header>${Array.from({ length: n }, (_, i) => `<img src="/logo${i}.png">`).join('')}</header>`) },
  { name: 'style elements', sizes: [5_000, 100_000], html: n => wrap('<style>a{}</style>'.repeat(n), '') },
  { name: 'stylesheet links', sizes: [5_000, 45_000], html: n => wrap(Array.from({ length: n }, (_, i) => `<link rel="stylesheet" href="/s${i}.css">`).join(''), '') },
  { name: 'a lang attribute of n dashes', sizes: [100_000, 1_900_000], html: n => `<!doctype html><html lang="${'-'.repeat(n)}"><head><style>:root{--brand-primary:#2563eb}</style></head><body></body></html>` },
  { name: 'a theme-color of n characters', sizes: [100_000, 1_900_000], html: n => wrap(`<meta name="theme-color" content="#${'a'.repeat(n)}">`, '') },
  { name: 'an inline header SVG of n paths', sizes: [1_000, 60_000], html: n => wrap('', `<header><svg viewBox="0 0 1 1">${'<path d="M0 0h1" fill="#123"/>'.repeat(n)}</svg></header>`) },
  { name: 'a header SVG nested n deep', sizes: [1_000, 4_000, 16_000, 64_000, 200_000], html: n => wrap('', `<header><svg>${'<g>'.repeat(n)}<path fill="#0f766e"/>${'</g>'.repeat(n)}</svg></header>`) },
  { name: 'n nested divs, then one logo image', sizes: [1_000, 4_000, 16_000, 64_000, 300_000], html: n => wrap('', `${'<div>'.repeat(n)}<img src="/logo.png" alt="logo">`) },
  { name: 'n nested headers, then one image', sizes: [1_000, 4_000, 16_000, 64_000, 200_000], html: n => wrap('', `${'<header>'.repeat(n)}<img src="/x.png">`) },
  { name: 'n nested divs, then n images (each image is checked against every ancestor)', sizes: [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 120_000], html: n => wrap('', `${'<div>'.repeat(n)}${'<img src="/p.png">'.repeat(n)}`) },
  { name: 'n nested divs with a logo class, then n svg elements', sizes: [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000], html: n => wrap('', `${'<div class="x">'.repeat(n)}${'<svg></svg>'.repeat(n)}`) },
  { name: 'n nested spans, then n links to stylesheets', sizes: [1_000, 4_000, 16_000, 60_000], html: n => wrap('', `${'<span>'.repeat(n)}${'<link rel="stylesheet" href="/s.css">'.repeat(n)}`) },
];
