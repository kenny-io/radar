import { describe, expect, it } from 'vitest';
import { resolveRefreshUrl } from './refreshUrl';

describe('refresh website identity', () => {
  it.each([
    ['/rent/dubai/1-bedroom-apartments', 'lived.ae', 'https://lived.ae/rent/dubai/1-bedroom-apartments'],
    ['/notes/original?post=123&utm_source=mail#/details', 'https://www.example.test/base', 'https://www.example.test/notes/original?post=123&utm_source=mail#/details'],
    ['/?post=123#!/original', 'http://example.test:8080', 'http://example.test:8080/?post=123#!/original'],
    ['https://cms.example.test/post?b=2&a=1#heading', 'business.test', 'https://cms.example.test/post?b=2&a=1#heading'],
    ['http://cms.example.test/post', '', 'http://cms.example.test/post'],
  ])('resolves %s on the business website', (target, domain, expected) => {
    expect(resolveRefreshUrl(target, domain)).toBe(expected);
  });

  it.each([
    null, undefined, '', 'notes/post', '//other.test/post', 'javascript:alert(1)', 'data:text/html,test',
    'https://user:pass@cms.test/post', 'https://cms.test\\other/post', '/notes/../admin', '/notes/./post',
    '/notes/%2e%2e/admin', '/notes/.%2E/admin', '/notes/%2f../admin', '/notes/%5cadmin', '/notes/%00admin', '/notes/%zz',
    '/notes/po\nst', ' /notes/post', 'https:///post',
  ])('rejects an invalid refresh target without returning its contents', target => {
    expect(() => resolveRefreshUrl(target, 'business.test')).toThrow(expect.objectContaining({
      http: 422, kind: 'config', diagnostic: expect.objectContaining({ code: 'refresh-url-invalid', stage: 'validation' }),
    }));
  });

  it.each(['', '//evil.test', 'ftp://example.test', 'https:///post', 'https://user:pass@example.test', 'bad host'])('rejects an invalid business origin %s', domain => {
    expect(() => resolveRefreshUrl('/notes/post', domain)).toThrow(expect.objectContaining({ http: 422 }));
  });
});
