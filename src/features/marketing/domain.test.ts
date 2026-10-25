import { describe, it, expect } from 'vitest';
import { cleanSite, startHref, SITE_RE } from './domain';
import { cleanDomain } from '@/lib/format';

describe('marketing website field', () => {
  it.each([
    ['fieldnote.app', 'fieldnote.app'],
    ['  FieldNote.APP  ', 'fieldnote.app'],
    ['https://www.fieldnote.app/pricing', 'fieldnote.app'],
    ['HTTP://WWW.Fieldnote.app', 'fieldnote.app'],
    ['fieldnote.app?ref=hn', 'fieldnote.app'],
    ['fieldnote.app#top', 'fieldnote.app'],
    ['fieldnote.app and more', 'fieldnote.app'],
    ['shop.example.co.uk/a/b', 'shop.example.co.uk'],
    ['www.www.example.com', 'www.example.com'],
  ])('cleans %j to %j', (raw, out) => { expect(cleanSite(raw)).toBe(out); });

  it('routes valid input to /start with the cleaned domain', () => {
    expect(startHref(' https://www.My-Shop.com/?utm=1 ')).toBe('/start?domain=my-shop.com');
  });

  it.each(['', '   ', 'fieldnote', 'https://', 'field_note.app', 'fieldnote.', '.app', 'mailto:me@fieldnote.app', 'ftp://fieldnote.app', 'fïeldnote.app'])('rejects %j', raw => {
    expect(startHref(raw)).toBeNull();
  });

  it('cuts at ? # and whitespace, where the shared cleanDomain only cuts at /', () => {
    // Regression guard: the marketing field must not fall back to lib/format's helper.
    expect(SITE_RE.test(cleanDomain('fieldnote.app?ref=x'))).toBe(false);
    expect(SITE_RE.test(cleanSite('fieldnote.app?ref=x'))).toBe(true);
  });
});
