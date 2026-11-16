import { describe, expect, it } from 'vitest';
import { DELETE_RETENTION_HOURS, domainMatches } from '@/lib/deletion';
import { deletedFlash, fmtWipe, restoreLine, restoredFlash, wipeAfter, wipedOn } from './deletion';

const LA = 'America/Los_Angeles';
const PURGE = '2026-11-23T23:42:00.000Z'; // Mon, Nov 23 at 3:42 PM in Los Angeles; already Tuesday in Tokyo

describe('the wipe date', () => {
  it('is written with the day and the time, in the viewer’s time zone', () => {
    expect(fmtWipe(PURGE, LA)).toBe('Mon, Nov 23 at 3:42 PM');
    expect(fmtWipe(PURGE, 'Asia/Tokyo')).toBe('Tue, Nov 24 at 8:42 AM');
    expect(fmtWipe(PURGE, 'UTC')).toBe('Mon, Nov 23 at 11:42 PM');
  });

  it('is empty, not a crash, for a value that is not a date', () => {
    expect(fmtWipe('')).toBe('');
    expect(fmtWipe('soon')).toBe('');
  });

  it('before the delete is exactly 168 hours from now, across a clock change too', () => {
    const now = Date.parse('2026-11-16T23:42:00.000Z');
    expect(wipeAfter(now)).toBe(PURGE);
    expect(Date.parse(wipeAfter(now)) - now).toBe(DELETE_RETENTION_HOURS * 3600e3);
    // US clocks go back on 2026-11-01: the wipe is still 168 hours on, so the wall clock reads an hour earlier.
    expect(fmtWipe(wipeAfter(Date.parse('2026-10-29T19:00:00.000Z')), LA)).toBe('Thu, Nov 5 at 11:00 AM');
  });
});

describe('copy', () => {
  it('the toast after a delete names the business and the last moment to restore it', () => {
    expect(deletedFlash('Fieldnote', PURGE, LA)).toBe('Fieldnote deleted. You can restore it until Mon, Nov 23 at 3:42 PM.');
  });

  it('the toast after a delete still makes sense without a usable date', () => {
    expect(deletedFlash('Fieldnote', '')).toBe('Fieldnote deleted. You can restore it for 7 days.');
  });

  it('the toast after a restore', () => {
    expect(restoredFlash('Fieldnote')).toBe('Fieldnote restored.');
  });

  it('a row of Recently deleted says when it is wiped', () => {
    expect(wipedOn(PURGE, LA)).toBe('Will be wiped on Mon, Nov 23 at 3:42 PM');
    expect(wipedOn('nope')).toBe('');
  });

  it('the no-business screen has no line when there is nothing to restore', () => {
    expect(restoreLine([])).toBeNull();
  });

  it('the no-business screen names the one deleted business and its date', () => {
    expect(restoreLine([{ name: 'Fieldnote', purgeAt: PURGE }], LA)).toEqual({ text: 'You deleted Fieldnote. You can restore it until Mon, Nov 23 at 3:42 PM.', link: 'Restore' });
  });

  it('the no-business screen counts several deleted businesses', () => {
    const two = [{ name: 'Fieldnote', purgeAt: PURGE }, { name: 'Lived', purgeAt: PURGE }];
    expect(restoreLine(two, LA)).toEqual({ text: 'You have 2 deleted businesses you can still restore.', link: 'Restore a business' });
  });

  it('never uses an exclamation mark or a straight apostrophe', () => {
    const all = [deletedFlash('A', PURGE, LA), restoredFlash('A'), wipedOn(PURGE, LA), restoreLine([{ name: 'A', purgeAt: PURGE }], LA)!.text, restoreLine([{ name: 'A', purgeAt: PURGE }, { name: 'B', purgeAt: PURGE }])!.text];
    for (const t of all) expect(t).not.toMatch(/[!']/);
  });
});

describe('what the dialog accepts as the typed domain (the same rule the server applies)', () => {
  it('ignores case and the spaces around it, and nothing else', () => {
    expect(domainMatches('  FieldNote.app ', 'fieldnote.app')).toBe(true);
    expect(domainMatches('fieldnote.app', 'fieldnote.app')).toBe(true);
    expect(domainMatches('', 'fieldnote.app')).toBe(false);
    expect(domainMatches('fieldnote', 'fieldnote.app')).toBe(false);
    expect(domainMatches('https://fieldnote.app', 'fieldnote.app')).toBe(false);
    expect(domainMatches('www.fieldnote.app', 'fieldnote.app')).toBe(false);
    expect(domainMatches('fieldnote.app/', 'fieldnote.app')).toBe(false);
  });
});
