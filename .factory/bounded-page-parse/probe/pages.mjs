// Pages for the probes: built to be expensive for an HTML parse or for the selections the crawler and brand detection
// run, plus two ordinary large pages. Every page is under the 2 MB the crawler's fetch allows.
const wrap = (head, body) => `<!doctype html><html lang="fr"><head><title>x</title><style>:root{--brand-primary:#2563eb}</style>${head}</head><body>${body}</body></html>`;
const rep = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');
export const pages = {
  // QA's rows from .factory/safe-logo-decode/qa.md
  'style elements': n => wrap('<style>a{}</style>'.repeat(n), ''),
  'images in a header': n => wrap('', `<header>${rep(n, i => `<img src="/logo${i}.png">`)}</header>`),
  'header svg nested deep': n => wrap('', `<header><svg>${'<g>'.repeat(n)}<path fill="#0f766e"/>${'</g>'.repeat(n)}</svg></header>`),
  'nested divs then images': n => wrap('', `${'<div>'.repeat(n)}${'<img src="/p.png">'.repeat(n)}`),
  'nested divs': n => wrap('', '<div>'.repeat(n)),
  'stylesheet links': n => wrap(rep(n, i => `<link rel="stylesheet" href="/s${i}.css">`), ''),
  // not in QA's list
  'links': n => wrap('', rep(n, i => `<a href="/p${i}">x</a>`)),
  'a long class on an ancestor of n images': n => wrap('', `<div class="${'a'.repeat(1_000_000)}">${'<img>'.repeat(n)}</div>`),
  'k open font elements, then n paragraphs (each paragraph rebuilds the k fonts)': n => wrap('', `<p>${rep(Math.round(n / 10), i => `<font size="${i}">`)}${'<p>x'.repeat(n)}`),
  'nested divs then time elements': n => wrap('', `${'<div>'.repeat(n)}${'<time datetime="1">'.repeat(n)}`),
  'nested spans with text between': n => wrap('', rep(n, () => '<span>ab ')),
  // ordinary large pages
  'ordinary: blog index of n cards': n => wrap('<link rel="icon" href="/favicon-512.png" sizes="512x512"><link rel="stylesheet" href="/site.css"><meta name="description" content="A long blog index">',
    `<header><nav><a href="/"><img src="/logo.png" alt="Acme logo"></a><a href="/blog">Blog</a></nav></header><main><h1>Blog</h1>${rep(n, i => `<article class="card"><a href="/blog/post-${i}"><img src="/img/${i}.jpg" alt="Post ${i}" loading="lazy"><h2>Post number ${i}: how to do the thing</h2></a><p class="excerpt">A short excerpt of the post that runs to a couple of lines of text so the card has something to read in it.</p><time datetime="2026-01-01">Jan 1</time><span class="tag">guides</span></article>`)}</main><footer><a href="/about">About</a></footer>`),
  'ordinary: shop home page of n products': n => wrap('<link rel="apple-touch-icon" href="/apple.png"><meta property="og:image" content="/og.png"><meta name="theme-color" content="#0f766e">',
    `<header class="site-header"><div class="logo"><svg viewBox="0 0 10 10"><path fill="#0f766e" d="M0 0h10v10z"/></svg></div><nav>${rep(60, i => `<ul class="menu"><li><a href="/c/${i}">Category ${i}</a><ul>${rep(12, j => `<li><a href="/c/${i}/${j}">Sub ${j}</a></li>`)}</ul></li></ul>`)}</nav></header><main>${rep(n, i => `<div class="product-card" data-id="${i}"><div class="media"><picture><source srcset="/p/${i}.webp 400w, /p/${i}@2x.webp 800w" type="image/webp"><img src="/p/${i}.jpg" alt="Product ${i}" width="400" height="400"></picture></div><div class="info"><a class="title" href="/products/item-${i}">Product ${i} with a longer name</a><div class="price"><span class="was">$29.00</span><span class="now">$19.00</span></div><div class="rating"><span>★</span><span>★</span><span>★</span><span>★</span><span>☆</span></div><button type="button" class="add">Add to cart</button></div></div>`)}</main><footer>${rep(40, i => `<a href="/f/${i}">Footer ${i}</a>`)}</footer>`),
};
