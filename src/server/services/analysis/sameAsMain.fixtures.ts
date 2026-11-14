// The sites and home pages sameAsMain.test.ts crawls and detects brands on. Nothing here is hostile: these are the
// ordinary and the awkward-but-ordinary cases, one for every signal read from a page, a home page or a sitemap, so that
// "the same results as before" is checked signal by signal. Each site is a table of paths; anything else is a 404 page.

export interface Served { type?: string; body?: string; status?: number; /** Answer with a redirect to this address. */ redirect?: string; /** The request fails, as when nothing answers. */ fail?: true }
export type Site = Record<string, Served>;

const HTML = 'text/html; charset=utf-8';
const page = (body: string): Served => ({ type: HTML, body });
const xml = (body: string): Served => ({ type: 'application/xml', body: `<?xml version="1.0" encoding="UTF-8"?>${body}` });
const doc = (head: string, body: string, attrs = '') => `<!doctype html><html${attrs}><head>${head}</head><body>${body}</body></html>`;
const rep = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join('');
const words = (n: number, word = 'word') => Array.from({ length: n }, (_, i) => word + i).join(' ');
/** A home page that links to every other path of its site, in the order given. */
const linksTo = (paths: string[]) => paths.map(p => `<a href="${p}">${p}</a>`).join(' ');

// --- words.example: title, h1, description, links and text ---------------------------------------------------------

const LINKS = [
  '/a', '/a/', '/a#frag', '/a?x=1', '/a/?x=1#y', 'about', './rel', '../up', '/dir/../norm', '/dir/./dot', '//words.example/proto', '//other.example/proto',
  'https://www.words.example/www', 'http://words.example/http', 'https://sub.words.example/sub', 'https://other.example/x', 'https://words.example:8443/port',
  'HTTPS://WORDS.EXAMPLE/Caps', 'mailto:a@words.example', 'tel:+15550100', 'javascript:void(0)', 'data:text/html,x', 'ftp://words.example/f', '', '#', '#top', '?q=1',
  'http://[bad', 'https://', 'http://exa mple.com/', ' /spaced ', '/tab\tin', '/nl\nin',
  ...['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'pdf', 'zip', 'mp4', 'mp3', 'css', 'js', 'xml', 'json', 'txt', 'woff', 'woff2'].map(ext => `/file.${ext}`),
  '/FILE.PNG', '/file.png?x=1', '/file.png/', '/file.jpgx', '/doc.pdf#p2', '/x.html', '/x.php', '/x.htm?y', '/png', '/a.b/c',
  '/dup', '/dup', '/dup/', '/dup?z=1', '/dup#f', '/üñí', '/sp ace', '/%7Etilde', '/a%20b', '/trailing//', '/', 'https://words.example', 'https://words.example/?utm=1',
  'https://user:pw@words.example/auth', 'https://words.example./dot-host', 'https://wwww.words.example/w4', 'https://www.www.words.example/ww', 'https://WWW.words.example/caps-www',
  '/q?a=1&amp;b=2', '/amp&amp;ersand', '/quote&quot;d', '/after-all',
];
const attr = (s: string) => s.replace(/"/g, '&quot;');

const WORDS: Site = {
  '/robots.txt': { status: 404, type: HTML, body: 'no robots' },
  '/sitemap.xml': { status: 404, type: HTML, body: 'no sitemap' },
  '/t/plain': page(doc('<title>  Plain title  </title><meta name="description" content="  A description, with spaces around it.  ">', '<h1>  One\n  <em>two</em>\tthree </h1><p>Body.</p>')),
  '/t/two-of-each': page(doc('<title>First title</title><title>Second title</title><meta name="description" content="First description"><meta name="description" content="Second description">', '<h1>First heading</h1><svg><title>Icon title</title></svg><h1>Second heading</h1>')),
  '/t/none': page(doc('', '<p>No title, no heading, no description.</p>')),
  '/t/svg-title': page(doc('<meta charset="utf-8">', '<svg viewBox="0 0 1 1"><title>Icon title</title><path d="M0 0"/></svg><h2>Not an h1</h2>')),
  '/t/og-description': page(doc('<title>Og</title><meta property="og:description" content="  From og:description.  ">', '<h1>Og</h1>')),
  '/t/both-descriptions': page(doc('<title>Both</title><meta property="og:description" content="From og"><meta name="description" content="From name">', '<h1>Both</h1>')),
  '/t/empty-description': page(doc('<title>Empty</title><meta name="description" content=""><meta property="og:description" content="From og, because the other is empty">', '<h1>Empty</h1>')),
  '/t/blank-description': page(doc('<title>Blank</title><meta name="description" content="   "><meta property="og:description" content="Not used: the other is blank, not empty">', '<h1>Blank</h1>')),
  '/t/description-no-content': page(doc('<title>No content</title><meta name="description"><meta property="og:description" content="From og, because the other has no content">', '<h1>No content</h1>')),
  '/t/description-wrong-attribute': page(doc('<title>Wrong</title><meta property="description" content="property, not name"><meta name="og:description" content="name, not property"><meta name="Description" content="Capital D">', '<h1>Wrong</h1>')),
  '/t/long': page(doc(`<title>${'T'.repeat(400)}</title><meta name="description" content="${'d'.repeat(700)}">`, `<h1>${rep(120, i => `w${i}  \n`)}</h1>`)),
  '/t/entities': page(doc('<title>Caf&eacute; &amp; Bar — 日本語 🍵 &lt;b&gt;</title><meta name="description" content="Tom &amp; Jerry&#39;s &quot;place&quot;">', '<h1>A&nbsp;B&#160;C &amp; D</h1>')),
  '/t/heading-with-markup': page(doc('<title>Markup</title>', '<div><section><h1>Head<script>var a = 1;</script> <span>line</span><br>two<style>b{}</style><!-- c --></h1></section></div>')),
  '/t/title-in-body': page(doc('', '<h1>Late</h1><title>A title in the body</title>')),
  '/l/links': page(doc('<title>Links</title><link href="/link-element">', `<h1>Links</h1>${LINKS.map(h => `<a href="${attr(h)}">x</a>`).join('\n')}<a>no href</a><a href>bare href</a><a name="n">named</a><area href="/area"><A HREF="/upper-tag">upper</A><map><a href="/in-map">m</a></map><svg><a href="/in-svg">s</a><a xlink:href="/xlink">x</a></svg>`)),
  '/l/relative/deep/page': page(doc('<title>Relative</title>', '<h1>Relative</h1><a href="sibling">s</a><a href="../cousin">c</a><a href="../../uncle/">u</a><a href="?only=query">q</a><a href="#only-fragment">f</a><a href=".">dot</a><a href="..">dots</a>')),
  '/l/moved': { redirect: '/l/landed/' },
  '/l/landed/': page(doc('<title>Landed</title>', '<h1>Landed</h1><a href="next">next, from a page whose address ends in a slash</a><a href="/l/landed">itself</a>')),
  '/l/landed': { redirect: '/l/landed/' },
  '/l/away': { redirect: 'https://other.example/elsewhere' },
  '/l/base': page(doc('<title>Base</title><base href="https://other.example/dir/">', '<h1>Base</h1><a href="from-base">b</a>')),
  '/l/order': page(doc('<title>Order</title>', `<h1>Order</h1><footer><a href="/o/footer-first">f</a></footer><nav><a href="/o/nav">n</a></nav><main><a href="/o/main">m</a><a href="/o/nav">again</a></main><header><form><a href="/o/in-header-form">h</a></form></header>`)),
  '/x/data': { type: 'application/json', body: '{"a":"<a href=\\"/from-json\\">x</a>"}' },
  '/x/gone': { status: 404, type: HTML, body: doc('<title>Gone</title>', '<a href="/from-a-404">x</a>') },
  '/x/error': { status: 500, type: HTML, body: doc('<title>Error</title>', '<a href="/from-a-500">x</a>') },
  '/x/xhtml': { type: 'application/xhtml+xml', body: doc('<title>XHTML</title>', '<h1>XHTML</h1><p>Served as application/xhtml+xml.</p><br/><a href="/from-xhtml"/>') },
  '/x/removed': page(doc('<title>Removed</title><style>head-style{}</style><script>var head = 1;</script><noscript><p>head noscript</p></noscript>',
    `<header><p>header text stays</p><form><input value="v"><label>header form goes</label></form></header><nav><p>nav goes</p></nav>
     <p>one</p><script>var gone = 'script';</script><style>.gone{content:"style"}</style><noscript>noscript goes</noscript><svg><text>svg goes</text></svg><iframe src="/f">iframe goes</iframe>
     <p>two</p><form><label>a form outside a header stays</label></form><div><nav><ul><li>nested nav goes</li></ul></nav><p>three</p></div><textarea>textarea stays</textarea><template><p>template</p></template><!-- comment -->
     <footer><p>footer goes</p></footer><p>four</p>`)),
  '/x/main': page(doc('<title>Main</title>', '<p>outside before</p><main><h1>Main</h1><p>inside main</p><nav>nav in main goes</nav></main><p>outside after</p>')),
  '/x/two-mains': page(doc('<title>Two mains</title>', '<main><p>first main</p></main><p>between</p><main><p>second main</p></main>')),
  '/x/empty-main': page(doc('<title>Empty main</title>', '<main></main><p>body text, because main has none</p>')),
  '/x/blank-main': page(doc('<title>Blank main</title>', '<main>   \n </main><p>body text that is not used: main is blank, not empty</p>')),
  '/x/main-of-script': page(doc('<title>Main of script</title>', '<main><script>var only = "script";</script></main><p>body text, because main has only a script</p>')),
  '/x/main-in-footer': page(doc('<title>Main in footer</title>', '<footer><main>main inside a footer goes with it</main></footer><p>body text</p>')),
  '/x/whitespace': page(doc('<title>Whitespace</title>', '<p>  a\t\tb\n\n\nc&nbsp;&nbsp;d  </p><pre>  pre   formatted\n\tlines  </pre><p>e<br>f</p><p>g</p><p>h</p><span>i</span><span>j</span> \u2003 k \u00a0 l')),
  '/x/long': page(doc('<title>Long</title>', `<main><p>${words(1200)}</p></main>`)),
  '/x/empty': page(''),
  '/x/text-only': page('Just text, with no markup at all, and a bare link: https://words.example/not-a-link'),
  '/x/malformed': page('<html><head><title>Malformed</title><body><h1>Unclosed <b>bold <i>italic</b> tail</i><p>para<table><tr><td>cell</td>stray text<tr><td>next</table><a href="/from-malformed">link<div>block in a link</a></div><p>end'),
  '/x/fragment': page('<h1>No html, head or body element</h1><p>Only a fragment.</p><a href="/from-fragment">x</a>'),
};
WORDS['/'] = page(doc('<title>Words — home</title><meta name="description" content="The home page of the words site.">', `<header><h1>Words</h1></header><nav>${linksTo(Object.keys(WORDS).filter(p => /^\/[tlx]\//.test(p)))}</nav><main><p>Home.</p></main>`, ' lang="en"'));
const OTHER: Site = {
  '/elsewhere': page(doc('<title>Elsewhere</title>', '<h1>Another site</h1><a href="https://words.example/from-another-site">back</a>')),
  '/sm.xml': xml('<urlset><url><loc>https://www.maps.example/s/from-another-host</loc></url><url><loc>https://other.example/its-own</loc></url></urlset>'),
};

// --- kinds.example: article or page, and how sure --------------------------------------------------------------------

const plain = (title: string, head = '', body = '') => page(doc(`<title>${title}</title>${head}`, `<h1>${title}</h1>${body}<p>A few words.</p>`));
const ld = (json: string, type = 'application/ld+json') => `<script type="${type}">${json}</script>`;
const ARTICLE_BODY = '<article><h2>Post</h2><time datetime="2026-03-01">1 March</time><p>Text.</p></article>';
const KINDS: Site = {
  '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nAllow: /\n' },
  '/sitemap.xml': { status: 404, type: HTML, body: '' },
  // listings win over every other signal (and a path that only ends like one is a listing too)
  '/ld/article': plain('Ends like a listing', ld('{"@type":"Article"}')),
  '/blog': plain('Blog listing', '<meta property="og:type" content="article">' + ld('{"@type":"Article"}'), ARTICLE_BODY),
  '/news': { redirect: '/news/' },
  '/news/': plain('News listing, address ending in a slash', '', ARTICLE_BODY),
  '/resources': plain('Resources listing'), '/insights': plain('Insights listing'), '/journal': plain('Journal listing'), '/guides': plain('Guides listing'), '/articles': plain('Articles listing'), '/post': plain('Post listing'),
  '/learn': plain('Learn is not a listing'), '/stories': plain('Stories is not a listing'), '/notes': plain('Notes is not a listing'), '/shop/blog': plain('A listing under another path'), '/blogs': plain('Blogs is not a listing'),
  // og:type
  '/about-og': plain('og:type article', '<meta property="og:type" content="article">'),
  '/about-og-caps': plain('og:type ARTICLE', '<meta property="og:type" content="ARTICLE">'),
  '/about-og-website': plain('og:type website, with an article and a date', '<meta property="og:type" content="website">', ARTICLE_BODY),
  '/about-og-name': plain('og:type under name, not property', '<meta name="og:type" content="article">'),
  '/about-og-second': plain('og:type twice', '<meta property="og:type" content="website"><meta property="og:type" content="article">'),
  '/about-og-padded': plain('og:type with spaces', '<meta property="og:type" content=" article ">'),
  // JSON-LD
  '/ld/blogposting': plain('BlogPosting', ld('{"@context":"https://schema.org","@type":"BlogPosting","headline":"x"}')),
  '/ld/plain-article': plain('Article', ld('{"@context":"https://schema.org","@type":"Article"}')),
  '/ld/news-article': plain('NewsArticle', ld('{"@type":"NewsArticle"}')),
  '/ld/tech-article': plain('TechArticle', ld('{"@type":"TechArticle"}')),
  '/ld/webpage': plain('WebPage', ld('{"@type":"WebPage"}')),
  '/ld/product': plain('Product', ld('{"@type":"Product","name":"Article"}')),
  '/ld/spaced': plain('Spaced', ld('{\n  "@type" :\t"Article"\n}')),
  '/ld/array': plain('Array of types', ld('{"@type":["Article","Thing"]}')),
  '/ld/graph': plain('Graph', ld('{"@graph":[{"@type":"WebSite"},{"@type":"BlogPosting"}]}')),
  '/ld/second-script': plain('Second script', ld('{"@type":"Organization"}') + ld('{"@type":"NewsArticle"}')),
  '/ld/in-body': plain('In the body', '', ld('{"@type":"Article"}')),
  '/ld/json-type': plain('Plain JSON script', ld('{"@type":"Article"}', 'application/json')),
  '/ld/type-caps': plain('Type in capitals', ld('{"@type":"Article"}', 'APPLICATION/LD+JSON')),
  '/ld/type-charset': plain('Type with a parameter', ld('{"@type":"Article"}', 'application/ld+json; charset=utf-8')),
  '/ld/longer-name': plain('A longer type name', ld('{"@type":"ArticlePage"}')),
  '/ld/single-quotes': plain('Single quotes', ld("{'@type':'Article'}")),
  '/ld/lower': plain('Lower case', ld('{"@type":"article"}')),
  '/ld/broken-json': plain('Broken JSON', ld('{"@type":"Article",')),
  // article paths
  '/blog/first-post': plain('A post'), '/docs/blog/nested-post': plain('A post under another path'), '/BLOG/Upper-Post': plain('A post in capitals'),
  '/guides/setup': { redirect: '/guides/setup/' }, '/guides/setup/': plain('A guide, address ending in a slash'),
  '/article/a': plain('article/'), '/articles/a': plain('articles/'), '/post/a': plain('post/'), '/posts/a': plain('posts/'), '/news/a': plain('news/'), '/guide/a': plain('guide/'), '/resources/a': plain('resources/'),
  '/insights/a': plain('insights/'), '/learn/a': plain('learn/'), '/journal/a': plain('journal/'), '/stories/a': plain('stories/'), '/notes/a': plain('notes/'),
  '/blog/tag/x': plain('A tag page'), '/blog/tags/x': plain('A tags page'), '/blog/page/2': plain('A numbered listing page'), '/blog/category/a': plain('A category page'), '/blog/categories/a': plain('A categories page'), '/blog/author/jo': plain('An author page'),
  '/blog/tagged': plain('A post whose name starts like tag'), '/blog/2026/dated-post': plain('A dated post, two levels down'), '/blog/post.html': plain('A post with an extension'), '/weblog/a': plain('Not the blog'), '/blogs/a': plain('Not the blog either'),
  // structure
  '/s/article-time': plain('Article and a date', '', ARTICLE_BODY),
  '/s/article-no-time': plain('Article, no date', '', '<article><p>Text.</p></article>'),
  '/s/time-no-article': plain('A date, no article', '', '<time datetime="2026-03-01">1 March</time>'),
  '/s/time-no-datetime': plain('Article and a time without datetime', '', '<article><time>1 March</time></article>'),
  '/s/time-outside': plain('Article, and a date outside it', '', '<article><p>Text.</p></article><aside><time datetime="2026-03-01">1 March</time></aside>'),
  '/s/empty-datetime': plain('Article and an empty datetime', '', '<article><time datetime>1 March</time></article>'),
  // length: the count is of the body's text, split at white space
  ...Object.fromEntries([597, 598, 599, 600, 601, 900].map(n => [`/w/${n}`, page(doc(`<title>${n}</title>`, `<p>${words(n)}</p>`))])),
  '/w/main-short': page(doc('<title>Short main, long body</title>', `<main><p>${words(20)}</p></main><div>${words(700, 'more')}</div>`)),
  '/w/spaced-out': page(doc('<title>Padded</title>', `\n  <p>${words(596)}</p>\n  `)),
  '/w/in-script': page(doc('<title>Long script</title>', `<p>${words(100)}</p><script>${words(700, 'var')}</script>`)),
};
KINDS['/'] = page(doc('<title>Kinds — home</title><meta property="og:type" content="article">' + ld('{"@type":"Article"}'), `<h1>Kinds</h1>${ARTICLE_BODY}<nav>${linksTo(Object.keys(KINDS).filter(p => !/^\/(robots|sitemap)/.test(p)))}</nav>`));

// --- maps.example: robots, a sitemap index, url sets; the site answers on www. --------------------------------------

const M = 'https://www.maps.example';
const loc = (s: string) => `<url><loc>${s}</loc></url>`;
const MAPS_WWW: Site = {
  '/': page(doc('<title>Maps — home</title>', `<h1>Maps</h1><a href="/s/from-home">h</a><a href="https://maps.example/s/bare-host">b</a><a href="/private/area">p</a><a href="/s/blocked">blocked by robots</a>`)),
  '/robots.txt': { type: 'text/plain', body: `User-agent: *\nDisallow: /private\nDisallow: /s/blocked\n\nSitemap: ${M}/sitemap_index.xml\nSitemap: ${M}/extra.xml\nSitemap: ${M}/sitemap_index.xml\n` },
  '/sitemap_index.xml': xml(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <sitemap><loc>  ${M}/sm-pages.xml  </loc><lastmod>2026-01-01</lastmod></sitemap>
    <sitemap><loc>${M}/sm-nested-index.xml</loc></sitemap>
    <sitemap><loc>${M}/sm-missing.xml</loc></sitemap>
    <sitemap><loc>https://other.example/sm.xml</loc></sitemap>
    <sitemap><loc>${M}/sm-pages.xml</loc></sitemap>
    <sitemap><loc>sm-relative.xml</loc></sitemap>
    <sitemap><loc><![CDATA[${M}/sm-cdata.xml]]></loc></sitemap>
    <sitemap><lastmod>2026-01-01</lastmod></sitemap>
    <sitemap><wrap><loc>${M}/sm-not-a-child.xml</loc></wrap></sitemap>
    <SITEMAP><LOC>${M}/sm-capitals.xml</LOC></SITEMAP>
    ${loc(`${M}/s/url-inside-an-index`)}
    <sitemap><loc>${M}/sm-a-page.xml</loc></sitemap>
  </sitemapindex>`),
  '/sm-pages.xml': xml(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:xhtml="http://www.w3.org/1999/xhtml">
    ${[`${M}/s/one`, 'https://maps.example/s/two', `http://www.maps.example/s/three`, 'https://other.example/s/elsewhere', '/s/relative', 's/relative-no-slash', `${M}/s/four/`, `${M}/s/five?x=1#y`, `${M}/s/file.pdf`, `${M}/feed.xml`,
      `\n      ${M}/s/six\n    `, `${M}/s/seven?a=1&amp;b=2`, `<![CDATA[${M}/s/eight]]>`, '', 'http://[bad', `${M}/s/blocked`, `${M}/private/listed`, `${M}/s/one`, `${M}/S/One`, `${M}/s/nine%20ten`, `${M}/s/é`, 'mailto:a@maps.example', `${M}`].map(loc).join('\n    ')}
    <url><loc>${M}/s/with-image</loc><image:image><image:loc>${M}/s/image-loc.jpg</image:loc></image:image><xhtml:link rel="alternate" hreflang="fr" href="${M}/s/alternate"/></url>
    <url><lastmod>2026-01-01</lastmod></url>
    <url><wrap><loc>${M}/s/not-a-child</loc></wrap></url>
    <url><loc>${M}/s/two-locs-a</loc><loc>${M}/s/two-locs-b</loc></url>
    <URL><LOC>${M}/s/capitals</LOC></URL>
    <loc>${M}/s/loc-outside-a-url</loc>
    <sitemap><loc>${M}/sm-from-a-urlset.xml</loc></sitemap>
  </urlset>`),
  '/sm-nested-index.xml': xml(`<sitemapindex><sitemap><loc>${M}/sm-more.xml</loc></sitemap></sitemapindex>`),
  // Twelve sitemaps are read for one site. This is the eleventh, so of the three it names only the first is read.
  '/sm-more.xml': xml(`<urlset>${loc(`${M}/s/from-a-nested-index`)}${rep(3, i => `<sitemap><loc>${M}/sm-late-${i}.xml</loc></sitemap>`)}</urlset>`),
  ...Object.fromEntries(Array.from({ length: 3 }, (_, i) => [`/sm-late-${i}.xml`, xml(`<urlset>${loc(`${M}/s/from-late-${i}`)}</urlset>`)])),
  '/sm-cdata.xml': xml(`<urlset>${loc(`${M}/s/from-a-cdata-address`)}</urlset>`),
  '/sm-from-a-urlset.xml': xml(`<urlset>${loc(`${M}/s/from-a-sitemap-named-in-a-urlset`)}</urlset>`),
  '/sm-not-a-child.xml': xml(`<urlset>${loc(`${M}/s/never-a`)}</urlset>`),
  '/sm-capitals.xml': xml(`<urlset>${loc(`${M}/s/never-b`)}</urlset>`),
  '/extra.xml': { type: 'text/xml', body: `<urlset><url><loc>${M}/s/unclosed-file</loc></url><url><loc>${M}/s/cut-off` },
  '/sm-a-page.xml': { type: HTML, body: doc('<title>Not a sitemap</title>', `<p>A page behind a sitemap's name.</p><url><loc>${M}/s/from-a-page-behind-a-sitemap-name</loc></url>`) },
  ...Object.fromEntries(['one', 'two', 'three', 'relative', 'four', 'five', 'six', 'seven', 'eight', 'with-image', 'from-home', 'from-a-nested-index', 'from-another-host', 'unclosed-file', 'url-inside-an-index', 'two-locs-a', 'two-locs-b', 'from-a-cdata-address', 'from-a-sitemap-named-in-a-urlset', 'from-late-0', 'from-late-1'].map(name => [`/s/${name}`, plain(`Page ${name}`)])),
  '/private/area': plain('Private'), '/s/blocked': plain('Blocked'),
};
const MAPS_BARE: Site = { '/': { fail: true }, '/robots.txt': { fail: true }, '/s/two': { redirect: `${M}/s/two` }, '/s/bare-host': plain('Page on the bare host') };

// --- bulk.example: more addresses than a crawl reads -----------------------------------------------------------------

const B = 'https://bulk.example';
const BULK: Site = {
  '/': page(doc('<title>Bulk — home</title>', '<h1>Bulk</h1>')),
  '/robots.txt': { type: 'text/plain', body: `Sitemap: ${B}/sitemap-a.xml\nSitemap: ${B}/sitemap-b.xml\n` },
  '/sitemap-a.xml': xml(`<urlset>${rep(450, i => loc(`${B}/p/${i}`))}</urlset>`),
  '/sitemap-b.xml': xml(`<urlset>${loc(`${B}/p/from-the-second-sitemap`)}</urlset>`),
  ...Object.fromEntries(Array.from({ length: 450 }, (_, i) => [`/p/${i}`, i % 7 === 3 ? { status: 404, type: HTML, body: '' } : page(doc(`<title>Bulk ${i}</title>`, `<h1>Bulk ${i}</h1><a href="/p/${i}/child">c</a>`))])),
};

// --- large.example: the two ordinary large pages (about 1.5 MB each), as the probes build them ------------------------

const wrap = (head: string, body: string) => `<!doctype html><html lang="fr"><head><title>x</title><style>:root{--brand-primary:#2563eb}</style>${head}</head><body>${body}</body></html>`;
export const blogIndex = (n: number) => wrap('<link rel="icon" href="/favicon-512.png" sizes="512x512"><link rel="stylesheet" href="/site.css"><meta name="description" content="A long blog index">',
  `<header><nav><a href="/"><img src="/logo.png" alt="Acme logo"></a><a href="/blog">Blog</a></nav></header><main><h1>Blog</h1>${rep(n, i => `<article class="card"><a href="/blog/post-${i}"><img src="/img/${i}.jpg" alt="Post ${i}" loading="lazy"><h2>Post number ${i}: how to do the thing</h2></a><p class="excerpt">A short excerpt of the post that runs to a couple of lines of text so the card has something to read in it.</p><time datetime="2026-01-01">Jan 1</time><span class="tag">guides</span></article>`)}</main><footer><a href="/about">About</a></footer>`);
export const shopHome = (n: number) => wrap('<link rel="apple-touch-icon" href="/apple.png"><meta property="og:image" content="/og.png"><meta name="theme-color" content="#0f766e">',
  `<header class="site-header"><div class="logo"><svg viewBox="0 0 10 10"><path fill="#0f766e" d="M0 0h10v10z"/></svg></div><nav>${rep(60, i => `<ul class="menu"><li><a href="/c/${i}">Category ${i}</a><ul>${rep(12, j => `<li><a href="/c/${i}/${j}">Sub ${j}</a></li>`)}</ul></li></ul>`)}</nav></header><main>${rep(n, i => `<div class="product-card" data-id="${i}"><div class="media"><picture><source srcset="/p/${i}.webp 400w, /p/${i}@2x.webp 800w" type="image/webp"><img src="/p/${i}.jpg" alt="Product ${i}" width="400" height="400"></picture></div><div class="info"><a class="title" href="/products/item-${i}">Product ${i} with a longer name</a><div class="price"><span class="was">$29.00</span><span class="now">$19.00</span></div><div class="rating"><span>★</span><span>★</span><span>★</span><span>★</span><span>☆</span></div><button type="button" class="add">Add to cart</button></div></div>`)}</main><footer>${rep(40, i => `<a href="/f/${i}">Footer ${i}</a>`)}</footer>`);
const LARGE: Site = {
  '/': page(shopHome(2500)),
  // The home page links to 3,300 addresses; robots keeps the crawl to the two large pages.
  '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /c/\nDisallow: /products/\nDisallow: /f/\nDisallow: /blog/\nDisallow: /about\n' },
  '/sitemap.xml': xml(`<urlset>${loc('https://large.example/blog')}</urlset>`),
  '/blog': page(blogIndex(4000)),
};

const DOWN: Site = { '/': { fail: true }, '/robots.txt': { fail: true } };
const BLOCKED: Site = { '/': page(doc('<title>Blocked</title>', '<h1>Blocked</h1>')), '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /\n' } };
const FORBIDDEN: Site = { '/': { status: 403, type: HTML, body: doc('<title>Forbidden</title>', '') }, '/robots.txt': { status: 404, type: HTML, body: '' } };

/** Every host the crawls can reach. A host that is not here does not answer. */
export const SITES: Record<string, Site> = {
  'words.example': WORDS, 'other.example': OTHER, 'kinds.example': KINDS, 'www.maps.example': MAPS_WWW, 'maps.example': MAPS_BARE, 'bulk.example': BULK, 'large.example': LARGE,
  'down.example': DOWN, 'www.down.example': DOWN, 'blocked.example': BLOCKED, 'forbidden.example': FORBIDDEN, 'www.forbidden.example': DOWN,
};
/** The domains crawled, each as analysis.site would crawl it. */
export const CRAWLS = ['words.example', 'kinds.example', 'maps.example', 'bulk.example', 'large.example', 'down.example', 'blocked.example', 'forbidden.example'];

// --- home pages for brand detection -----------------------------------------------------------------------------------

export interface BrandCase { name: string; html: string; origin?: string; /** What the site serves, by path or by whole address. Anything else is a 404. */ files?: Site }
export const BRAND_ORIGIN = 'https://brand.example';
const svgLogo = (fill: string, more = ''): Served => ({ type: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${fill}"/><circle cx="32" cy="32" r="12" fill="${fill}"/>${more}</svg>` });
const css = (body: string): Served => ({ type: 'text/css', body });
const icon = (attrs: string) => `<link ${attrs}>`;
const home = (head: string, body = '', attrs = ' lang="en"') => doc(`<title>Brand</title>${head}`, body, attrs);

export const BRANDS: BrandCase[] = [
  // Icon links: which are kept and in what order. Nothing is served, so every candidate is asked for, up to six.
  { name: 'icons: largest first, under 96 dropped unless SVG', html: home([
    icon('rel="icon" href="/i16.png" sizes="16x16"'), icon('rel="icon" href="/i96.png" sizes="96x96"'), icon('rel="shortcut icon" href="/multi.png" sizes="16x16 32x32 192x192"'),
    icon('rel="icon" href="/any.png" sizes="any"'), icon('rel="icon" href="/i512.png" sizes="512x512"'), icon('rel="icon" href="/i95.png" sizes="95x95"'), icon('rel="icon" href="/nosizes.png"'), icon('rel="icon" href="/i180.png" sizes="180x180"'),
  ].join('')) },
  { name: 'icons: SVG by type and by extension', html: home([
    icon('rel="icon" href="/by-type" type="image/svg+xml"'), icon('rel="icon" href="/by-ext.svg"'), icon('rel="icon" href="/by-ext-query.svg?v=2"'), icon('rel="icon" href="/capital.SVG"'), icon('rel="icon" href="/svg-in-path/icon.png"'),
    icon('rel="icon" href="/typed-xml" type="image/svg"'), icon('rel="icon" href="/svg-sized.svg" sizes="32x32"'), icon('rel="icon" href="/fragment.svg#mark"'),
  ].join('')) },
  { name: 'icons: rel written oddly, and links with no address', html: home([
    icon('rel="mask-icon" href="/mask.svg"'), icon('rel="ICON" href="/caps-rel.svg"'), icon('rel="alternate icon" href="/alternate.svg"'), icon('rel="icon" sizes="300x300"'), icon('rel="icon" href="" sizes="301x301"'), icon('rel="icons" href="/plural.svg"'), icon('rel="fav-icon" href="/hyphen.svg"'),
  ].join('')) },
  { name: 'icons: sizes written oddly (1)', html: home([
    icon('rel="icon" sizes="192X192" href="/caps-size.png"'), icon('rel="icon" sizes="x" href="/bad-size.png"'), icon('rel="icon" sizes="1e3x1e3" href="/exponent.png"'), icon('rel="icon" sizes=" 128x128 " href="/padded.png"'), icon('rel="icon" sizes="ANY" href="/caps-any.png"'),
  ].join('')) },
  { name: 'icons: sizes written oddly (2)', html: home([
    icon('rel="icon" sizes="100" href="/one-number.png"'), icon('rel="icon" sizes="-200x200" href="/negative.png"'), icon('rel="icon" sizes="97.9x97.9" href="/decimal.png"'), icon('rel="icon" sizes="96x1" href="/wide.png"'), icon('rel="icon" sizes="1x96" href="/tall.png"'), icon('rel="icon" sizes="16x16\t256x256\n32x32" href="/tabs.png"'),
  ].join('')) },
  { name: 'icons: equal sizes keep their order; a link in the body counts', html: home(icon('rel="icon" href="/b.png" sizes="128x128"') + icon('rel="icon" href="/a.png" sizes="128x128"') + icon('rel="icon" href="/c.png" sizes="256x256"'), icon('rel="icon" href="/in-body.png" sizes="128x128"')) },
  { name: 'apple-touch-icon and the precomposed form', html: home([
    icon('rel="apple-touch-icon" href="/apple.png"'), icon('rel="apple-touch-icon-precomposed" href="/precomposed.png"'), icon('rel="apple-touch-icon other" href="/apple-with-more.png"'),
    icon('rel="other apple-touch-icon-precomposed" href="/precomposed-with-more.png"'), icon('rel="apple-touch-icon" sizes="180x180" href="/apple-180.png"'), icon('rel="apple-touch-icon"'), icon('rel="apple-touch-icon" href="/apple.png"'),
  ].join('')) },
  { name: 'header images, and logo by class', html: home('', '<header><a href="/"><img src="/header-1.png" alt="Home"></a><div><img src="header-2.png"></div><img alt="no src"></header><div class="site-logo"><a><img src="/class-on-ancestor.png"></a></div><img class="logo-img" src="/class-on-image.png"><img class="brandLogo" src="/capital-in-class.png"><img src="/plain.png" alt="Plain"><div class="LOGO"><img src="/capital-class-on-ancestor.png"></div>') },
  { name: 'logo by alt and by src, in any letter case', html: home('', '<img alt="Company LOGO" src="/alt-capitals.png"><img alt="our logotype" src="/alt-inside-a-word.png"><img src="/img/LoGo-file.png"><img src="/img/brand.png?name=logo"><img alt="Logo"><img src="/photo.png" alt="A photo"><img data-src="/lazy-logo.png" alt="lazy">') },
  { name: 'og:image comes last; one address is listed once', html: home(icon('rel="icon" type="image/svg+xml" href="/same.svg"') + icon('rel="apple-touch-icon" href="/same.svg"') + '<meta property="og:image" content="/og.png"><meta property="og:image" content="/og-second.png">', '<header><img src="/same.svg"><img src="/header.png"><img src="/og.png"></header>') },
  { name: 'addresses: relative, protocol-relative, another host, invalid, data', html: home('<meta property="og:image" content="//cdn.example/og.png">', '<header><img src="img/relative.png"><img src="//cdn.example/protocol-relative.png"><img src="https://cdn.example/absolute.png"><img src="http://[bad"><img src="data:image/png;base64,AAAA"><img src="  /padded.png  "></header>') },
  { name: 'og:image alone, and one that is not valid', html: home('<meta name="og:image" content="/under-name.png"><meta property="og:image" content="http://[bad">') },
  { name: 'more than six candidates: the seventh is never asked for, though it is the only good one', html: home('', `<header>${rep(9, i => `<img src="/h${i}.svg">`)}</header>`), files: { '/h6.svg': svgLogo('#16a34a') } },
  { name: 'the first usable candidate is kept', html: home(icon('rel="apple-touch-icon" href="/missing.png"') + icon('rel="apple-touch-icon" href="/a-page.png"') + icon('rel="apple-touch-icon" href="/tiny.svg"') + icon('rel="apple-touch-icon" href="/good.svg"') + icon('rel="apple-touch-icon" href="/also-good.svg"')),
    files: { '/a-page.png': page(doc('<title>Not a picture</title>', '')), '/tiny.svg': { type: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' }, '/good.svg': svgLogo('#1d4ed8', '<path d="M0 0h8" stroke="#f97316"/>'), '/also-good.svg': svgLogo('#dc2626') } },
  { name: 'a good logo and the page\'s own colors together', html: home(icon('rel="icon" href="/logo.svg" sizes="any"') + '<style>:root{--brand-primary:#7c3aed;--accent:#f59e0b}</style>'), files: { '/logo.svg': svgLogo('#0f766e') } },
  // The SVG in the header, when no candidate works.
  { name: 'header SVG without xmlns', html: home('', '<header><svg viewBox="0 0 24 24" width="24" height="24"><path fill="#0f766e" d="M0 0h24v24H0z"/><circle cx="12" cy="12" r="4" fill="#f59e0b"/></svg></header>') },
  { name: 'header SVG with xmlns', html: home('', '<header><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="#be123c"><rect width="24" height="24"/></g></svg></header>') },
  { name: 'header SVG with only xmlns:xlink', html: home('', '<header><svg xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24"><use xlink:href="#mark" fill="#1d4ed8"/></svg></header>') },
  { name: 'header SVG over 200,000 characters', html: home('', `<header><svg viewBox="0 0 24 24">${'<path fill="#0f766e" d="M0 0h1"/>'.repeat(5200)}</svg></header>`) },
  { name: 'header SVG just under 200,000 characters', html: home('', `<header><svg viewBox="0 0 24 24">${'<path fill="#0f766e" d="M0 0h1"/>'.repeat(5100)}</svg></header>`) },
  { name: 'SVG under a logo class comes before a later header SVG', html: home('', '<a class="navbar-logo"><svg viewBox="0 0 8 8"><rect width="8" height="8" fill="#9333ea"/></svg></a><header><svg viewBox="0 0 8 8"><rect width="8" height="8" fill="#16a34a"/></svg></header>') },
  { name: 'SVG markup as it is written out: case, self-closing, entities, nested SVG, text', html: home('', '<header><SVG viewBox="0 0 8 8" preserveAspectRatio="xMidYMid"><defs><linearGradient id="g"><stop offset="0" stop-color="#0ea5e9"/></linearGradient></defs><rect width="8" height="8" fill="url(#g)"></rect><text x="1" y="5">A &amp; B &lt; C</text><svg x="1"><circle r="1" fill="#e11d48"/></svg><foreignObject><div class="x">html</div></foreignObject></SVG></header>') },
  { name: 'an SVG elsewhere is not used', html: home('', '<main><svg viewBox="0 0 8 8"><rect width="8" height="8" fill="#9333ea"/></svg></main>') },
  { name: 'a header image that works is used before the header SVG', html: home('', '<header><svg viewBox="0 0 8 8"><rect width="8" height="8" fill="#9333ea"/></svg><img src="/mark.svg"></header>'), files: { '/mark.svg': svgLogo('#ea580c') } },
  // Colors from the page's own CSS.
  { name: 'style elements in several places', html: home('<style>:root{--brand-primary:#2563eb;--radius:4px}</style><style media="print">:root{--color-secondary: #F59E0B}</style><noscript><style>:root{--in-head-noscript:#111827}</style></noscript>',
    '<style>.a{--accent:rgb(16, 185, 129);--ink:#17181C}</style><div><style>:root{--deep-highlight:rgba(219,39,119,.5)}</style></div><svg><style>.s{--in-svg:#0891b2}</style></svg><noscript><style>:root{--in-body-noscript:#65a30d}</style></noscript><template><style>:root{--in-template:#c026d3}</style></template><style></style><style>/* last */:root{--main-color:#abc}</style>') },
  { name: 'custom property names and values', html: home(`<style>:root{
    --primary:#111827; --brand:#E11D48; --main-accent:#0d9488; --text-primary:#1f2937; --primary-bg:#fef3c7; --primary-border:#a16207; --primary-foreground:#ffffff; --fg-brand:#be185d;
    --secondary:#7C3AED; --accent-text:#4338ca; --accent-bg:#fde68a; --highlight-border:#b45309; --highlight:#f43f5e80; --other:#0369a1; --gray:#6b7280; --white:#fff; --black:#000;
    --short:#0af; --eight:#11223344; --four:#abcd; --five:#abcde; --rgb-spaces:rgb( 12 , 34 , 56 ); --rgb-new:rgb(12 34 56 / 50%); --rgb-percent:rgb(10%, 20%, 30%); --named:rebeccapurple; --hsl:hsl(200 50% 50%); --var:var(--primary);
    --UPPER-BRAND:#0E7490;--no-space:#15803d;--spaced   :   #b91c1c ; color:#123456; background:--not-a-declaration;
  }</style>`) },
  // Where a <style> element may sit for its text to be read: each of these pages has one color, in one place.
  ...([
    ['in the head', '<style>:root{--brand:#2563eb}</style>', ''], ['in the body', '', '<div><p><style>:root{--brand:#2563eb}</style></p></div>'], ['in a noscript in the head', '<noscript><style>:root{--brand:#2563eb}</style></noscript>', ''],
    ['in a noscript in the body', '', '<noscript><style>:root{--brand:#2563eb}</style></noscript>'], ['in a template', '', '<template><style>:root{--brand:#2563eb}</style></template>'], ['in an SVG', '', '<svg><style>:root{--brand:#2563eb}</style></svg>'],
    ['with a media attribute', '<style media="print" type="text/css">:root{--brand:#2563eb}</style>', ''], ['in a comment', '<!-- <style>:root{--brand:#2563eb}</style> -->', ''], ['in a style attribute', '', '<div style="--brand:#2563eb">x</div>'],
    ['in a script', '<script>var css = ":root{--brand:#2563eb}";</script>', ''], ['inside a CDATA comment in a style element', '<style><!-- :root{--brand:#2563eb} --></style>', ''], ['after an unclosed style element', '<style>:root{--brand:#2563eb}', ''],
  ] as const).map(([where, head, body]) => ({ name: `one color, ${where}`, html: home(head, body) })),
  { name: 'a declaration cut in two by the end of a style element', html: home('<style>:root{--brand:#2563</style><style>eb;--accent:#f59e0b}</style>') },
  { name: 'the last declaration of one style element and the first of the next', html: home('<style>:root{--brand:#2563eb</style><style>--accent:#f59e0b}</style>') },
  { name: 'no colors anywhere', html: home('<style>body{margin:0}</style>') },
  { name: 'only neutral colors', html: home('<style>:root{--brand:#ffffff;--primary:#000;--accent:#808080;--main:#f8f8f8}</style><meta name="theme-color" content="#111111">') },
  { name: 'two colors too close to be primary and secondary', html: home('<style>:root{--brand:#2563eb;--accent:#2460e8;--other:#16a34a}</style>') },
  // Stylesheets: the first three links, and only on the page's own origin.
  { name: 'more than three stylesheet links, one on another origin', html: home('<link rel="stylesheet"><link rel="stylesheet" href=""><link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="https://cdn.example/b.css"><link rel="stylesheet" href="/c.css"><link rel="stylesheet" href="/d.css">'),
    files: { '/a.css': css(':root{--brand:#0f766e}'), 'https://cdn.example/b.css': css(':root{--brand:#dc2626}'), '/c.css': css(':root{--accent:#f59e0b}'), '/d.css': css(':root{--brand:#7c3aed;--accent:#2563eb}') } },
  { name: 'stylesheet links that are not exactly rel=stylesheet, relative addresses, a missing file', html: home('<link rel="stylesheet preload" href="/preload.css"><link rel="alternate stylesheet" href="/alternate.css"><link rel="STYLESHEET" href="/capitals.css"><link rel="stylesheet" href="css/relative.css?v=3"><link rel="stylesheet" href="/missing.css"><link rel="stylesheet" href="//brand.example/protocol-relative.css">', '<link rel="stylesheet" href="/in-body.css">'),
    files: { '/preload.css': css(':root{--brand:#111111}'), '/alternate.css': css(':root{--brand:#222222}'), '/capitals.css': css(':root{--brand:#be123c}'), '/css/relative.css?v=3': css(':root{--accent:#0891b2}'), '/protocol-relative.css': css(':root{--other:#65a30d}'), '/in-body.css': css(':root{--brand:#333333}') } },
  { name: 'a stylesheet is read to 300,000 characters', html: home('<link rel="stylesheet" href="/big.css">'), files: { '/big.css': css(`${'a{}'.repeat(74_990)}:root{--brand:#0f766e}${' '.repeat(30)}:root{--accent:#f59e0b}`) } },
  { name: 'inline CSS and stylesheets together: the page\'s own come first', html: home('<link rel="stylesheet" href="/site.css"><style>:root{--brand:#2563eb}</style>'), files: { '/site.css': css(':root{--brand:#dc2626;--accent:#16a34a}') } },
  // theme-color
  ...([['hex', '#0f766e'], ['rgb', 'rgb(15, 118, 110)'], ['a color name', 'teal'], ['three digits', '#0A8'], ['eight digits', '#0f766e80'], ['capitals and spaces', '  #0F766E  '], ['empty', '']] as const).map(([name, value]) => ({ name: `theme-color: ${name}`, html: home(`<meta name="theme-color" content="${value}">`) })),
  { name: 'theme-color: two of them, and one for dark mode', html: home('<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0c4a6e"><meta name="theme-color" content="#f97316">') },
  { name: 'theme-color: no content, under property, in capitals', html: home('<meta name="theme-color"><meta property="theme-color" content="#16a34a"><meta name="THEME-COLOR" content="#7c3aed">') },
  { name: 'theme-color after CSS primaries', html: home('<meta name="theme-color" content="#0f766e"><style>:root{--primary:#ffffff;--accent:#f59e0b}</style>') },
  // html lang
  ...['en-US', 'en_GB', 'EN-au', 'en', 'fr', 'fr-CA', 'pt-PT', 'pt', 'zh-TW', 'zh-Hant-HK', 'zh', 'es-MX', 'es', 'de-AT', 'ja', 'xx', ' en-GB ', 'en-GB-oxendict', '-'].map(lang => ({ name: `lang: "${lang}"`, html: home('', '', ` lang="${lang}"`) })),
  { name: 'lang: none', html: home('', '', '') },
  { name: 'lang: empty', html: home('', '', ' lang=""') },
  { name: 'lang: xml:lang only, and lang on body', html: doc('<title>Brand</title>', '', ' xml:lang="fr"').replace('<body>', '<body lang="de">') },
  { name: 'lang: LANG in capitals', html: home('', '', ' LANG="it"') },
  // Whole pages.
  { name: 'an empty document', html: '' },
  { name: 'text with no markup', html: 'Brand, in plain text. --brand:#2563eb' },
  { name: 'a fragment with no html element', html: '<link rel="icon" href="/fragment.svg"><style>:root{--brand:#0f766e}</style><header><svg viewBox="0 0 1 1"><path fill="#f59e0b"/></svg></header>' },
  { name: 'everything at once, on a www origin', origin: 'https://www.brand.example', html: doc(
    '<title>Northbeam</title><meta name="theme-color" content="#1F4D3A"><link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="icon" type="image/svg+xml" href="/brand/logo.svg" sizes="any"><link rel="apple-touch-icon" href="/apple-touch-icon.svg" sizes="180x180"><meta property="og:image" content="https://www.brand.example/og.png"><link rel="stylesheet" href="/assets/site.css"><style>:root{--brand-primary:#1F4D3A}</style>',
    '<header><a href="/" class="logo"><img src="/brand/logo.svg" alt="Northbeam logo"></a><nav><a href="/about">About</a></nav></header><main><h1>Northbeam</h1></main>', ' lang="en-GB"'),
    files: { '/brand/logo.svg': svgLogo('#1F4D3A', '<circle cx="46" cy="18" r="7" fill="#F2B544"/>'), '/apple-touch-icon.svg': svgLogo('#F2B544'), '/assets/site.css': css(':root{--color-primary:#1F4D3A;--color-secondary:#F2B544;--ink:#17181C}') } },
  { name: 'ordinary large page: blog index of 4,000 cards', html: blogIndex(4000), files: { '/logo.png': svgLogo('#2563eb'), '/site.css': css(':root{--accent:#f59e0b}') } },
  { name: 'ordinary large page: shop home page of 2,500 products', html: shopHome(2500) },
];
