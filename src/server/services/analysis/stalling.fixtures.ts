// Documents built to be expensive for an HTML or XML parse, or for the selections the crawler and brand detection run,
// and ordinary large ones beside them. Every one is under the 2 MB the crawler's fetch allows. The times are what each
// cost in this process before the page reader (macOS arm64, Node 22, cheerio 1.2.0): see pageReader.ts for why.
const wrap = (head: string, body: string) => `<!doctype html><html lang="fr"><head><title>x</title><style>:root{--brand-primary:#2563eb}</style>${head}</head><body>${body}</body></html>`;
const rep = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join('');

export const stalling = {
  /** 1.8 MB. Removing them from the text copy takes 14 s; collecting their text for colors takes longer still. */
  styleElements: (n = 100_000) => wrap('<style>a{}</style>'.repeat(n), ''),
  /** 1.5 MB. Collecting the header's images as logo candidates takes 9 s. */
  headerImages: (n = 60_000) => wrap('', `<header>${rep(n, i => `<img src="/logo${i}.png">`)}</header>`),
  /** 1.9 MB. Collecting the stylesheet addresses takes 4 s. */
  stylesheetLinks: (n = 45_000) => wrap(rep(n, i => `<link rel="stylesheet" href="/s${i}.css">`), ''),
  /** 448 KB. Every selection takes 1.4 s or more, 28 s in all, and the text and the SVG cannot be written out. */
  deepHeaderSvg: (n = 64_000) => wrap('', `<header><svg>${'<g>'.repeat(n)}<path fill="#0f766e"/>${'</g>'.repeat(n)}</svg></header>`),
  /** 320 KB. The parse alone takes 24 s. */
  nestedDivs: (n = 64_000) => wrap('', '<div>'.repeat(n)),
  /** 368 KB. The parse takes 1.2 s and the header image selection 10 s. */
  nestedDivsThenImages: (n = 16_000) => wrap('', `${'<div>'.repeat(n)}${'<img src="/p.png">'.repeat(n)}`),
  /** 1 MB. The parse is fast; every selection takes 3 s or more. */
  nestedSpans: (n = 100_000) => wrap('', rep(n, () => '<span>ab ')),
  /** 17 KB at 3,000 (8 s: the tree has 900,000 elements), 173 KB at 30,000: 90 million elements, which no heap holds.
   *  Each paragraph makes the parser rebuild every formatting element still open. */
  openFonts: (n: number) => wrap('', `<p>${rep(Math.round(n / 10), i => `<font size="${i}">`)}${'<p>x'.repeat(n)}`),
  /** A sitemap, 0.6 MB: one address under 200,000 nested elements. */
  deepSitemap: (n = 200_000) => `<urlset><url><loc>${'<a>'.repeat(n)}https://deep.example/x</loc></url></urlset>`,
  /** A sitemap, 313 KB: a <loc> inside 64,000 nested <url> elements. */
  nestedSitemap: (n = 64_000) => `<urlset>${'<url>'.repeat(n)}<loc>https://deep.example/x</loc>`,
};

export const ordinary = {
  /** 1.5 MB at 4,000. */
  blogIndex: (n = 4_000) => wrap('<link rel="icon" href="/favicon-512.png" sizes="512x512"><link rel="stylesheet" href="/site.css"><meta name="description" content="A long blog index">',
    `<header><nav><a href="/"><img src="/logo.png" alt="Acme logo"></a><a href="/blog">Blog</a></nav></header><main><h1>Blog</h1>${rep(n, i => `<article class="card"><a href="/blog/post-${i}"><img src="/img/${i}.jpg" alt="Post ${i}" loading="lazy"><h2>Post number ${i}: how to do the thing</h2></a><p class="excerpt">A short excerpt of the post that runs to a couple of lines of text so the card has something to read in it.</p><time datetime="2026-01-01">Jan 1</time><span class="tag">guides</span></article>`)}</main><footer><a href="/about">About</a></footer>`),
  /** 1.9 MB at 85,000: as many links as fit. */
  links: (n = 85_000) => wrap('', rep(n, i => `<a href="/p${i}">x</a>`)),
  /** A sitemap, 1.8 MB at 35,000 addresses: about as many as fit. */
  wideSitemap: (n = 35_000, origin = 'https://wide.example') => `<?xml version="1.0" encoding="UTF-8"?><urlset>${rep(n, i => `<url><loc>${origin}/page-${i}</loc></url>`)}</urlset>`,
  /** A small page with one of everything the reader looks for. */
  small: (name = 'Small') => `<!doctype html><html lang="en-GB"><head><title>${name}</title><meta name="description" content="${name}, described."><link rel="icon" href="/icon.svg" sizes="any"><style>:root{--brand:#2563eb}</style><meta name="theme-color" content="#0f766e"></head><body><header><svg viewBox="0 0 1 1"><path fill="#f59e0b"/></svg></header><main><h1>${name}</h1><p>Some text.</p><a href="/next">next</a></main></body></html>`,
};
