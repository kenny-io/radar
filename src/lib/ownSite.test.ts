import { describe, expect, it } from 'vitest';
import { ownSiteUrl } from './ownSite';

const DOMAIN = 'lived.ae';
const PAGE = 'https://www.lived.ae/property/x';
const href = (raw: string, domain = DOMAIN, base?: string | URL) => {
  const r = ownSiteUrl(raw, domain, base);
  return r.ok ? r.url.href : r;
};
const offSite = (host: string) => ({ ok: false, why: 'off_site', host });
const invalid = { ok: false, why: 'invalid' };

// Addresses that carry their own scheme or host mean the same thing wherever they were found.
const OWN_ABSOLUTE: [string, string][] = [
  ['https://www.lived.ae/a.jpg?x=1#frag', 'https://www.lived.ae/a.jpg?x=1'],
  ['http://lived.ae/a.jpg', 'https://lived.ae/a.jpg'],
  ['https://lived.ae./a.jpg', 'https://lived.ae/a.jpg'],
  ['https://lived.ae:443/a.jpg', 'https://lived.ae/a.jpg'],
];
const OFF_SITE: [string, string][] = [
  ['https://lived.ae.evil.com/a.jpg', 'lived.ae.evil.com'],
  ['https://notlived.ae/a.jpg', 'notlived.ae'],
  ['https://evil.com/lived.ae/a.jpg', 'evil.com'],
  ['https://evil.com#@lived.ae', 'evil.com'],
  ['//evil.com/a.jpg', 'evil.com'],
  ['https://lived.ae%2eevil.com/', 'lived.ae.evil.com'],
  ['https://lіved.ae/', 'xn--lved-l9d.ae'], // Cyrillic і
  ['https://127.0.0.1/', '127.0.0.1'],
  ['https://[::1]/', '[::1]'],
];
const INVALID_ABSOLUTE = [
  'https://lived.ae@evil.com/a.jpg',
  'https://user:pw@lived.ae/a.jpg',
  'https://lived.ae\\@evil.com/a.jpg',
  'https://lived.ae:8443/a.jpg',
  'http://lived.ae:8080/a.jpg',
  'ftp://lived.ae/a.jpg',
  'file:///etc/passwd',
  'javascript:alert(1)',
  'data:image/png;base64,AAAA',
  '',
];

describe('an address a person typed (no base)', () => {
  it.each(OWN_ABSOLUTE)('%s is on the site', (raw, expected) => {
    expect(href(raw)).toBe(expected);
  });
  it.each([
    ['lived.ae/a.jpg', 'https://lived.ae/a.jpg'],
    ['/property/x', 'https://lived.ae/property/x'],
    ['media.cdn.lived.ae/a.png', 'https://media.cdn.lived.ae/a.png'],
  ])('%s is completed to an https address on the site', (raw, expected) => {
    expect(href(raw)).toBe(expected);
  });
  it.each(OFF_SITE)('%s is another site', (raw, host) => {
    expect(href(raw)).toEqual(offSite(host));
  });
  it.each([...INVALID_ABSOLUTE, 'not a url'])('%j is not an address Radar will use', raw => {
    expect(href(raw)).toEqual(invalid);
  });
  it('returns a URL object that is https, has no fragment and no port', () => {
    const r = ownSiteUrl('  http://WWW.Lived.ae/a.jpg?x=1#frag  ', DOMAIN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.url).toBeInstanceOf(URL);
    expect([r.url.protocol, r.url.hostname, r.url.port, r.url.hash, r.url.search]).toEqual(['https:', 'www.lived.ae', '', '', '?x=1']);
  });
});

describe('an address found on a page (with base)', () => {
  it.each([
    ['/api/media/x.jpg?bucket=p', 'https://www.lived.ae/api/media/x.jpg?bucket=p'],
    ['//www.lived.ae/x.jpg', 'https://www.lived.ae/x.jpg'],
    ['http://img.lived.ae/x.jpg', 'https://img.lived.ae/x.jpg'],
  ])('%s is on the site', (raw, expected) => {
    expect(href(raw, DOMAIN, PAGE)).toBe(expected);
    expect(href(raw, DOMAIN, new URL(PAGE))).toBe(expected);
  });
  it.each([
    ['//cdn.other.com/x.jpg', 'cdn.other.com'],
    ['https://cdn.other.com/x.jpg', 'cdn.other.com'],
  ])('%s is another site', (raw, host) => {
    expect(href(raw, DOMAIN, PAGE)).toEqual(offSite(host));
  });
  it.each(OWN_ABSOLUTE)('%s gives the same answer as when it is typed', (raw, expected) => {
    expect(href(raw, DOMAIN, PAGE)).toBe(expected);
  });
  it.each(OFF_SITE)('%s is still another site', (raw, host) => {
    expect(href(raw, DOMAIN, PAGE)).toEqual(offSite(host));
  });
  it.each(INVALID_ABSOLUTE)('%j is still refused', raw => {
    expect(href(raw, DOMAIN, PAGE)).toEqual(invalid);
  });
  it('reads an address with no scheme as a path under the page, not as a host', () => {
    expect(href('lived.ae/a.jpg', DOMAIN, PAGE)).toBe('https://www.lived.ae/property/lived.ae/a.jpg');
    expect(href('media.cdn.lived.ae/a.png', DOMAIN, PAGE)).toBe('https://www.lived.ae/property/media.cdn.lived.ae/a.png');
    expect(href('evil.com/a.jpg', DOMAIN, PAGE)).toBe('https://www.lived.ae/property/evil.com/a.jpg');
    expect(href('not a url', DOMAIN, PAGE)).toBe('https://www.lived.ae/property/not%20a%20url');
    expect(href('/property/x', DOMAIN, PAGE)).toBe('https://www.lived.ae/property/x');
    expect(href('photo.jpg#top', DOMAIN, PAGE)).toBe('https://www.lived.ae/property/photo.jpg');
  });
  it('upgrades a scheme-relative address found on an http page', () => {
    expect(href('//www.lived.ae/x.jpg', DOMAIN, 'http://www.lived.ae/property/x')).toBe('https://www.lived.ae/x.jpg');
  });
  it('a relative address on a page of another site is another site', () => {
    expect(href('/x.jpg', DOMAIN, 'https://cdn.other.com/page')).toEqual(offSite('cdn.other.com'));
  });
  it('a base that is not an address gives invalid instead of throwing, even for a complete address', () => {
    expect(href('/x.jpg', DOMAIN, 'not a url')).toEqual(invalid);
    expect(href('https://lived.ae/x.jpg', DOMAIN, 'not a url')).toEqual(invalid);
    expect(href('https://lived.ae/x.jpg', DOMAIN, '')).toEqual(invalid);
  });
});

describe('ports and schemes', () => {
  it('refuses every port that is not the default of the scheme it was written with', () => {
    expect(href('http://lived.ae:80/a.jpg')).toBe('https://lived.ae/a.jpg');
    expect(href('http://lived.ae:443/a.jpg')).toEqual(invalid); // the upgrade to https must not make this port disappear
    expect(href('https://lived.ae:80/a.jpg')).toEqual(invalid);
    expect(href('lived.ae:8443/a.jpg')).toEqual(invalid);
    expect(href('//lived.ae:8443/a.jpg', DOMAIN, PAGE)).toEqual(invalid);
  });
  it('refuses schemes written in any case, and accepts HTTP and HTTPS in any case', () => {
    expect(href('JavaScript:alert(1)')).toEqual(invalid);
    expect(href('mailto:someone@lived.ae')).toEqual(invalid);
    expect(href('HTTP://lived.ae/a.jpg')).toBe('https://lived.ae/a.jpg');
    expect(href('HTTPS://LIVED.AE/a.jpg')).toBe('https://lived.ae/a.jpg');
  });
});

describe('what is refused before parsing', () => {
  it('refuses blank text, with or without a base', () => {
    expect(href('   ')).toEqual(invalid);
    expect(href('   ', DOMAIN, PAGE)).toEqual(invalid);
  });
  it('refuses an address over 2,000 characters and accepts one of exactly 2,000', () => {
    const start = 'https://lived.ae/';
    expect(href(start + 'a'.repeat(2000 - start.length))).toBe(start + 'a'.repeat(2000 - start.length));
    expect(href(start + 'a'.repeat(2001 - start.length))).toEqual(invalid);
  });
  it('refuses control characters and backslashes anywhere, which the parser would otherwise remove or rewrite', () => {
    expect(href('https://lived.ae/a\tb.jpg')).toEqual(invalid);
    expect(href('https://lived.ae\n.evil.com/a.jpg')).toEqual(invalid);
    expect(href('https://lived.ae/a\u0000.jpg')).toEqual(invalid);
    expect(href('https:\\\\lived.ae\\a.jpg')).toEqual(invalid);
    expect(href('\\\\evil.com\\a.jpg', DOMAIN, PAGE)).toEqual(invalid);
  });
});

describe('the business domain', () => {
  it('an IDN domain stored as xn-- matches the same host typed in Unicode, in any case', () => {
    const idn = 'xn--mnchen-3ya.de';
    expect(href('https://münchen.de/a.jpg', idn)).toBe('https://xn--mnchen-3ya.de/a.jpg');
    expect(href('https://www.MÜNCHEN.de/a.jpg', idn)).toBe('https://www.xn--mnchen-3ya.de/a.jpg');
    expect(href('https://munchen.de/', idn)).toEqual(offSite('munchen.de'));
    expect(href('/a.jpg', idn)).toBe('https://xn--mnchen-3ya.de/a.jpg');
    expect(href('https://münchen.de/a.jpg', 'München.de')).toBe('https://xn--mnchen-3ya.de/a.jpg');
  });
  it('a parent domain is not the business’s site', () => {
    const sub = 'blog.example.co.uk';
    expect(href('https://example.co.uk/a.jpg', sub)).toEqual(offSite('example.co.uk'));
    expect(href('https://www.example.co.uk/a.jpg', sub)).toEqual(offSite('www.example.co.uk'));
    expect(href('https://blog.example.co.uk/a.jpg', sub)).toBe('https://blog.example.co.uk/a.jpg');
    expect(href('https://img.blog.example.co.uk/a.jpg', sub)).toBe('https://img.blog.example.co.uk/a.jpg');
    expect(href('/a.jpg', sub, 'https://example.co.uk/page')).toEqual(offSite('example.co.uk'));
  });
  it('is read without regard to case, surrounding space or a trailing dot', () => {
    expect(href('https://www.lived.ae/a.jpg', '  Lived.AE.  ')).toBe('https://www.lived.ae/a.jpg');
  });
  it.each(['', '   ', 'localhost', 'lived.ae/path', 'lived.ae:8443', 'lived.ae:443', 'user@lived.ae', 'https://lived.ae', 'lived.ae?x=1', 'lived ae'])('refuses everything when the domain is %j', domain => {
    expect(href('https://lived.ae/a.jpg', domain)).toEqual(invalid);
    expect(href('/a.jpg', domain)).toEqual(invalid);
  });
});
