import { describe, expect, it } from 'vitest';
import { DELETE_RETENTION_DAYS, DELETE_RETENTION_HOURS, domainMatches } from './deletion';

describe('typed-domain confirmation (DEL-2)', () => {
  it('accepts the domain with surrounding spaces and in any case', () => {
    for (const typed of ['fieldnote.app', '  fieldnote.app  ', 'FieldNote.APP', '\tFIELDNOTE.app\n']) expect(domainMatches(typed, 'fieldnote.app')).toBe(true);
    expect(domainMatches('shop.example.co.uk', 'Shop.Example.co.uk ')).toBe(true);
  });
  it('accepts nothing else: no scheme, www, path, inner space, partial or empty text', () => {
    for (const typed of ['', '   ', 'fieldnote', 'fieldnote.ap', 'fieldnote.app/', 'https://fieldnote.app', 'www.fieldnote.app', 'field note.app', 'fieldnote.app.evil.test', 'xfieldnote.app'])
      expect(domainMatches(typed, 'fieldnote.app')).toBe(false);
  });
  it('keeps a business for exactly seven days of 24 hours', () => {
    expect(DELETE_RETENTION_HOURS).toBe(DELETE_RETENTION_DAYS * 24);
    expect(DELETE_RETENTION_HOURS).toBe(168);
  });
});
