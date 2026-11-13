// Reading a page of the business's own site: what it calls its subject, which pictures are its own, and which of
// them it ties to the subject. Pure; the pages are in page.fixtures.ts.
import { describe, expect, it } from 'vitest';
import { nameTokens, namesSubject, ownerPictures, readPage, shareImages, slugExtra, slugTokens, subjectPictures, titleLead, type PageFacts } from './page';
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
  it('the h1, the lead of the title and of og:title, and structured-data names that are not generic', () => {
    expect(read(WASL).names).toEqual(['Wasl 611']); // the breadcrumb list and its items are not names
    expect(read(PRINCESS, PRINCESS_URL).names).toEqual(['Princess Tower']);
    expect(read(TOWER_B, TOWER_B_URL).names).toEqual(['Wasl 611 Tower B']);
    expect(read(HOME, HOME_URL).names).toEqual(['Honest reviews of where you live', 'Lived']); // not the Organization's name twice, and never as a subject entity
  });
  it.each(['Organization', 'WebSite', 'WebPage', 'BreadcrumbList', 'ListItem', 'ItemList', 'FAQPage', 'Question', 'Answer', 'Person', 'ImageObject', 'SearchAction'])('a %s entity gives neither a name nor a picture', type => {
    const page = read(subjectPage({ name: 'Somewhere Else', title: 'Somewhere Else', ld: { '@context': 'https://schema.org', '@type': type, name: 'Wasl 611', image: 'https://lived.ae/api/media/0generic.jpg' } }));
    expect(page.names).toEqual(['Somewhere Else']);
    expect(page.pictures.filter(p => p.from === 'ld')).toEqual([]);
  });
  it('reads every JSON-LD block, @graph and arrays included, with schema.org type addresses, and ignores a block that does not parse', () => {
    const page = read(subjectPage({ name: 'A', title: 'A', headMore: [
      '<script type="application/ld+json">{ not json</script>',
      `<script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': ['Place', 'Residence'], name: 'Wasl 611', image: ['/api/media/g1.jpg', { '@type': 'ImageObject', url: '/api/media/g2.jpg' }, '/api/media/g3.jpg'] }, { '@type': 'WebPage', name: 'ignored' }] })}</script>`,
      `<script type="application/ld+json">${JSON.stringify([{ '@type': 'https://schema.org/Product', name: 'Wasl 611 Key Fob', image: { '@type': 'ImageObject', contentUrl: 'https://lived.ae/api/media/g4.png' } }])}</script>`,
    ].join('') }));
    expect(page.names).toEqual(['A', 'Wasl 611', 'Wasl 611 Key Fob']);
    // The first two pictures of each entity, in document order, each with the entity it belongs to.
    expect(page.pictures.filter(p => p.from === 'ld')).toEqual([
      { url: 'https://lived.ae/api/media/g1.jpg', alt: '', from: 'ld', of: 'Wasl 611' }, { url: 'https://lived.ae/api/media/g2.jpg', alt: '', from: 'ld', of: 'Wasl 611' },
      { url: 'https://lived.ae/api/media/g4.png', alt: '', from: 'ld', of: 'Wasl 611 Key Fob' },
    ]);
  });
  it('a type that is partly generic is generic', () => {
    expect(read(subjectPage({ name: 'A', title: 'A', ld: { '@type': ['Place', 'Organization'], name: 'Wasl 611', image: '/x.jpg' } })).names).toEqual(['A']);
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
  it('structured data of that entity first, then alt text that contains the name, then share images', () => {
    const p = page({ share: '/wasl-card.png', ld: [{ '@type': 'Place', name: 'Wasl 611', image: '/ld-wasl.jpg' }, { '@type': 'Place', name: 'Wasl 611 Tower B', image: '/ld-tower-b.jpg' }, { '@type': 'Product', image: '/ld-unnamed.jpg' }],
      main: '<img src="/other.jpg" alt="Property thumbnail 1"><img src="/alt-wasl.jpg" alt="Front gate of WASL-611, Al Warsan"><img src="/ld-wasl.jpg" alt="Wasl 611">' });
    expect(subjectPictures(p, 'Wasl 611').map(x => [x.from, x.url.replace('https://lived.ae', '')])).toEqual([['ld', '/ld-wasl.jpg'], ['img', '/alt-wasl.jpg'], ['share', '/wasl-card.png']]);
    // The owner action goes on to everything else on the page: the other structured-data pictures, the share image, the other <img>.
    expect(urls(ownerPictures(p, 'Wasl 611')).map(u => u.replace('https://lived.ae', ''))).toEqual(['/ld-wasl.jpg', '/alt-wasl.jpg', '/wasl-card.png', '/ld-tower-b.jpg', '/ld-unnamed.jpg', '/other.jpg']);
    // With no subject there is nothing to prefer: structured data, share, then <img>, no address twice.
    expect(urls(ownerPictures(p, null)).map(u => u.replace('https://lived.ae', ''))).toEqual(['/ld-wasl.jpg', '/ld-tower-b.jpg', '/ld-unnamed.jpg', '/wasl-card.png', '/other.jpg', '/alt-wasl.jpg']);
  });
  it('the two real page shapes', () => {
    expect(subjectPictures(read(PRINCESS, PRINCESS_URL), 'Princess Tower').map(p => p.from)).toEqual(['ld', 'img', 'share']);
    expect(subjectPictures(read(PRINCESS, PRINCESS_URL), 'Princess Tower')[0].url).toBe(PRINCESS_PICTURE);
    expect(subjectPictures(read(WASL), 'Wasl 611').map(p => [p.from, p.url])).toEqual([['img', WASL_PICTURE], ['share', DEFAULT_CARD]]);
  });
  it('an empty subject ties nothing', () => { expect(subjectPictures(read(WASL), ' — ')).toEqual([]); });
});

describe('near misses the rules must reject (architecture §4.4)', () => {
  const tied = (p: PageFacts, subject: string) => subjectPictures(p, subject).filter(x => x.from !== 'share');
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
    // Its structured data even claims the bare name; being an article is what rules it out.
    expect(post.names).toEqual(['Wasl 611 review: what tenants say', 'Wasl 611 review', 'Wasl 611']);
    expect(read(subjectPage({ name: 'Dubai Marina vs JBR', title: 'Dubai Marina vs JBR' }), 'https://lived.ae/blog/dubai-marina-vs-jbr').article).toBe(true);
  });
  it('the right page, a picture whose alt text does not name the subject', () => {
    expect(tied(read(subjectPage({ main: '<img src="/api/media/1thumb.jpg" alt="Property thumbnail 1" width="1200" height="800">' })), 'Wasl 611')).toEqual([]);
    expect(tied(read(subjectPage({ main: '<img src="/api/media/1thumb.jpg" alt="" width="1200" height="800"><img src="/api/media/2thumb.jpg" width="1200" height="800">' })), 'Wasl 611')).toEqual([]);
    expect(tied(read(subjectPage({ main: '<img src="/api/media/1thumb.jpg" alt="Wasl 6110 lobby" width="1200" height="800"><img src="/api/media/2.jpg" alt="611 Wasl" width="1200" height="800">' })), 'Wasl 611')).toEqual([]);
  });
  it('the right page, a share image equal to the home page’s: only the comparison can tell, its alt text proves nothing', () => {
    const page = read(WASL);
    const share = subjectPictures(page, 'Wasl 611').filter(p => p.from === 'share');
    expect(urls(share)).toEqual([DEFAULT_CARD]);
    expect(shareImages(HOME, HOME_URL, SITE)).toContain(share[0].url);
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
