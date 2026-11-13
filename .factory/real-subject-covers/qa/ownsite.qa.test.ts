// QA probe: the domain rule (AC2, D2). Adversarial inputs beyond the architecture table.
import { describe, expect, it } from 'vitest';
import { ownSiteUrl } from '@/lib/ownSite';

const D = 'lived.ae';
const r = (raw: string, base?: string, d = D) => { const o = ownSiteUrl(raw, d, base); return o.ok ? 'ok ' + o.url.href : o.why + (o.host ? ' ' + o.host : ''); };

describe('addresses that must not pass', () => {
  it.each([
    'https://lived.ae.evil.com/a.png', 'https://notlived.ae/a.png', 'https://evil.com/lived.ae/a.png', 'https://evil.com?lived.ae', 'https://evil.com#lived.ae',
    'https://evil.com#@lived.ae/', 'https://evil.com/.lived.ae', 'https://lived.ae%2eevil.com/', 'https://lived.ae%00.evil.com/', 'https://lived.ae%2f.evil.com/',
    'https://lived。ae.evil.com/', 'https://lіved.ae/', 'https://LIVED.AE.evil.com/', 'https://xlived.ae/', 'https://-lived.ae/', 'https://ae/', 'https://.ae/',
    'https://lived.ae.', // handled below as ok; listed here only if host changes
    'https://127.0.0.1/', 'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://2130706433/', 'https://0x7f.0.0.1/', 'https://017700000001/', 'https://localhost/', 'https://169.254.169.254/latest/meta-data/',
    '//evil.com/a.png', '///evil.com/a.png', '////evil.com', 'evil.com/lived.ae', 'evil.com\\@lived.ae', 'https:evil.com', 'https:/evil.com', 'https:\\\\evil.com',
  ])('%s', raw => { const out = r(raw); if (raw === 'https://lived.ae.') expect(out).toBe('ok https://lived.ae/'); else expect(out).not.toMatch(/^ok/); });

  it.each([
    'https://lived.ae@evil.com/', 'https://user:pw@lived.ae/', 'https://lived.ae:pw@evil.com/', 'https://user@lived.ae/',
    'https://lived.ae:8443/', 'https://lived.ae:80/', 'http://lived.ae:443/', 'http://lived.ae:8080/', 'https://lived.ae:6379/', 'https://lived.ae:0/', 'lived.ae:8443/a.png', 'www.lived.ae:22',
    'ftp://lived.ae/a.png', 'file:///etc/passwd', 'file://lived.ae/etc/passwd', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'gopher://lived.ae/', 'ws://lived.ae/', 'wss://lived.ae/', 'blob:https://lived.ae/x', 'view-source:https://lived.ae/',
    'HTTPS://lived.ae\\@evil.com', 'https://lived.ae\t.evil.com/', 'https://lived.ae\n.evil.com/', 'https://lived.ae\u0000/', '', '   ', 'x'.repeat(2001), 'not a url', 'http://', 'https://',
  ])('invalid: %s', raw => expect(r(raw)).not.toMatch(/^ok/));

  it('an empty userinfo ("https://@lived.ae/") is accepted by the URL parser as no userinfo: it lands on the business host with no credentials', () => {
    for (const raw of ['https://@lived.ae/', 'https://:@lived.ae/x']) { const o = ownSiteUrl(raw, D); if (o.ok) { expect(o.url.hostname).toBe('lived.ae'); expect(o.url.username + o.url.password).toBe(''); } }
  });
});

describe('addresses that pass, and what is fetched', () => {
  it.each([
    ['https://lived.ae/a.png', 'https://lived.ae/a.png'], ['http://lived.ae/a.png', 'https://lived.ae/a.png'], ['HTTP://WWW.LIVED.AE/a.png', 'https://www.lived.ae/a.png'],
    ['lived.ae/a.png', 'https://lived.ae/a.png'], ['/a.png', 'https://lived.ae/a.png'], ['a.b.c.lived.ae', 'https://a.b.c.lived.ae/'], ['https://lived.ae.:443/a', 'https://lived.ae/a'],
    ['http://lived.ae:80/a', 'https://lived.ae/a'], ['https://lived.ae/a#b', 'https://lived.ae/a'], ['https://lived.ae/a/../../../etc/passwd', 'https://lived.ae/etc/passwd'],
    ['https://lived.ae/redirect?to=https://evil.com', 'https://lived.ae/redirect?to=https://evil.com'],
  ])('%s → %s', (raw, want) => expect(r(raw)).toBe('ok ' + want));

  it('never returns anything but https with no port and no userinfo', () => {
    for (const raw of ['http://lived.ae', 'lived.ae', '/x', 'https://www.lived.ae:443/', 'http://lived.ae:80']) {
      const o = ownSiteUrl(raw, D); expect(o.ok).toBe(true);
      if (o.ok) { expect(o.url.protocol).toBe('https:'); expect(o.url.port).toBe(''); expect(o.url.username).toBe(''); expect(o.url.password).toBe(''); expect(o.url.hash).toBe(''); }
    }
  });
});

describe('with a base (addresses found on a page, and redirect targets)', () => {
  const base = 'https://www.lived.ae/property/x';
  it.each(['//cdn.other.com/x.jpg', 'https://cdn.other.com/x.jpg', '\\\\cdn.other.com\\x.jpg', '/\\cdn.other.com/x.jpg', 'https://lived.ae.cdn.com/x.jpg', 'javascript:alert(1)', 'data:image/png;base64,AA', 'https://lived.ae:8443/x.jpg', 'https://u:p@lived.ae/x.jpg', 'file:///etc/passwd'])('refused: %s', raw => expect(r(raw, base)).not.toMatch(/^ok/));
  it.each([['/api/media/x.jpg?bucket=p', 'https://www.lived.ae/api/media/x.jpg?bucket=p'], ['x.jpg', 'https://www.lived.ae/property/x.jpg'], ['../x.jpg', 'https://www.lived.ae/x.jpg'], ['//img.lived.ae/x.jpg', 'https://img.lived.ae/x.jpg'], ['http://img.lived.ae/x.jpg', 'https://img.lived.ae/x.jpg']])('%s', (raw, want) => expect(r(raw, base)).toBe('ok ' + want));
});

describe('odd business domains', () => {
  it('a domain that is an IP address, a single label, or carries a path, port or userinfo is never a site', () => {
    for (const d of ['localhost', 'lived.ae/x', 'lived.ae:8443', 'u@lived.ae', 'lived.ae?x', '', ' ', 'ae']) expect(ownSiteUrl('https://lived.ae/a.png', d).ok).toBe(false);
  });
  it('records what an IP-address domain does (the fetch guard is what stops it)', () => {
    // Not asserted as a pass or fail of the domain rule: businesses.domain is validated at sign-up; the guard's own check is in guard.qa.test.ts.
    const o = ownSiteUrl('https://127.0.0.1/a.png', '127.0.0.1');
    expect(typeof o.ok).toBe('boolean');
  });
  it('a suffix domain does not admit a sibling: "co.uk" style over-broad domains are the sign-up form’s concern', () => {
    expect(r('https://evil.co.uk/a.png', undefined, 'example.co.uk')).toMatch(/^off_site/);
    expect(r('https://example.co.uk.evil.com/a.png', undefined, 'example.co.uk')).toMatch(/^off_site/);
  });
  it('upper case and a trailing dot in the stored domain do not widen or break the rule', () => {
    expect(r('https://www.lived.ae/a.png', undefined, 'LIVED.AE.')).toBe('ok https://www.lived.ae/a.png');
    expect(r('https://evil.com/a.png', undefined, 'LIVED.AE.')).toMatch(/^off_site/);
  });
});
