// Reading a page of the business's own site: what it calls its subject, which pictures are its own, and which of
// them it ties to the subject. Pure; the pages are in page.fixtures.ts.
import { describe, expect, it } from 'vitest';
import { GENERIC_PICTURE_WORDS, altNamesSubject, listingPath, nameTokens, namesSubject, ownerPictures, readPage, shareImages, shareKey, slugExtra, slugTokens, subjectPictures, titleLead, type PageFacts } from './page';
import { DEFAULT_CARD, HOME, HOME_URL, LISTING, LISTING_URL, PRINCESS, PRINCESS_PICTURE, PRINCESS_URL, REVIEW_POST, REVIEW_POST_URL, SITE, TOWER_B, TOWER_B_URL, WASL, WASL_PICTURE, WASL_URL, subjectPage } from './page.fixtures';

const read = (html: string, url = WASL_URL, domain = SITE) => readPage(html, url, domain);
const urls = (list: { url: string }[]) => list.map(p => p.url);
const st = (name: string) => nameTokens(name);

describe('nameTokens', () => {
  it.each([
    ['Wasl 611', ['wasl', '611']],
    ['  WASL-611,  Al Warsan ', ['wasl', '611', 'al', 'warsan']],
    ['Café Müller & Söhne', ['cafe', 'muller', 'and', 'sohne']],
    ['Ｗａｓｌ　６１１', ['wasl', '611']], // full-width letters and digits
    ['برج خليفة', ['برج', 'خليفة']],
    ['بُرْج خَلِيفَة', ['برج', 'خليفة']], // with vowel marks
    ['The Torch (Dubai Marina)', ['the', 'torch', 'dubai', 'marina']],
    ['iPhone 15 Pro Max', ['iphone', '15', 'pro', 'max']],
    ['', []], ['—·|', []],
  ])('%s', (name, words) => { expect(nameTokens(name)).toEqual(words); });
  it('keeps digits as written: 61 and 611 are different words, and no word is dropped or stemmed', () => {
    expect(nameTokens('Wasl 61')).not.toEqual(nameTokens('Wasl 611'));
    expect(nameTokens('The Towers')).toEqual(['the', 'towers']);
  });
});

describe('titleLead', () => {
  it.each([
    ['Wasl 611 — Apartment in Al Warsan, Dubai | Lived', 'Wasl 611'],
    ['Princess Tower – Dubai Marina', 'Princess Tower'],
    ['Harbour House - Northbeam', 'Harbour House'],
    ['Princess Tower | Lived', 'Princess Tower'],
    ['Wasl 611 · Lived', 'Wasl 611'], ['Wasl 611 • Lived', 'Wasl 611'],
    ['Wasl 611: reviews and ratings', 'Wasl 611'],
    ['Princess Tower, Dubai Marina', 'Princess Tower'],
    ['Wasl 611, Al Warsan — Lived', 'Wasl 611'], // the first separator wins, whichever it is
    ['Self-catering in Harbour House', 'Self-catering in Harbour House'], // a hyphen inside a word is not a separator
    ['  Wasl   611  ', 'Wasl 611'], ['', ''],
  ])('%s → %s', (title, lead) => { expect(titleLead(title)).toBe(lead); });
});

describe('what a page calls its subject', () => {
  it('its first h1 that has text, and the names of structured-data entities that are not generic; never its title', () => {
    expect(read(WASL)).toMatchObject({ h1: 'Wasl 611', entityNames: [] }); // the breadcrumb list and its items are not names
    expect(read(PRINCESS, PRINCESS_URL)).toMatchObject({ h1: 'Princess Tower', entityNames: ['Princess Tower'] });
    expect(read(TOWER_B, TOWER_B_URL)).toMatchObject({ h1: 'Wasl 611 Tower B', entityNames: [] });
    expect(read(HOME, HOME_URL)).toMatchObject({ h1: 'Honest reviews of where you live', entityNames: [] }); // the Organization is the site, not a subject
    expect(read('<html><head><title>Wasl 611 — Lived</title><meta property="og:title" content="Wasl 611"></head><body><p>No heading.</p></body></html>')).toMatchObject({ h1: '', entityNames: [] });
    expect(read('<html><body><h1><img src="/logo.png" alt="Lived"></h1><h1>  Wasl   611 </h1></body></html>').h1).toBe('Wasl 611'); // an h1 with no text names nothing
  });
  it.each(['Organization', 'WebSite', 'WebPage', 'BreadcrumbList', 'ListItem', 'ItemList', 'FAQPage', 'Question', 'Answer', 'Person', 'ImageObject', 'SearchAction',
    'Review', 'Rating', 'AggregateRating', 'Comment', 'Offer', 'AggregateOffer', 'VideoObject', 'MediaObject', 'AudioObject'])('a %s entity gives neither a name nor a picture', type => {
    const page = read(subjectPage({ name: 'Somewhere Else', title: 'Somewhere Else', ld: { '@context': 'https://schema.org', '@type': type, name: 'Wasl 611', image: 'https://lived.ae/api/media/0generic.jpg' } }));
    expect(page).toMatchObject({ h1: 'Somewhere Else', entityNames: [] });
    expect(page.pictures.filter(p => p.from === 'ld')).toEqual([]);
  });
  it('reads every JSON-LD block, @graph and arrays included, with schema.org type addresses, and ignores a block that does not parse', () => {
    const page = read(subjectPage({ name: 'A', title: 'A', headMore: [
      '<script type="application/ld+json">{ not json</script>',
      `<script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': ['Place', 'Residence'], name: 'Wasl 611', image: ['/api/media/g1.jpg', { '@type': 'ImageObject', url: '/api/media/g2.jpg' }, '/api/media/g3.jpg'] }, { '@type': 'WebPage', name: 'ignored' }] })}</script>`,
      `<script type="application/ld+json">${JSON.stringify([{ '@type': 'https://schema.org/Product', name: 'Wasl 611 Key Fob', image: { '@type': 'ImageObject', contentUrl: 'https://lived.ae/api/media/g4.png' } }])}</script>`,
    ].join('') }));
    expect(page.entityNames).toEqual(['Wasl 611', 'Wasl 611 Key Fob']);
    // The first two pictures of each entity, in document order, each with the entity it belongs to.
    expect(page.pictures.filter(p => p.from === 'ld')).toEqual([
      { url: 'https://lived.ae/api/media/g1.jpg', alt: '', from: 'ld', of: 'Wasl 611' }, { url: 'https://lived.ae/api/media/g2.jpg', alt: '', from: 'ld', of: 'Wasl 611' },
      { url: 'https://lived.ae/api/media/g4.png', alt: '', from: 'ld', of: 'Wasl 611 Key Fob' },
    ]);
  });
  it('a type that is partly generic is generic', () => {
    expect(read(subjectPage({ name: 'A', title: 'A', ld: { '@type': ['Place', 'Organization'], name: 'Wasl 611', image: '/x.jpg' } })).entityNames).toEqual([]);
  });
});

describe('whose page it is (decision D14)', () => {
  const html = (o: { h1?: string; title?: string; ld?: unknown }) => `<html><head><title>${o.title ?? ''}</title>${o.ld ? `<script type="application/ld+json">${JSON.stringify(o.ld)}</script>` : ''}</head><body>${o.h1 !== undefined ? `<h1>${o.h1}</h1>` : ''}</body></html>`;
  const confirms = (o: Parameters<typeof html>[0], subject = 'Harbour House') => namesSubject(read(html(o), 'https://lived.ae/places/x'), subject);
  it('the h1 must be the subject’s name, word for word', () => {
    expect(confirms({ h1: 'Harbour House' })).toBe(true);
    expect(confirms({ h1: ' HARBOUR-HOUSE ' })).toBe(true);
    expect(confirms({ h1: 'Harbour House Annex' })).toBe(false);
    expect(confirms({ h1: 'The Harbour House' })).toBe(false);
    expect(confirms({ h1: 'Harbour House: our honest review' })).toBe(false);
  });
  it('the title never confirms a page, whatever it leads with (QA Q3, Q4, Q5)', () => {
    for (const title of ['Harbour House - Annex | Stays', 'Harbour House, Annex wing', 'Harbour House: our honest review', 'Harbour House', 'Harbour House — Stays']) {
      expect(confirms({ title, h1: 'Harbour House Annex' }), title).toBe(false);
      expect(confirms({ title }), title).toBe(false); // nor on a page with no h1 and no structured data
    }
  });
  it('an h1 that names something else is not overruled by structured data', () => {
    expect(confirms({ h1: 'Harbour House Annex', ld: { '@type': 'Place', name: 'Harbour House' } })).toBe(false);
    expect(confirms({ h1: 'Places to stay', ld: { '@type': 'Place', name: 'Harbour House' } })).toBe(false);
  });
  it('only a page with no h1 at all may be confirmed by structured data: an entity that is not generic, named exactly', () => {
    expect(confirms({ ld: { '@type': 'Place', name: 'Harbour House' } })).toBe(true);
    expect(confirms({ ld: { '@type': 'Place', name: 'Harbour House Annex' } })).toBe(false);
    for (const type of ['Review', 'Organization', 'WebPage', 'Offer', 'VideoObject']) expect(confirms({ ld: { '@type': type, name: 'Harbour House' } }), type).toBe(false);
    expect(confirms({})).toBe(false);
  });
});

describe('an alt text that names the subject and nothing else (decision D15)', () => {
  const ties = (alt: string, subject = 'Wasl 611') => altNamesSubject(alt, st(subject));
  it.each(['Wasl 611', 'Wasl 611 · photo 1', 'Photo of Wasl 611', 'wasl-611', 'Exterior view of Wasl 611', 'The Wasl 611 building', 'Wasl 611 – image 12 of 30', 'Photo 3: Wasl 611', 'Main picture of the Wasl 611 building, front view'])('ties: %s', alt => { expect(ties(alt)).toBe(true); });
  it.each([
    'Wasl 611 Tower B', 'Wasl 611 Tower B · photo 1', 'Wasl 6110', '611 Wasl', 'Wasl', 'Property thumbnail 1', '', 'Photo 1',
    'The old mill, five minutes from Wasl 611', 'View from Wasl 611 of the old mill', 'Chart of Wasl 611 prices by month', 'Wasl 611 opening party', 'Marina Gate 1 — Wasl 611',
    'Illustration of Wasl 611', 'illustration: Wasl 611',
  ])('does not tie: %s', alt => { expect(ties(alt)).toBe(false); });
  it('a neighbour whose name starts with the subject’s is not the subject (QA Q1, Q21, Q23)', () => {
    for (const alt of ['Harbour House Annex', 'Harbour House Annex · photo 1', 'Harbour House Annex photo']) expect(ties(alt, 'Harbour House'), alt).toBe(false);
    for (const alt of ['Harbour House', 'Harbour House · photo 1', 'Photo of Harbour House']) expect(ties(alt, 'Harbour House'), alt).toBe(true);
    expect(ties('Harbour House Annex · photo 1', 'Harbour House Annex')).toBe(true);
  });
  it('a numeral straight after the name is read as part of a longer name', () => {
    expect(ties('Marina Gate 2', 'Marina Gate')).toBe(false);
    expect(ties('iPhone 15', 'iPhone')).toBe(false);
    expect(ties('Tower 10', 'Tower 1')).toBe(false);
    expect(ties('Marina Gate · photo 2', 'Marina Gate')).toBe(true);
    expect(ties('2 of 9: Marina Gate', 'Marina Gate')).toBe(true);
    expect(ties('Marina Gate 2 photo 1', 'Marina Gate 2')).toBe(true);
  });
  it('the list of generic picture words is short, and has no word a place or product is named with', () => {
    expect(GENERIC_PICTURE_WORDS.size).toBeLessThanOrEqual(20);
    for (const word of ['tower', 'house', 'annex', 'gate', 'review', 'lobby', 'pool', 'old', 'new', 'and', 'in', 'at', 'from', 'near']) expect(GENERIC_PICTURE_WORDS.has(word), word).toBe(false);
  });
});

describe('article and listing pages', () => {
  it('a subject page with dated review <article> elements is neither', () => {
    expect(read(PRINCESS, PRINCESS_URL)).toMatchObject({ article: false, listing: false });
    expect(read(WASL)).toMatchObject({ article: false, listing: false });
  });
  it('an article by og:type, by structured data or by its address', () => {
    expect(read(REVIEW_POST, REVIEW_POST_URL).article).toBe(true);
    expect(read(subjectPage({}), 'https://lived.ae/blog/why-wasl-611-is-popular').article).toBe(true);
    expect(read(subjectPage({ ld: { '@type': 'NewsArticle', headline: 'x' } })).article).toBe(true);
    expect(read(subjectPage({ headMore: '<meta property="og:type" content="Article">' }).replace('content="website"', 'content="article"')).article).toBe(true);
  });
  it('a listing by its address or by structured data, the home page included', () => {
    expect(read(LISTING, LISTING_URL).listing).toBe(true);
    expect(read(HOME, HOME_URL).listing).toBe(true);
    expect(read(subjectPage({}), 'https://lived.ae/blog/').listing).toBe(true);
    for (const type of ['CollectionPage', 'SearchResultsPage', 'Blog', 'ItemList']) expect(read(subjectPage({ ld: { '@type': type } })).listing).toBe(true);
  });
  it('tag, category, topic, author, search and archive pages are listings by their path (decision D17, QA Q18)', () => {
    for (const path of ['/tag/harbour-house', '/tags/harbour-house', '/category/places/harbour-house', '/categories/x', '/topic/wasl-611', '/topics/wasl-611', '/author/sam', '/authors/sam', '/search', '/Search/wasl-611', '/archive/2026/11', '/archives/wasl-611', '/en/tag/wasl-611/']) {
      expect(listingPath(path), path).toBe(true);
      expect(read(subjectPage({}), 'https://lived.ae' + path).listing, path).toBe(true);
    }
    for (const path of ['/property/wasl-611', '/places/harbour-house', '/tagline', '/heritage/wasl-611', '/research/wasl-611', '/authority-house', '/p/12345']) expect(listingPath(path), path).toBe(false);
    expect(listingPath('/')).toBe(true); expect(listingPath('/blog/')).toBe(true);
  });
});

describe('the pictures of a page', () => {
  it('own-site pictures in order: structured data, then <img>, then share images', () => {
    const page = read(PRINCESS, PRINCESS_URL);
    expect(page.pictures).toEqual([
      { url: PRINCESS_PICTURE, alt: '', from: 'ld', of: 'Princess Tower' },
      { url: 'https://lived.ae/_next/image?url=%2Fapi%2Fmedia%2F9zt4c0de1fg.jpg%3Fbucket%3Dproperties&w=1200&q=75', alt: 'Princess Tower · photo 1', from: 'img' },
      { url: DEFAULT_CARD, alt: '', from: 'share' },
    ]);
    expect(page.offSite).toEqual([]);
  });
  it('takes the smallest srcset candidate at least 1200 wide, through the site’s own optimiser', () => {
    expect(read(WASL).pictures).toEqual([{ url: WASL_PICTURE, alt: 'Wasl 611 · photo 1', from: 'img' }, { url: DEFAULT_CARD, alt: '', from: 'share' }]);
  });
  const img = (attrs: string, wrap = (x: string) => x) => read(subjectPage({ share: '', main: wrap(`<img alt="a" ${attrs}>`) })).pictures.filter(p => p.from === 'img').map(p => p.url.replace('https://lived.ae', ''));
  it.each([
    ['the largest when none reaches 1200', 'srcset="/a-400.jpg 400w, /a-800.jpg 800w, /a-640.jpg 640w" src="/a.jpg"', ['/a-800.jpg']],
    ['the smallest at or over 1200', 'srcset="/a-2400.jpg 2400w, /a-1600.jpg 1600w, /a-800.jpg 800w" src="/a.jpg"', ['/a-1600.jpg']],
    ['src when the candidates have no widths', 'srcset="/a.jpg 1x, /a@2x.jpg 2x" src="/a.jpg"', ['/a.jpg']],
    ['an address with commas in it', 'srcset="/cdn-cgi/w_800,q_80/a.jpg 800w, /cdn-cgi/w_1600,q_80/a.jpg 1600w"', ['/cdn-cgi/w_1600,q_80/a.jpg']],
    ['data-src when src is an inline placeholder', 'src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="/lazy.jpg"', ['/lazy.jpg']],
    ['data-lazy-src when src is empty', 'src="" data-lazy-src="/lazy2.jpg"', ['/lazy2.jpg']],
    ['data-original', 'data-original="/lazy3.jpg"', ['/lazy3.jpg']],
    ['data-srcset by the same rule', 'src="data:image/svg+xml,%3Csvg/%3E" data-srcset="/l-600.jpg 600w, /l-1400.jpg 1400w, /l-2000.jpg 2000w"', ['/l-1400.jpg']],
    ['nothing when there is only an inline placeholder', 'src="data:image/png;base64,AAAA"', []],
  ])('<img>: %s', (_name, attrs, expected) => { expect(img(attrs)).toEqual(expected); });
  it('<picture>: sources are candidates too, except a source of a type Radar refuses', () => {
    const picture = (sources: string) => (x: string) => `<picture>${sources}${x}</picture>`;
    expect(img('src="/p.jpg" srcset="/p-800.jpg 800w"', picture('<source type="image/avif" srcset="/p-1600.avif 1600w"><source type="image/webp" srcset="/p-1200.webp 1200w, /p-2400.webp 2400w">'))).toEqual(['/p-1200.webp']);
    expect(img('src="/p.jpg"', picture('<source srcset="/p-1000.jpg 1000w, /p-1300.jpg 1300w">'))).toEqual(['/p-1300.jpg']);
    expect(img('src="/p.jpg"', picture('<source type="image/avif" srcset="/p-1600.avif 1600w">'))).toEqual(['/p.jpg']);
  });
  it('skips pictures in the header, nav, footer and asides, hidden and decorative ones, and ones declared small', () => {
    const page = read(subjectPage({ share: '', main: [
      '<nav><img src="/in-nav.jpg" alt="Wasl 611"></nav><aside><img src="/in-aside.jpg" alt="Wasl 611"></aside>',
      '<img src="/hidden.jpg" alt="Wasl 611" aria-hidden="true"><img src="/decor.jpg" alt="Wasl 611" role="presentation">',
      '<img src="/thumb.jpg" alt="Wasl 611" width="199" height="600"><img src="/strip.jpg" alt="Wasl 611" width="1200" height="120"><img src="/small-px.jpg" alt="Wasl 611" width="150px">',
      '<img src="/fluid.jpg" alt="Wasl 611" width="100%"><img src="/exact.jpg" alt="Wasl 611" width="200" height="200"><img src="/unsized.jpg" alt="Wasl 611">',
    ].join('') }));
    expect(urls(page.pictures)).toEqual(['https://lived.ae/fluid.jpg', 'https://lived.ae/exact.jpg', 'https://lived.ae/unsized.jpg']); // the header logo and the footer badge of every page are gone too
  });
  it('skips files that are not pictures of anything by their name or format', () => {
    const names = ['/img/logo.png', '/img/site-logo-dark.png', '/favicon.png', '/icons/icon_512.png', '/sprite.png', '/img/placeholder.jpg', '/u/avatar-12.jpg', '/img/default.jpg', '/img/default-og.png', '/a.svg', '/a.gif', '/a.ico', '/a.avif', '/A.SVG?v=2'];
    const kept = ['/img/logotype-history.jpg', '/img/iconic-tower.jpg', '/img/defaulted.jpg', '/logo/wasl-611.jpg', '/img/wasl-611.jpeg', '/img/wasl-611.webp'];
    const page = read(subjectPage({ share: '/img/default-share.png', main: [...names, ...kept].map(src => `<img src="${src}" alt="Wasl 611">`).join(''), ld: { '@type': 'Place', name: 'Wasl 611', image: ['/brand/logo.png', '/img/wasl-611-front.jpg'] } }));
    expect(urls(page.pictures)).toEqual(['https://lived.ae/img/wasl-611-front.jpg', ...kept.map(k => 'https://lived.ae' + k)]);
  });
  it('never lists a picture on another host, and records the hosts it left out', () => {
    const page = read(subjectPage({ share: 'https://cdn.other.com/card.png', ld: { '@type': 'Place', name: 'Wasl 611', image: 'https://images.other.net/wasl.jpg' }, main: [
      '<img src="https://cdn.other.com/wasl-611.jpg" alt="Wasl 611">', '<img src="//cdn.other.com/wasl-611-b.jpg" alt="Wasl 611">', '<img src="https://lived.ae.evil.com/wasl.jpg" alt="Wasl 611">',
      '<img src="https://notlived.ae/wasl.jpg" alt="Wasl 611">', '<img src="https://user:pw@lived.ae/wasl.jpg" alt="Wasl 611">', '<img src="https://lived.ae:8443/wasl.jpg" alt="Wasl 611">',
      '<img src="https://cdn.other.com/logo.svg" alt="logo">', '<img src="http://media.lived.ae/wasl-own.jpg" alt="Wasl 611">', '<img src="javascript:alert(1)" alt="Wasl 611">',
    ].join('') }));
    expect(page.pictures).toEqual([{ url: 'https://media.lived.ae/wasl-own.jpg', alt: 'Wasl 611', from: 'img' }]); // a subdomain, upgraded to https
    expect(page.offSite).toEqual(['images.other.net', 'cdn.other.com', 'lived.ae.evil.com', 'notlived.ae']);
  });
  it('reads no more than the first 40 <img> elements', () => {
    const page = read(subjectPage({ share: '', main: Array.from({ length: 60 }, (_, i) => `<img src="/g/${i}.jpg" alt="Wasl 611">`).join('') }));
    expect(page.pictures).toHaveLength(39); // the header logo is the first of the 40
  });
  it('share images: every tag that carries one, own-site only, each address once', () => {
    const html = subjectPage({ share: '/card.png', headMore: '<meta property="og:image:secure_url" content="https://lived.ae/card-secure.png"><meta name="twitter:image:src" content="/card-tw.png"><link rel="image_src" href="/card-link.png"><meta property="og:image" content="https://cdn.other.com/card.png">' });
    expect(shareImages(html, WASL_URL, SITE)).toEqual(['https://lived.ae/card.png', 'https://lived.ae/card-secure.png', 'https://lived.ae/card-tw.png', 'https://lived.ae/card-link.png']);
    expect(urls(read(html).pictures.filter(p => p.from === 'share'))).toEqual(['https://lived.ae/card.png', 'https://lived.ae/card-secure.png', 'https://lived.ae/card-tw.png', 'https://lived.ae/card-link.png']);
    expect(shareImages(HOME, HOME_URL, SITE)).toEqual([DEFAULT_CARD]);
  });
});

describe('which pictures the page ties to the subject', () => {
  const page = (o: Parameters<typeof subjectPage>[0]) => read(subjectPage(o));
  it('structured data of that entity first, then alt text that names it and nothing else; never a share image', () => {
    const p = page({ share: '/wasl-card.png', ld: [{ '@type': 'Place', name: 'Wasl 611', image: '/ld-wasl.jpg' }, { '@type': 'Place', name: 'Wasl 611 Tower B', image: '/ld-tower-b.jpg' }, { '@type': 'Product', image: '/ld-unnamed.jpg' }],
      main: '<img src="/other.jpg" alt="Property thumbnail 1"><img src="/gate.jpg" alt="Front gate of WASL-611, Al Warsan"><img src="/alt-wasl.jpg" alt="Exterior view of WASL-611"><img src="/ld-wasl.jpg" alt="Wasl 611">' });
    expect(subjectPictures(p, 'Wasl 611').map(x => [x.from, x.url.replace('https://lived.ae', '')])).toEqual([['ld', '/ld-wasl.jpg'], ['img', '/alt-wasl.jpg']]);
    // The owner action goes on to everything else on the page: the other structured-data pictures, the share image, the other <img>.
    expect(urls(ownerPictures(p, 'Wasl 611')).map(u => u.replace('https://lived.ae', ''))).toEqual(['/ld-wasl.jpg', '/alt-wasl.jpg', '/ld-tower-b.jpg', '/ld-unnamed.jpg', '/wasl-card.png', '/other.jpg', '/gate.jpg']);
    // With no subject there is nothing to prefer: structured data, share, then <img>, no address twice.
    expect(urls(ownerPictures(p, null)).map(u => u.replace('https://lived.ae', ''))).toEqual(['/ld-wasl.jpg', '/ld-tower-b.jpg', '/ld-unnamed.jpg', '/wasl-card.png', '/other.jpg', '/gate.jpg', '/alt-wasl.jpg']);
  });
  it('the two real page shapes', () => {
    expect(subjectPictures(read(PRINCESS, PRINCESS_URL), 'Princess Tower').map(p => p.from)).toEqual(['ld', 'img']);
    expect(subjectPictures(read(PRINCESS, PRINCESS_URL), 'Princess Tower')[0].url).toBe(PRINCESS_PICTURE);
    expect(subjectPictures(read(WASL), 'Wasl 611').map(p => [p.from, p.url])).toEqual([['img', WASL_PICTURE]]);
  });
  it('an empty subject ties nothing', () => { expect(subjectPictures(read(WASL), ' — ')).toEqual([]); });
  it('a share image is never tied to the subject, whatever it is and whatever its alt says (decision D16; QA Q6, Q7, Q8, Q20)', () => {
    for (const share of ['https://lived.ae/share.png', 'https://lived.ae/lived-social-preview.png?v=2', 'https://www.lived.ae/lived-social-preview.png', 'https://lived.ae/property/wasl-611-al-warsan/opengraph-image?3f2a', 'https://lived.ae/api/og/wasl-611.jpg']) {
      const p = page({ share, headMore: '<link rel="image_src" href="/wasl-611-own.jpg"><meta name="twitter:image:src" content="/wasl-611-tw.jpg">' });
      expect(p.pictures.filter(x => x.from === 'share').length).toBeGreaterThan(0);
      expect(subjectPictures(p, 'Wasl 611'), share).toEqual([]);
    }
  });
  it('the subject’s own photo is taken, not a neighbour’s card that comes first (QA Q21)', () => {
    const p = read('<html><body><h1>Harbour House</h1><div class="featured"><img src="/media/annex.png" alt="Harbour House Annex" width="800" height="600"></div><img src="/media/hh.png" alt="Harbour House · photo 1" width="1600" height="900"></body></html>', 'https://lived.ae/places/harbour-house');
    expect(urls(subjectPictures(p, 'Harbour House'))).toEqual(['https://lived.ae/media/hh.png']);
  });
  it('the right page with only a neighbour’s card, a view of something else, or cards of an area: nothing is tied (QA Q1, Q2, Q9)', () => {
    const tiedOn = (body: string, subject: string) => urls(subjectPictures(read(`<html><body><h1>${subject}</h1>${body}</body></html>`, 'https://lived.ae/places/x'), subject));
    expect(tiedOn('<img src="/media/hh.png" alt="Photo 1" width="1600" height="900"><section><h2>Similar places</h2><img src="/media/annex.png" alt="Harbour House Annex · photo 1" width="800" height="600"></section>', 'Harbour House')).toEqual([]);
    expect(tiedOn('<img src="/media/mill.png" alt="The old mill, five minutes from Harbour House" width="1600" height="900">', 'Harbour House')).toEqual([]);
    expect(tiedOn('<ul><li><img src="/media/gate.png" alt="Marina Gate 1 — Dubai Marina" width="800" height="600"></li><li><img src="/media/jbr.png" alt="Sadaf 4 — Dubai Marina" width="800" height="600"></li></ul>', 'Dubai Marina')).toEqual([]);
  });
  it('a review of the subject, with the reviewer’s photo, gives neither the name nor the picture (QA Q10)', () => {
    const p = read(`<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'Review', name: 'Harbour House', image: 'https://lived.ae/media/reviewer.png' })}</script></head><body><h1>Harbour House</h1></body></html>`, 'https://lived.ae/places/harbour-house');
    expect(p.entityNames).toEqual([]); expect(p.pictures).toEqual([]);
    expect(subjectPictures(p, 'Harbour House')).toEqual([]);
  });
});

describe('what the owner action tries on a page', () => {
  it('a structured-data picture takes the alt text of the <img> with the same address (decision D19)', () => {
    const p = read(`<html><head><meta property="og:image" content="/media/card.png"><script type="application/ld+json">${JSON.stringify({ '@type': 'Place', name: 'Harbour House', image: ['https://lived.ae/media/harbour-house.png', 'http://lived.ae/media/side.png#x', '/media/no-img.png'] })}</script></head>
      <body><h1>Harbour House</h1><img src="/media/harbour-house.png" alt="Harbour House · photo 1" width="1600" height="900"><img src="/media/side.png" alt=""><img src="/media/side.png" alt="The side entrance"><img src="/media/card.png" alt="Share card"></body></html>`, 'https://lived.ae/places/harbour-house');
    expect(p.pictures.filter(x => x.from === 'ld').map(x => x.alt)).toEqual(['', '']); // as read, a structured-data picture has no alt (two per entity are read)
    const byUrl = (subject: string | null) => Object.fromEntries(ownerPictures(p, subject).map(x => [x.url.replace('https://lived.ae', ''), [x.from, x.alt]]));
    expect(byUrl(null)).toEqual({ '/media/harbour-house.png': ['ld', 'Harbour House · photo 1'], '/media/side.png': ['ld', 'The side entrance'], '/media/card.png': ['share', 'Share card'] });
    expect(byUrl('Harbour House')['/media/harbour-house.png']).toEqual(['ld', 'Harbour House · photo 1']);
    // A picture that appears nowhere as an <img> has no alt of its own.
    const lone = read(`<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'Place', name: 'Harbour House', image: '/media/no-img.png' })}</script></head><body><img src="/media/other.png" alt="Something else"></body></html>`, 'https://lived.ae/p');
    expect(ownerPictures(lone, null).map(x => x.alt)).toEqual(['', 'Something else']);
  });
  it('share images are compared with the home page’s by host without www. and path, not by query string (decision D16)', () => {
    expect(shareKey('https://lived.ae/og.png?v=2')).toBe(shareKey('https://lived.ae/og.png'));
    expect(shareKey('https://www.lived.ae/og.png')).toBe(shareKey('https://lived.ae/og.png'));
    expect(shareKey('https://lived.ae/opengraph-image?91bc')).toBe('lived.ae/opengraph-image');
    expect(shareKey('https://lived.ae/places/harbour-house/opengraph-image?3f2a')).not.toBe(shareKey('https://lived.ae/opengraph-image?91bc'));
    expect(shareKey('https://media.lived.ae/og.png')).not.toBe(shareKey('https://lived.ae/og.png'));
    expect(shareKey('https://lived.ae/share.png')).not.toBe(shareKey('https://lived.ae/og.png'));
  });
});

describe('near misses the rules must reject (architecture §4.4)', () => {
  const tied = (p: PageFacts, subject: string) => subjectPictures(p, subject);
  it('Wasl 61 is not Wasl 611: the address does not qualify, the page does not name it, no picture is tied to it', () => {
    expect(slugTokens(WASL_URL)).toEqual(['wasl', '611', 'al', 'warsan']);
    expect(slugExtra(WASL_URL, st('Wasl 61'))).toBeNull();
    expect(slugExtra(WASL_URL, st('Wasl 611'))).toBe(2);
    expect(namesSubject(read(WASL), 'Wasl 61')).toBe(false);
    expect(tied(read(WASL), 'Wasl 61')).toEqual([]);
    expect(namesSubject(read(WASL), 'Wasl 611')).toBe(true);
  });
  it('a page for "Wasl 611 Tower B" qualifies by its address and is not confirmed for "Wasl 611"', () => {
    expect(slugExtra(TOWER_B_URL, st('Wasl 611'))).toBe(2);
    expect(namesSubject(read(TOWER_B, TOWER_B_URL), 'Wasl 611')).toBe(false);
    expect(namesSubject(read(TOWER_B, TOWER_B_URL), 'Wasl 611 Tower B')).toBe(true);
  });
  it('Marina Tower is not Princess Tower in Dubai Marina, and Princess Tower is not Marina Tower', () => {
    expect(slugExtra(PRINCESS_URL, st('Marina Tower'))).toBeNull();
    expect(slugExtra('https://lived.ae/property/marina-tower', st('Princess Tower'))).toBeNull();
    expect(namesSubject(read(PRINCESS, PRINCESS_URL), 'Marina Tower')).toBe(false);
    expect(slugExtra(PRINCESS_URL, st('Princess Tower'))).toBe(2);
    expect(namesSubject(read(PRINCESS, PRINCESS_URL), 'Princess Tower')).toBe(true);
  });
  it('a blog post that mentions the subject does not qualify by its address', () => {
    expect(slugExtra('https://lived.ae/blog/why-wasl-611-is-popular', st('Wasl 611'))).toBeNull();
  });
  it('a blog post whose address starts with the subject is an article, and does not name it exactly', () => {
    expect(slugExtra(REVIEW_POST_URL, st('Wasl 611'))).toBe(1);
    const post = read(REVIEW_POST, REVIEW_POST_URL);
    expect(post.article).toBe(true);
    // Its structured data even claims the bare name, and its h1 does not; either way it is an article.
    expect(post).toMatchObject({ h1: 'Wasl 611 review: what tenants say', entityNames: ['Wasl 611'] });
    expect(namesSubject(post, 'Wasl 611')).toBe(false);
    expect(read(subjectPage({ name: 'Dubai Marina vs JBR', title: 'Dubai Marina vs JBR' }), 'https://lived.ae/blog/dubai-marina-vs-jbr').article).toBe(true);
  });
  it('the right page, a picture whose alt text does not name the subject', () => {
    expect(tied(read(subjectPage({ main: '<img src="/api/media/1thumb.jpg" alt="Property thumbnail 1" width="1200" height="800">' })), 'Wasl 611')).toEqual([]);
    expect(tied(read(subjectPage({ main: '<img src="/api/media/1thumb.jpg" alt="" width="1200" height="800"><img src="/api/media/2thumb.jpg" width="1200" height="800">' })), 'Wasl 611')).toEqual([]);
    expect(tied(read(subjectPage({ main: '<img src="/api/media/1thumb.jpg" alt="Wasl 6110 lobby" width="1200" height="800"><img src="/api/media/2.jpg" alt="611 Wasl" width="1200" height="800">' })), 'Wasl 611')).toEqual([]);
  });
  it('the right page, a share image equal to the home page’s: never tied, though its alt text names the building', () => {
    const page = read(WASL);
    expect(urls(page.pictures.filter(p => p.from === 'share'))).toEqual([DEFAULT_CARD]);
    expect(shareImages(HOME, HOME_URL, SITE)).toContain(DEFAULT_CARD);
    expect(subjectPictures(page, 'Wasl 611').some(p => p.from === 'share')).toBe(false);
  });
  it('the right page, a picture on another host', () => {
    const page = read(subjectPage({ share: '', main: '<img src="https://cdn.other.com/wasl-611.jpg" alt="Wasl 611 · photo 1" width="1200" height="800">' }));
    expect(subjectPictures(page, 'Wasl 611')).toEqual([]);
    expect(page.offSite).toEqual(['cdn.other.com']);
  });
  it('a page that lists things is a listing, whatever it is called', () => {
    const page = read(LISTING, LISTING_URL);
    expect(namesSubject(page, 'Wasl 611')).toBe(true);
    expect(page.listing).toBe(true);
  });
  it('a cover Radar generated and the site published: an alt that begins "Illustration" is not a picture of the subject', () => {
    expect(tied(read(subjectPage({ main: '<img src="/api/media/5tt1blog77x.png" alt="Illustration of Wasl 611" width="1200" height="628"><img src="/api/media/6.png" alt="illustration: Wasl 611 at dusk" width="1200" height="628">' })), 'Wasl 611')).toEqual([]);
  });
});
