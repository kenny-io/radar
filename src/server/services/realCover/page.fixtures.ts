// Test pages for real covers. Reduced to the parts the reader looks at, in the shape of a Next.js property site whose
// pictures come from its own media endpoint through its own image optimiser. Media ids are invented; nothing here was
// downloaded. Used by page.test.ts and index.test.ts only.

export const SITE = 'lived.ae';
export const DEFAULT_CARD = 'https://lived.ae/lived-social-preview.png';
const optimised = (media: string, w: number) => `/_next/image?url=${encodeURIComponent(media)}&amp;w=${w}&amp;q=75`;
const srcset = (media: string) => [640, 828, 1200, 1920].map(w => `${optimised(media, w)} ${w}w`).join(', ');
const head = (title: string, share = DEFAULT_CARD, more = '') => `<meta charset="utf-8"><title>${title} | Lived</title>
<meta property="og:title" content="${title}"><meta property="og:type" content="website"><meta property="og:site_name" content="Lived">
<meta property="og:image" content="${share}"><meta property="og:image:alt" content="${title}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${share}">
<link rel="icon" href="/favicon.ico">${more}`;
const chrome = (main: string) => `<body><header><a href="/"><img src="/lived-logo.svg" alt="Lived" width="96" height="28"></a><nav><a href="/explore">Explore</a><a href="/blog">Blog</a></nav></header>
<main>${main}</main>
<footer><img src="/app-store-badge.png" alt="Download the app" width="120" height="40"><a href="/privacy">Privacy</a></footer></body>`;
const breadcrumbs = (name: string) => JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: 'https://lived.ae/' }, { '@type': 'ListItem', position: 2, name, item: 'https://lived.ae/property/x' }] });
const reviews = `<section><h2>Reviews</h2><article><p>Quiet floors and quick repairs.</p><time datetime="2026-09-02">2 Sep 2026</time></article><article><p>The lifts are slow at peak hours.</p><time datetime="2026-08-11">11 Aug 2026</time></article></section>`;

export const HOME_URL = 'https://lived.ae/';
export const HOME = `<!doctype html><html lang="en"><head>${head('Lived — Honest reviews of where you live')}
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Lived', url: 'https://lived.ae', logo: 'https://lived.ae/lived-logo.png', image: 'https://lived.ae/office.jpg' })}</script></head>
${chrome('<h1>Honest reviews of where you live</h1><a href="/property/wasl-611-al-warsan">Wasl 611</a><a href="/property/princess-tower-dubai-marina">Princess Tower</a>')}</html>`;

/** The subject's page whose one photograph is tied to it only by alt text; the share image is the site-wide card,
 *  although its alt text names the building. */
export const WASL_URL = 'https://lived.ae/property/wasl-611-al-warsan';
export const WASL_MEDIA = '/api/media/7kq2mfx01ab.webp?bucket=properties&v=legacy';
export const WASL_PICTURE = 'https://lived.ae/_next/image?url=%2Fapi%2Fmedia%2F7kq2mfx01ab.webp%3Fbucket%3Dproperties%26v%3Dlegacy&w=1200&q=75';
export const WASL = `<!doctype html><html lang="en"><head>${head('Wasl 611 — Apartment in Al Warsan, Dubai')}
<script type="application/ld+json">${breadcrumbs('Wasl 611')}</script></head>
${chrome(`<h1>Wasl 611</h1><p>Staff accommodation in Al Warsan.</p>
<div class="gallery"><img alt="Wasl 611 · photo 1" loading="lazy" width="1200" height="800" decoding="async" srcset="${srcset(WASL_MEDIA)}" src="${optimised(WASL_MEDIA, 1920)}"></div>${reviews}`)}</html>`;

/** The subject's page that names it in structured data and gives its picture there; the page also has review
 *  <article> elements with dates, which a looser rule would read as "this is a blog post". */
export const PRINCESS_URL = 'https://lived.ae/property/princess-tower-dubai-marina';
export const PRINCESS_PICTURE = 'https://lived.ae/api/media/9zt4c0de1fg.jpg?bucket=properties';
export const PRINCESS = `<!doctype html><html lang="en"><head>${head('Princess Tower — Apartment in Dubai Marina, Dubai')}
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'ApartmentComplex', name: 'Princess Tower', image: PRINCESS_PICTURE, address: { '@type': 'PostalAddress', addressLocality: 'Dubai Marina' }, aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.1, reviewCount: 2 } })}</script>
<script type="application/ld+json">${breadcrumbs('Princess Tower')}</script></head>
${chrome(`<h1>Princess Tower</h1><p>A residential tower in Dubai Marina.</p>
<div class="gallery"><img alt="Princess Tower · photo 1" loading="lazy" width="740" height="1110" decoding="async" srcset="${srcset('/api/media/9zt4c0de1fg.jpg?bucket=properties')}" src="${optimised('/api/media/9zt4c0de1fg.jpg?bucket=properties', 1920)}"></div>${reviews}`)}</html>`;

/** A page for one block of the same development: its address starts with the subject's words, its name does not equal them. */
export const TOWER_B_URL = 'https://lived.ae/property/wasl-611-tower-b';
export const TOWER_B = `<!doctype html><html lang="en"><head>${head('Wasl 611 Tower B — Apartment in Al Warsan, Dubai')}</head>
${chrome('<h1>Wasl 611 Tower B</h1><img alt="Wasl 611 Tower B · photo 1" width="1200" height="800" src="/api/media/3hh8wq2zz0p.jpg?bucket=properties">')}</html>`;

/** A blog post about the subject: an article by its address and by its tags, never the subject's own page. */
export const REVIEW_POST_URL = 'https://lived.ae/blog/wasl-611-review';
export const REVIEW_POST = `<!doctype html><html lang="en"><head>${head('Wasl 611 review: what tenants say').replace('content="website"', 'content="article"')}
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'BlogPosting', headline: 'Wasl 611 review: what tenants say', name: 'Wasl 611', image: 'https://lived.ae/api/media/5tt1blog77x.png?bucket=blog' })}</script></head>
${chrome('<article><h1>Wasl 611 review: what tenants say</h1><img alt="Illustration of Wasl 611" width="1200" height="628" src="/api/media/5tt1blog77x.png?bucket=blog"><p>Tenants like the location.</p></article>')}</html>`;

/** A search-results page that lists the subject among others. */
export const LISTING_URL = 'https://lived.ae/explore/al-warsan';
export const LISTING = `<!doctype html><html lang="en"><head>${head('Wasl 611')}
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'CollectionPage', name: 'Wasl 611' }, { '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Wasl 611' }] }] })}</script></head>
${chrome('<h1>Wasl 611</h1><img alt="Wasl 611" width="600" height="400" src="/api/media/1aa2listing3.jpg?bucket=properties">')}</html>`;

/** Build a subject page with chosen pictures, for the cases the pages above do not have. */
export function subjectPage(o: { name?: string; title?: string; share?: string; main?: string; ld?: unknown; headMore?: string } = {}): string {
  const name = o.name ?? 'Wasl 611';
  return `<!doctype html><html lang="en"><head>${head(o.title ?? `${name} — Apartment in Al Warsan, Dubai`, o.share ?? DEFAULT_CARD, o.headMore)}
${o.ld ? `<script type="application/ld+json">${JSON.stringify(o.ld)}</script>` : ''}</head>${chrome(`<h1>${name}</h1>${o.main ?? ''}`)}</html>`;
}
