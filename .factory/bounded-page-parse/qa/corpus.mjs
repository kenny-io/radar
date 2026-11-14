// QA's own ordinary corpus for "same results as the base" (AC7): written here, not taken from the engineer's fixtures.
// Sites are tables of paths (body may be a string or a Buffer); home pages are for detectBrand.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const HTML = 'text/html; charset=utf-8';
const page = body => ({ type: HTML, body });
const xml = body => ({ type: 'application/xml', body });
const rep = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');
const doc = (head, body, attrs = ' lang="en"') => `<!doctype html><html${attrs}><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
const words = (n, w = 'word') => Array.from({ length: n }, (_, i) => w + i).join(' ');

// --- a long blog index and a large shop home page -----------------------------------------------------------------------
export const blog = n => doc('<title>Journal — Harbour &amp; Co.</title><meta name="description" content="Notes from the workshop."><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="icon" sizes="192x192" href="/icon-192.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="stylesheet" href="/css/main.css?v=3"><link rel="stylesheet" href="https://fonts.example/css2?family=Inter"><meta property="og:image" content="https://site.example/og/journal.jpg"><meta name="theme-color" content="#0B5FFF"><style>:root{--brand-primary:#0b5fff;--color-accent: #FF6B00; --bg:#fff}</style>',
  `<a class="skip" href="#main">Skip</a><header class="site-header"><a href="/" class="site-logo"><img src="/img/harbour-logo.svg" alt="Harbour &amp; Co. logo" width="120"></a><nav><ul><li><a href="/journal/">Journal</a><li><a href="/shop/">Shop</a><li><a href="/about">About</a><li><a href="https://twitter.example/harbour">Twitter</a></ul></nav><form action="/search"><input name="q"><a href="/search/advanced">Advanced</a></form></header>
<main id="main"><h1>Journal</h1>\r\n${rep(n, i => `<article class="post-card"><a href="/journal/${2020 + (i % 6)}/post-${i}/"><img loading="lazy" src="/media/${i}.webp" alt="Cover ${i}"><h2>How we built thing №${i} — notes &amp; lessons</h2></a><p>Excerpt ${i}: ${words(18, 'w' + i + '-')}.</p><time datetime="2026-${String(1 + i % 12).padStart(2, '0')}-0${1 + i % 9}">Published</time> <a href="/journal/tag/${['tools', 'wood', 'metal'][i % 3]}/" rel="tag">${['tools', 'wood', 'metal'][i % 3]}</a> <a href="/journal/author/${['ann', 'bo'][i % 2]}">by</a></article>\n`)}<a href="/journal/page/2/">Older</a></main>
<footer><a href="/privacy">Privacy</a> <a href="mailto:hi@site.example">Mail</a> <a href="/sitemap.xml">Sitemap</a><p>© Harbour &amp; Co.</p></footer><script>window.dataLayer=[];</script>`);
export const shop = n => doc('<title>Northwind Outfitters | Gear for the long way round</title><meta property="og:description" content="Outdoor gear, repaired for life."><meta property="og:type" content="website"><link rel="shortcut icon" href="/favicon.ico"><link rel="icon" type="image/svg+xml" href="/icon.svg"><link rel="apple-touch-icon-precomposed" href="/touch.png"><link rel="stylesheet" href="/assets/theme.css"><link rel="stylesheet" href="/assets/print.css" media="print"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Store","name":"Northwind"}</script>',
  `<div class="announcement">Free shipping over €50</div><header><div class="header__logo"><svg viewBox="0 0 40 40" role="img" aria-label="Northwind"><circle cx="20" cy="20" r="18" fill="#1F7A4D"/><path d="M10 28 L20 8 L30 28 Z" fill="#F2C14E"/></svg></div><nav aria-label="Main">${rep(12, i => `<a href="/collections/c${i}">Collection ${i}</a>`)}</nav></header>
<main><h1>Gear for the\n\t long way <em>round</em></h1><section class="grid">${rep(n, i => `<div class="product-card" data-id="${i}"><a href="/products/item-${i}?variant=${i * 7}#reviews"><img src="//cdn.site.example/p/${i}.jpg" alt="Item ${i}" srcset="//cdn.site.example/p/${i}@2x.jpg 2x"></a><h3><a href="/products/item-${i}">Item ${i} · ${['Jacket', 'Boots', 'Tent', 'Stove'][i % 4]}</a></h3><span class="price">€${(i * 3.7 % 400).toFixed(2)}</span><button type="button">Add</button></div>`)}</section></main>
<footer><nav>${rep(20, i => `<a href="/pages/f${i}">Footer ${i}</a>`)}</nav><a href="tel:+3112345678">Call</a><a href="javascript:void(0)">Top</a></footer><noscript><img src="/px.gif"></noscript><iframe src="/chat"></iframe>`, ' lang="nl-NL" class="no-js"');

// --- pages in other languages and scripts ----------------------------------------------------------------------------------
const LANGS = {
  '/ja': doc('<title>木工房ハーバー｜手仕事の家具と道具</title><meta name="description" content="職人が一つひとつ仕上げる家具。修理も承ります。">', `<header><img src="/ロゴ.png" alt="ロゴ"></header><main><h1>手仕事の　家具</h1><p>${'木の香りがする工房で、毎日少しずつ作っています。'.repeat(120)}</p><a href="/ブログ/記事-1">記事</a><a href="/blog/日本語の記事/">ブログ</a></main>`, ' lang="ja"'),
  '/ar': doc('<title>ورشة الميناء — أثاث مصنوع يدوياً</title><meta name="description" content="أثاث يدوي الصنع وإصلاح مدى الحياة.">', `<main dir="rtl"><h1>أثاث\u200f مصنوع يدوياً</h1><p>${'نصنع كل قطعة بعناية في ورشتنا الصغيرة. '.repeat(150)}</p><a href="/مدونة/مقال">مقال</a><a href="/ar/contact?x=١">اتصل</a></main>`, ' lang="ar" dir="rtl"'),
  '/ru': doc('<title>Мастерская «Гавань» — мебель ручной работы</title>', `<main><h1>Мебель ручной работы</h1><p>${'Мы делаем каждую вещь вручную, не торопясь. '.repeat(200)}</p><a href="/блог/первая-запись/">Блог</a></main>`, ' lang="ru-RU"'),
  '/hi': doc('<title>हार्बर कार्यशाला — हाथ से बना फ़र्नीचर</title>', `<article><h1>हाथ से बना फ़र्नीचर</h1><time datetime="2026-03-01">१ मार्च</time><p>${'हम हर चीज़ हाथ से बनाते हैं। '.repeat(180)}</p></article>`, ' lang="hi"'),
  '/el': doc('<title>Εργαστήρι Λιμάνι</title><meta name="description" content="Χειροποίητα έπιπλα.">', `<main><h1>Χειροποίητα έπιπλα</h1><p>${'Φτιάχνουμε κάθε κομμάτι με το χέρι. '.repeat(100)}</p></main>`, ' lang="el"'),
  '/zh': doc('<title>港湾木作 · 手工家具</title>', `<main><h1>手工家具</h1><p>${'我们在小作坊里慢慢地做每一件家具。'.repeat(300)}</p><a href="/博客/文章">文章</a></main>`, ' lang="zh-Hans-CN"'),
  '/emoji': doc('<title>🪵 Harbour 🛠️ — made by hand 👋🏽</title><meta name="description" content="👩🏽‍🔧 family‍ 👨‍👩‍👧‍👦 flags 🇳🇱🇯🇵">', `<main><h1>👋🏽 Hello 🇳🇱</h1><p>${'🪵🛠️👩🏽‍🔧 '.repeat(400)}</p></main>`),
  // The 4,000-character cut of the text, and the 300 and 500 cuts of title and description, fall inside a surrogate pair.
  '/cut-astral': doc(`<title>${'t'.repeat(299)}😀 tail</title><meta name="description" content="${'d'.repeat(499)}🎉 tail">`, `<main><h1>${'h'.repeat(299)}𝔘𝔫𝔦</h1><p>${'x'.repeat(3989)}😀😀😀 after the cut</p></main>`),
  '/mixed-bidi': doc('<title>Mixed עברית and English ‮reversed‬</title>', '<main><h1>שלום world &#x202E;abc&#x202C; ‎‏</h1><p>zero\u200bwidth\u200cjoiner\u200d soft\u00adhyphen nbsp\u00a0here ideographic\u3000space line\u2028sep para\u2029sep bom\ufeffinside</p></main>'),
};

// --- odd but legal markup -----------------------------------------------------------------------------------------------------
const ODD = {
  '/unclosed': page('<!DOCTYPE html><html lang=en><head><title>Unclosed<body><h1>Heading<p>One<p>Two<ul><li>a<li>b<li><a href=/unclosed/a>c</ul><table><tr><td>cell<td><a href="/unclosed/b">d<tr><td>x</table><p>after<a href=/unclosed/c>never closed'),
  '/uppercase': page('<!DOCTYPE HTML><HTML LANG="EN-gb"><HEAD><TITLE>UPPER &AMP; lower</TITLE><META NAME="DESCRIPTION" CONTENT="Upper Case Attributes"><META PROPERTY="OG:TYPE" CONTENT="ARTICLE"></HEAD><BODY><MAIN><H1>UPPER</H1><A HREF="/Upper/Path">x</A><A href="/upper/path">y</A><ARTICLE><TIME DATETIME="2026">t</TIME></ARTICLE></MAIN><FOOTER><A HREF="/footer-upper">f</A></FOOTER></BODY></HTML>'),
  '/entities-in-attributes': page(doc('<title>Entities &mdash; &#8220;quoted&#8221; &copy; &notin; &amp;amp; &unknown; &#xD800; &#0; &#x10FFFF; &#1114112;</title><meta name="description" content="A &amp; B &lt; C &quot;D&quot; &apos;E&apos; &nbsp;F&nbsp; &copy 2026 &not; &notit; &para=1">', '<h1>R&amp;D &lt;script&gt; &#x1F600; &NotEqualTilde; &fjlig;</h1><a href="/q?a=1&amp;b=2&copy=3&lang=en&notit;=1">amp</a><a href="/p&#97;th/&#x2F;x">numeric</a><a href="/sp&#32;ace">space</a><a href="/&eacute;t&eacute;">été</a><a href="&#x2F;&#x2F;site.example/from-entity-slashes">slashes</a><a href="/tab&Tab;x">tab</a><a href="/nl&NewLine;x">newline</a>')),
  '/base': page(doc('<title>Base</title><base href="/elsewhere/dir/"><base href="https://other.example/">', '<h1>Base</h1><a href="rel-under-base">a</a><a href="/abs-under-base">b</a><a href="../up-under-base">c</a><a href="//www.site.example/proto-rel">d</a><a href="//SITE.example:443/default-port">e</a><a href="https://site.example:444/other-port">f</a><a href="http://site.example:80/http-default-port">g</a>')),
  '/links/deep/page': page(doc('<title>Links</title>', '<h1>Links</h1>' + ['x', './y', '../z', '../../w', '../../../too-far', '/', '', '#', '?a', '//site.example', '//site.example/', '///triple', '\\\\backslash\\path', '/a\\b', 'http:/one-slash', 'http:relative-with-scheme', 'https:///three', 'HTTP://Site.Example/UP', ' https://site.example/padded ', '\thttps://site.example/tabbed\n', 'https://site.example/a b', 'https://site.example/%zz', 'https://site.example/%2e%2e/dots', 'https://site.example/a/./b/../c', 'https://site.example/semi;colon', 'https://xn--mnchen-3ya.example/', 'https://münchen.site.example/', 'https://site.example/ünï', 'https://www.site.example/', 'https://www.site.example', 'ws://site.example/ws', 'blob:https://site.example/x', 'about:blank', 'sms:1', 'HTTPS://site.example/file.PDF', '/archive.tar.gz', '/data.JSON', '/script.js?v=1', '/style.css#x', '/img.jpeg/', '/x.xml', '/x.xmlx', '/.txt', '/a.b.c.txt', '/feed', '/feed.rss', '/feed.atom', '/page.aspx', '/page.html#s', '/trail/', '/trail//', '/trail/?', '/trail/#'].map(h => `<a href="${h.replace(/"/g, '&quot;')}">l</a>`).join('') + '<a href=noquotes/x>n</a><a href=\'single/q\'>s</a><a HREF=/caps-attr>c</a><a href="/dup">1</a><a href="/dup/">2</a><a href="/dup#x">3</a><a href="/dup?y">4</a><link rel="canonical" href="/canonical-not-a-link"><area href="/area"><form action="/form-action"></form><a href="/in-nav-outside"><nav><a href="/in-nav">n</a></nav><template><a href="/in-template">t</a></template><noscript><a href="/in-noscript">ns</a></noscript><!-- <a href="/in-comment">c</a> --><script>document.write(\'<a href="/in-script">s</a>\')</script><textarea><a href="/in-textarea">t</a></textarea><svg><a href="/in-svg">v</a></svg><math><a href="/in-math">m</a></math><iframe><a href="/in-iframe">i</a></iframe><select><option><a href="/in-select">o</a></select><table><a href="/foster-parented">f</a><tr><td><a href="/in-cell">c</a></table><button><a href="/in-button">b</a></button><a href="/outer"><a href="/nested-anchor">n</a></a>')),
  '/bom': { type: HTML, body: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(doc('<title>With a BOM</title>', '<h1>BOM</h1><a href="/bom/next">n</a>'))]) },
  '/crlf': page(doc('<title>\r\n  CRLF\r\n  title\r\n</title><meta name="description" content="line one\r\nline two">', '<h1>\r\nCR\rLF\r\n</h1>\r\n<main>\r\n<p>one\r\ntwo\rthree\nfour</p>\r\n<pre>\r\n  kept?\r\n</pre>\r\n<a href="/crlf/\r\nnext">n</a>\r\n</main>\r\n')),
  '/latin1': { type: 'text/html; charset=iso-8859-1', body: Buffer.concat([Buffer.from('<!doctype html><html><head><title>Caf'), Buffer.from([0xe9]), Buffer.from(' na'), Buffer.from([0xef]), Buffer.from('ve</title></head><body><h1>D'), Buffer.from([0xe9, 0x6a, 0xe0]), Buffer.from('</h1><a href="/caf'), Buffer.from([0xe9]), Buffer.from('">x</a></body></html>')]) },
  '/utf16': { type: 'text/html; charset=utf-16', body: Buffer.from('\ufeff<!doctype html><html><head><title>UTF-16</title></head><body><h1>Sixteen</h1></body></html>', 'utf16le') },
  '/nulls': page(doc('<title>Nu\u0000ll</title>', '<h1>A\u0000B</h1><p>text\u0000with\u0000nulls</p><a href="/nu\u0000ll">n</a><svg>\u0000</svg>')),
  '/quirks': page('<title>No doctype</title><p>Quirks mode<table><p>Para in table</table><a href="/quirks/a">a</a>'),
  '/xhtml': { type: 'application/xhtml+xml', body: '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd"><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="de" lang="de"><head><title>XHTML Seite</title><meta name="description" content="Selbstschließend" /></head><body><h1>XHTML<br />Seite</h1><div /><p>Nach dem leeren div</p><a href="/xhtml/a" /><a href="/xhtml/b">b</a><![CDATA[ <a href="/in-cdata">c</a> ]]></body></html>' },
  '/text-places': page(doc('<title>Where text is taken from</title>', '<header><form>form text in header</form>header text</header><nav>nav text</nav><div>before main</div><main>main one <script>var s = "script text";</script><style>.c{}</style><noscript>noscript text</noscript><svg><text>svg text</text></svg><iframe>iframe text</iframe><footer>footer in main</footer><template>template text</template><textarea>textarea text</textarea><select><option>option text</select><!-- comment text --><details><summary>summary</summary>details</details><pre>  pre   formatted  </pre><br>after br<wbr>wbr<img alt="alt text" src="/a.png"><input value="input value"><button>button text</button></main><main>main two</main><footer>footer text</footer>')),
  '/no-main': page(doc('<title>No main</title>', `<nav>nav</nav><div><h1>No\u00a0main&nbsp;here</h1>${words(700)}</div><footer>foot</footer>`)),
  '/empty-main': page(doc('<title>Empty main</title>', '<main>   </main><p>body text is used when main has only spaces? or not</p>')),
  '/main-only-script': page(doc('<title>Main with only a script</title>', '<main><script>x</script></main><p>body text</p>')),
  '/two-bodies': page('<html><head><title>Two bodies</title></head><body class="a"><p>one</p></body><body class="b"><p>two</p><a href="/two-bodies/a">x</a></body></html><p>after html</p>'),
  '/frameset': page('<!doctype html><html><head><title>Frames</title></head><frameset cols="50%,50%"><frame src="/frameset/left"><noframes><a href="/frameset/noframes">n</a></noframes></frameset></html>'),
  '/conditional': page(doc('<title>Conditional comments</title><!--[if lt IE 9]><link rel="stylesheet" href="/ie.css"><![endif]--><!--[if !IE]><!--><link rel="stylesheet" href="/not-ie.css"><!--<![endif]-->', '<h1>Conditional</h1><![if !IE]><a href="/conditional/a">a</a><![endif]><?php echo "x"; ?><a href="/conditional/b">b</a>')),
  '/empty': page(''),
  '/whitespace': page(' \r\n\t '),
  '/just-text': page('Just some text, no markup at all. https://site.example/not-a-link'),
  '/json-as-html': page('{"title":"<title>In JSON</title>","a":"<a href=\\"/json-as-html/a\\">x</a>"}'),
  '/article-signals/plain': page(doc('<title>Plain</title>', `<main><h1>Plain</h1>${words(650)}</main>`)),
  '/article-signals/short': page(doc('<title>Short</title>', `<main><h1>Short</h1>${words(100)}</main>`)),
  '/article-signals/ld': page(doc('<title>LD</title><script type="application/ld+json">\n{ "@context": "https://schema.org", "@type" :\t"NewsArticle", "headline": "x" }\n</script>', '<h1>LD</h1>')),
  '/article-signals/ld-graph': page(doc('<title>LD graph</title><script type="application/ld+json">{"@graph":[{"@type":["WebPage","Article"]},{"@type":"BlogPosting"}]}</script>', '<h1>LD graph</h1>')),
  '/article-signals/ld-other-type': page(doc('<title>LD other</title><script type="application/ld+json">{"@type":"Product"}</script><script type="APPLICATION/LD+JSON">{"@type":"Article"}</script>', '<h1>LD other</h1>')),
  '/article-signals/og': page(doc('<title>OG</title><meta property="og:type" content=" Article">', '<h1>OG</h1>')),
  '/article-signals/time': page(doc('<title>Time</title>', '<article><h1>Time</h1><p>x</p></article><aside><time datetime="2026-01-01">d</time></aside>')),
  '/article-signals/time-no-datetime': page(doc('<title>Time</title>', `<article><h1>Time</h1><time>yesterday</time>${words(700)}</article>`)),
  '/blog/a-post': page(doc('<title>A post</title>', '<h1>A post</h1>')),
  '/blog/': page(doc('<title>Blog</title>', '<h1>Blog</h1><a href="/blog/a-post">p</a><a href="/blog/tag/x/">t</a><a href="/blog/page/2">2</a>')),
  '/blog/tag/x': page(doc('<title>Tag</title>', '<h1>Tag</h1>')),
  '/blog/page/2': page(doc('<title>Page 2</title>', '<h1>Page 2</h1>')),
  '/news/2026/05/a-story/': page(doc('<title>Story</title>', '<h1>Story</h1>')),
  '/NEWS/Caps-Story': page(doc('<title>Caps story</title>', '<h1>Caps story</h1>')),
  '/redirect-in': { redirect: '/redirect-out/' },
  '/redirect-out/': page(doc('<title>Redirected</title>', '<h1>Redirected</h1><a href="rel-after-redirect">r</a>')),
  '/redirect-www': { redirect: 'https://www.site.example/on-www' },
  '/redirect-away': { redirect: 'https://elsewhere.example/' },
  '/not-html': { type: 'application/pdf', body: '%PDF-1.4 <a href="/from-pdf">x</a>' },
  '/text-plain': { type: 'text/plain', body: '<a href="/from-text-plain">x</a>' },
  '/html-capital-type': { type: 'TEXT/HTML', body: doc('<title>Capital type</title>', '<h1>Capital type</h1>') },
  '/gone': { status: 410, type: HTML, body: doc('<title>Gone</title>', '<a href="/from-gone">x</a>') },
};

// --- sitemaps: nested indexes, namespaces, CDATA -------------------------------------------------------------------------------
const O = 'https://site.example';
const MAPS = {
  '/robots.txt': { type: 'text/plain', body: `# robots\r\nUser-agent: *\r\nDisallow: /private/\r\nDisallow: /*.php$\r\nAllow: /private/open\r\n\r\nUser-agent: RadarBot\r\nDisallow: /no-radar/\r\n\r\nSitemap: ${O}/sitemap_index.xml\r\nSitemap: ${O}/maps/extra.xml\r\nsitemap: /relative-sitemap.xml\r\nSitemap: ${O}/maps/missing.xml\r\n` },
  '/sitemap_index.xml': xml(`\ufeff<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/xsl" href="/main-sitemap.xsl"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <sitemap>\n    <loc>\n      ${O}/maps/posts.xml\n    </loc>\n    <lastmod>2026-01-01T00:00:00+00:00</lastmod>\n  </sitemap>\n  <sitemap><loc><![CDATA[${O}/maps/pages.xml]]></loc></sitemap>\n  <sm:sitemap xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"><sm:loc>${O}/maps/prefixed.xml</sm:loc></sm:sitemap>\n  <sitemap><loc>${O}/maps/nested-index.xml</loc></sitemap>\n  <sitemap><loc>maps/relative.xml</loc></sitemap>\n  <sitemap><loc>https://elsewhere.example/their.xml</loc></sitemap>\n  <sitemap><loc>${O}/maps/posts.xml</loc></sitemap>\n  <SITEMAP><LOC>${O}/maps/upper.xml</LOC></SITEMAP>\n  <sitemap><loc>${O}/maps/amp.xml?a=1&amp;b=2</loc></sitemap>\n</sitemapindex>`),
  '/maps/posts.xml': xml(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
<url><loc>${O}/blog/a-post</loc><lastmod>2026-02-02</lastmod><changefreq>weekly</changefreq><priority>0.8</priority><image:image><image:loc>${O}/media/a.jpg</image:loc></image:image><xhtml:link rel="alternate" hreflang="de" href="${O}/de/blog/a-post"/></url>
<url><loc><![CDATA[${O}/news/2026/05/a-story/?utm_source=sitemap&x=1]]></loc></url>
<url><loc>  ${O}/ja  </loc></url><url><loc>\n${O}/ar\n</loc></url><url><loc>${O}/ru</loc><loc>${O}/second-loc-in-one-url</loc></url>
<url><loc>${O}/q?a=1&amp;b=2</loc></url><url><loc>${O}/sitemap-only/%E6%97%A5%E6%9C%AC</loc></url><url><loc>${O}/sitemap-only/日本</loc></url>
<url><loc>/relative-in-urlset</loc></url><url><loc>https://www.site.example/on-www</loc></url><url><loc>http://site.example/http-in-sitemap</loc></url><url><loc>https://elsewhere.example/not-ours</loc></url><url><loc>${O}/file.pdf</loc></url><url><loc></loc></url><url></url><url><loc>${O}/private/closed</loc></url><url><loc>${O}/private/open</loc></url><url><loc>${O}/no-radar/x</loc></url><url><loc>${O}/x.php</loc></url>
<url><news:news><news:publication><news:name>N</news:name></news:publication></news:news><loc>${O}/news-entry</loc></url>
<url><loc>${O}/with<b>markup</b>inside</loc></url><url><loc>${O}/entity-&#x2F;-numeric</loc></url>
</urlset>`),
  '/maps/pages.xml': xml(`<urlset>${['/hi', '/el', '/zh', '/emoji', '/cut-astral', '/mixed-bidi', ...Object.keys(ODD)].map(p => `<url><loc>${O}${p.replace(/&/g, '&amp;')}</loc></url>`).join('\n')}</urlset>`),
  '/maps/prefixed.xml': xml(`<sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"><sm:url><sm:loc>${O}/from-prefixed</sm:loc></sm:url><url><loc>${O}/unprefixed-among-prefixed</loc></url></sm:urlset>`),
  '/maps/nested-index.xml': xml(`<sitemapindex><sitemap><loc>${O}/maps/level-2.xml</loc></sitemap><url><loc>${O}/url-in-an-index</loc></url></sitemapindex>`),
  '/maps/level-2.xml': xml(`<sitemapindex><sitemap><loc>${O}/maps/level-3.xml</loc></sitemap><sitemap><loc>${O}/sitemap_index.xml</loc></sitemap></sitemapindex>`),
  '/maps/level-3.xml': xml(`<urlset><url><loc>${O}/from-level-3</loc></url></urlset>`),
  '/maps/relative.xml': xml(`<urlset><url><loc>${O}/from-relative-map</loc></url></urlset>`),
  '/maps/upper.xml': xml(`<URLSET><URL><LOC>${O}/from-upper</LOC></URL></URLSET>`),
  '/maps/amp.xml': xml(`<urlset><url><loc>${O}/from-amp</loc></url></urlset>`),
  '/maps/extra.xml': { type: 'text/html', body: `<!doctype html><html><body><urlset><url><loc>${O}/from-html-served-map</loc></url></urlset><sitemap><loc>${O}/maps/from-html.xml</loc></sitemap></body></html>` },
  '/relative-sitemap.xml': xml(`<urlset><url><loc>${O}/from-relative-robots-line</loc></url></urlset>`),
  '/maps/from-html.xml': xml(`<urlset><url><loc>${O}/from-html-named-map</loc></url></urlset>`),
  '/maps/malformed.xml': xml(`<urlset><url><loc>${O}/before-the-break</loc></url><url><loc>${O}/unclosed`),
};

const ok = name => page(doc(`<title>${name}</title>`, `<h1>${name}</h1>`));
const HOME = page(doc('<title>Harbour &amp; Co. — made by hand</title><meta name="description" content="  Furniture and tools, made by hand.  "><link rel="icon" href="/favicon.svg" type="image/svg+xml">', `<header><a href="/"><img src="/logo.png" alt="Harbour"></a><nav>${['/blog/', '/journal', '/shop', '/ja', '/ar', '/ru', '/links/deep/page', '/redirect-in', '/redirect-www', '/redirect-away', '/not-html', '/text-plain', '/html-capital-type', '/gone', '/private/closed', '/no-radar/x', '/NEWS/Caps-Story', '/article-signals/plain', '/article-signals/short', '/article-signals/ld', '/article-signals/ld-graph', '/article-signals/ld-other-type', '/article-signals/og', '/article-signals/time', '/article-signals/time-no-datetime'].map(p => `<a href="${p}">${p}</a>`).join('')}</nav></header><main><h1>Made by hand</h1><p>We make furniture.</p></main>`));
const EXTRA = Object.fromEntries(['/from-prefixed', '/unprefixed-among-prefixed', '/url-in-an-index', '/from-level-3', '/from-relative-map', '/from-upper', '/from-amp', '/from-html-served-map', '/from-relative-robots-line', '/from-html-named-map', '/second-loc-in-one-url', '/relative-in-urlset', '/q', '/sitemap-only/%E6%97%A5%E6%9C%AC', '/news-entry', '/private/open', '/http-in-sitemap', '/maps/relative-in-urlset'].map(p => [p, ok(p)]));
const WWW = { '/on-www': ok('On www'), '/': ok('www home') };

/** Tracked HTML files of this repository and one from a dependency: the only saved HTML found offline (no saved pages of real websites). */
export function savedFiles(root) {
  const tracked = execFileSync('git', ['ls-files', '.factory/**/*.html', 'docs/**/*.html', 'public/**/*.html'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean).filter(f => !f.includes('bounded-page-parse'));
  const extra = ['node_modules/playwright-core/lib/vite/traceViewer/index.html'];
  return [...tracked, ...extra].filter(f => { try { return fs.statSync(path.join(root, f)).size <= 2 * 1024 * 1024; } catch { return false; } });
}

export function sites(root) {
  const saved = savedFiles(root);
  const SAVED = { '/robots.txt': { status: 404, type: HTML, body: '' }, '/': page(doc('<title>Saved files</title>', saved.map((_, i) => `<a href="/f/${i}">${i}</a>`).join(''))) };
  saved.forEach((f, i) => { SAVED[`/f/${i}`] = { type: HTML, body: fs.readFileSync(path.join(root, f)) }; });
  const big = { '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nCrawl-delay: 0\nDisallow:\n' }, '/': page(blog(3000)), '/shop/': page(shop(2500)), '/shop': { redirect: '/shop/' } };
  return {
    'site.example': host => host === 'www.site.example' ? WWW : { '/': HOME, ...LANGS_PAGES, ...ODD, ...MAPS, ...EXTRA, '/journal': page(blog(40)), '/shop': page(shop(30)) },
    'big.example': () => big,
    'saved.example': () => SAVED,
    'wwwonly.example': host => host === 'www.wwwonly.example' ? { '/': page(doc('<title>WWW only</title>', '<h1>WWW only</h1><a href="https://wwwonly.example/bare">bare</a><a href="/w">w</a>')), '/w': ok('W'), '/bare': ok('Bare via www') } : { '/': { fail: true }, '/robots.txt': { fail: true } },
    'httponly.example': (host, protocol) => protocol === 'http:' && host === 'httponly.example' ? { '/': page(doc('<title>HTTP only</title>', '<h1>HTTP only</h1><a href="/h">h</a><a href="https://httponly.example/s">s</a>')), '/h': ok('H') } : { '/': { fail: true } },
    'delay.example': () => ({ '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nCrawl-delay: 0.05\n' }, '/': page(doc('<title>Delay</title>', '<h1>Delay</h1><a href="/d1">1</a><a href="/d2">2</a><a href="/d3">3</a>')), '/d1': ok('D1'), '/d2': ok('D2'), '/d3': ok('D3') }),
    'homeredirect.example': () => ({ '/': { redirect: '/en/' }, '/en/': page(doc('<title>English home</title>', '<h1>English home</h1><a href="about">about</a><a href="/en">self</a>')), '/en/about': ok('About') }),
    'manymaps.example': () => { const s = { '/robots.txt': { type: 'text/plain', body: Array.from({ length: 15 }, (_, i) => `Sitemap: https://manymaps.example/m${i}.xml`).join('\n') }, '/': page(doc('<title>Many maps</title>', '<h1>Many maps</h1>')) }; for (let i = 0; i < 15; i++) { s[`/m${i}.xml`] = xml(`<urlset>${rep(50, j => `<url><loc>https://manymaps.example/m${i}/p${j}</loc></url>`)}</urlset>`); for (let j = 0; j < 50; j++) s[`/m${i}/p${j}`] = ok(`M${i} P${j}`); } return s; },
  };
}
const LANGS_PAGES = Object.fromEntries(Object.entries(LANGS).map(([p, b]) => [p, page(b)]));

/** Home pages for detectBrand: [name, html, origin, files served for its candidates and stylesheets]. */
export function brands(root) {
  const svg = fill => ({ type: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="${fill}"/><circle r="2" fill="${fill}"/></svg>` });
  const css = body => ({ type: 'text/css', body });
  const list = [
    ['blog index of 3,000 cards', blog(3000), O, { '/css/main.css': css(':root{--color-secondary:#16a34a}') }],
    ['blog index, logo served', blog(40), O, { '/img/harbour-logo.svg': svg('#be123c'), '/css/main.css': css(':root{--accent-color:#f59e0b}') }],
    ['shop home page of 2,500 products', shop(2500), O, { '/assets/theme.css': css('/* theme */\r\n:root{\r\n  --primary : #1f7a4d ;\r\n  --secondary:rgb(242, 193, 78);\r\n}'), '/assets/print.css': css(':root{--brand:#000}') }],
    ['shop home page, icon served', shop(30), O, { '/icon.svg': svg('#7c3aed') }],
    ...Object.entries(LANGS).map(([p, b]) => [`language page ${p}`, b, O, {}]),
    ...Object.entries(ODD).filter(([, v]) => v.body !== undefined).map(([p, v]) => [`odd page ${p}`, Buffer.isBuffer(v.body) ? v.body.toString('utf8') : v.body, O, {}]),
    ['home of site.example', HOME.body, O, { '/favicon.svg': svg('#0b5fff') }],
    ['icons and logos in odd spellings', doc('<title>x</title><LINK REL="ICON" HREF="/caps.png" SIZES="256X256"><link rel="icon shortcut" href="/two-rels.png" sizes="96x96 128x128"><link rel=" icon " href="/spaced-rel.svg"><link rel="mask-icon" href="/mask.svg" color="#ff0000"><link rel="icon" href="/no-sizes.png"><link rel="icon" href="/any.png" sizes="ANY"><link rel="icon" href="/svg-query.svg?v=2"><link rel="icon" href="/x.svgz" type="image/svg+xml"><link rel="apple-touch-icon" sizes="180x180" href="apple-relative.png"><link rel="APPLE-TOUCH-ICON" href="/apple-caps.png"><meta property="og:image" content=" /og-padded.png "><meta property="og:image:secure_url" content="/og-secure.png"><meta content="/og-reversed.png" property="og:image">', '<div class="Logo"><img src="/class-capital.png"></div><div class="site-logo-wrap"><picture><source srcset="/s.webp"><img src="/picture-in-logo.png"></picture></div><img class="brand logo-img" src="/img-logo-class.png"><img alt="Company Logo" src="/alt-logo.png"><img src="/assets/LOGO.PNG"><img src="data:image/png;base64,AAAA" alt="logo"><img srcset="/only-srcset.png" alt="logo"><header><img src=""><img><img src="/header.png"><svg width="10"><use href="#x"/></svg></header>'), O, {}],
    ['header svg: nested, with style and script inside', doc('<title>x</title>', '<header><svg viewBox="0 0 10 10" class="a b"><style>.x{fill:#0f766e}</style><script>alert(1)</script><g><svg x="1"><rect class="x" width="5" height="5" fill="currentColor"/></svg></g><text>A &amp; B &lt; C</text><foreignObject><div>html inside</div></foreignObject><image href="/i.png" xlink:href="/j.png"/></svg></header>'), O, {}],
    ['css in odd places', doc('<title>x</title><style>\r\n:root {\r\n  --Brand-Primary: #2563EB;\r\n  --primary-text:#111827;\r\n  --color-primary-500: hsl(221 83% 53%);\r\n  --secondary:#f59e0b !important;\r\n}\r\n</style><style type="text/css"><!-- :root{--accent:#16a34a} --></style>', '<svg><style>:root{--highlight:#be123c}</style></svg><template><style>:root{--primary:#000001}</style></template><div style="--primary:#abcdef">inline style attribute</div><style>@media (prefers-color-scheme:dark){:root{--primary:#93c5fd}}</style>'), O, {}],
    ['stylesheets: order, origin, relative', doc('<title>x</title><link rel="stylesheet" href="one.css"><link href="/two.css" rel="stylesheet"><link rel="stylesheet" href="//site.example/three.css"><link rel="stylesheet" href="/four.css">', ''), O, { '/one.css': css(':root{--any:#111111}'), '/two.css': css(':root{--primary:#0ea5e9}'), '/three.css': css(':root{--secondary:#a21caf}'), '/four.css': css(':root{--primary:#ff0000}') }],
    ['lang odd: underscores and capitals', doc('<title>x</title>', '', ' lang="PT_br"'), O, {}],
    ['lang odd: spaces', doc('<title>x</title>', '', ' lang=" en-us "'), O, {}],
    ['lang: two html elements', '<html lang="sv"><html lang="fi"><body></body></html>', O, {}],
    ['theme-color: named, rgb, short hex, spaces', doc('<title>x</title><meta name="theme-color" content=" rgb(255, 0, 128) ">', ''), O, {}],
    ['theme-color: short hex', doc('<title>x</title><meta name="theme-color" content="#F0A">', ''), O, {}],
    ['theme-color: named', doc('<title>x</title><meta name="theme-color" content="rebeccapurple">', ''), O, {}],
    ...savedFiles(root).filter((_, i) => i % 6 === 0).map(f => [`saved file ${f}`, fs.readFileSync(path.join(root, f), 'utf8'), O, {}]),
  ];
  return list;
}
