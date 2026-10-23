import { describe, it, expect } from 'vitest';
import {
  acctLabel, atTz, briefAccount, liCommentary, normForMatch, xReplyIntentUrl, xReplyMode, publishCostUsd, expiresBefore, expiryNote, briefPreflightInput, briefPublish, briefSid, charCount, dayOptions, defaultSlot, dueAtIso, errCopy, failedLine,
  isLocked, isPastSlot, localParts, mentions, moveCheck, packPanelState, packSid, parseSid, pickAccount, preflight, scheduleAllWhy, scheduledCount,
  shortTime, showScheduleAll, socialItems, TIME_SLOTS, tzLabel, tzNote, xStatusId, zonedTimeToUtc, COPY, LOCK_MS, MAX_IMAGE_BYTES,
} from './socialPublish';
import type { BriefItem, Pub, SocialAccount, Workspace } from './types';

const X: SocialAccount = { id: 'a1', ch: 'x', name: 'Fieldnote', handle: '@fieldnoteapp' };
const PROF: SocialAccount = { id: 'a2', ch: 'li_profile', name: 'Maya Chen' };
const PAGE: SocialAccount = { id: 'a3', ch: 'li_page', name: 'Fieldnote' };
const NY = 'America/New_York';
const T0 = Date.parse('2026-10-23T14:00:00Z'); // 10:00 AM ET, Fri Oct 23
const pub = (p: Partial<Pub> = {}): Pub => ({ status: 'scheduled', platform: 'x', date: '2026-10-24', time: '12:30', dueAt: dueAtIso('2026-10-24', '12:30', NY), acct: 'a1', ...p });

describe('stable ids', () => {
  it('round-trips pack ids', () => {
    expect(packSid('pk1a2b', 'linkedin')).toBe('s:pk1a2b:linkedin');
    expect(parseSid('s:pk1a2b:linkedin')).toEqual({ src: 'pack', packId: 'pk1a2b', platform: 'linkedin' });
  });
  it('keeps colons inside brief item ids', () => {
    const sid = briefSid('2026-10-23', 'x:1843000000000000001');
    expect(sid).toBe('b:2026-10-23:x:1843000000000000001');
    expect(parseSid(sid)).toEqual({ src: 'brief', day: '2026-10-23', itemId: 'x:1843000000000000001' });
  });
  it('rejects malformed ids and non-postable platforms', () => {
    for (const s of ['', 's:', 's:p1:reddit', 's::x', 'b:2026-10-2:x', 'b:2026-10-23', 'b:2026-10-23-x', 'z:1:2', 's:' + 'a'.repeat(200) + ':x']) expect(parseSid(s)).toBeNull();
  });
});

describe('account routing', () => {
  const all = [X, PROF, PAGE];
  it('labels accounts like the prototype', () => {
    expect(acctLabel(X)).toBe('@fieldnoteapp'); expect(acctLabel(PROF)).toBe('Maya Chen'); expect(acctLabel(PAGE)).toBe('Fieldnote · Page'); expect(acctLabel(null)).toBe('');
  });
  it('routes Daily Brief items: X → X, feed → profile, company → page', () => {
    expect(briefAccount(all, 'x', false)?.id).toBe('a1');
    expect(briefAccount(all, 'x', true)?.id).toBe('a1');
    expect(briefAccount(all, 'linkedin', false)?.id).toBe('a2');
    expect(briefAccount(all, 'linkedin', true)?.id).toBe('a3');
    expect(briefAccount(all, 'reddit', false)).toBeNull();
    expect(briefAccount([X], 'linkedin', false)).toBeNull();
  });
  it('Post as defaults to the pub account, then the pick, then the page, then a live account', () => {
    expect(pickAccount(all, 'linkedin')?.id).toBe('a3');
    expect(pickAccount(all, 'linkedin', { chosen: 'a2' })?.id).toBe('a2');
    expect(pickAccount(all, 'linkedin', { pubAcct: 'a3', chosen: 'a2' })?.id).toBe('a3');
    expect(pickAccount([PROF, { ...PAGE, expired: true }], 'linkedin')?.id).toBe('a2');
    expect(pickAccount([{ ...PAGE, expired: true }], 'linkedin')?.id).toBe('a3');
    expect(pickAccount(all, 'facebook')).toBeNull();
  });
});

describe('preflight', () => {
  it('blocks empty text', () => { expect(preflight('x', { text: '  ', images: [] }).map(p => p.code)).toEqual(['empty']); });
  it('enforces 280 on X and 3,000 on LinkedIn with the prototype copy', () => {
    const p = preflight('x', { text: 'a'.repeat(281), images: [] });
    expect(p[0]).toEqual({ code: 'too_long', msg: 'Shorten to 280 characters to post on X. It’s 281 now.' });
    expect(preflight('x', { text: 'a'.repeat(280), images: [] })).toEqual([]);
    expect(preflight('linkedin', { text: 'a'.repeat(3001), images: [] })[0].msg).toBe('Shorten to 3,000 characters to post on LinkedIn. It’s 3,001 now.');
    expect(preflight('linkedin', { text: 'a'.repeat(3000), images: [] })).toEqual([]);
  });
  it('counts X URLs as 23 and wide characters as 2', () => {
    expect(charCount('x', 'see https://fieldnote.app/blog/a-very-long-article-slug-that-goes-on')).toBe(4 + 23);
    expect(charCount('x', '日本')).toBe(4);
    expect(charCount('x', '👍')).toBe(2);
    expect(charCount('linkedin', '👍')).toBe(1);
    expect(preflight('x', { text: 'x'.repeat(250) + ' https://fieldnote.app/' + 'p'.repeat(60), images: [] })).toEqual([]);
  });
  it('limits image count (X 4, LinkedIn 9)', () => {
    const img = { bytes: 1000, type: 'image/png' };
    expect(preflight('x', { text: 'hi', images: Array(5).fill(img) }).map(p => p.code)).toEqual(['too_many_images']);
    expect(preflight('x', { text: 'hi', images: Array(4).fill(img) })).toEqual([]);
    expect(preflight('linkedin', { text: 'hi', images: Array(10).fill(img) })[0].msg).toBe('LinkedIn allows up to 9 images.');
  });
  it('flags images over 5 MB with a Compress images fix', () => {
    const p = preflight('linkedin', { text: 'hi', images: [{ bytes: 1000, type: 'image/png' }, { bytes: Math.round(6.2 * 1024 * 1024), type: 'image/png' }] });
    expect(p).toEqual([{ code: 'image_too_big', msg: 'Image 2 is 6.2 MB. LinkedIn’s limit is 5 MB.', fix: { l: 'Compress images', action: 'compress' } }]);
    expect(preflight('x', { text: 'hi', images: [{ bytes: MAX_IMAGE_BYTES, type: 'image/png' }] })).toEqual([]);
  });
  it('flags formats the platform rejects (WEBP on LinkedIn) and skips unknown sizes', () => {
    expect(preflight('linkedin', { text: 'hi', images: [{ bytes: 10, type: 'image/webp' }] })[0]).toMatchObject({ code: 'image_format', msg: 'Image 1 is a WEBP file, which LinkedIn doesn’t accept.' });
    expect(preflight('x', { text: 'hi', images: [{ bytes: 10, type: 'image/webp' }] })).toEqual([]);
    expect(preflight('x', { text: 'hi', images: [null, undefined] })).toEqual([]);
  });
  it('Brief posts: only finished images count, X takes the first 4, generating blocks', () => {
    const m = { bytes: 10, type: 'image/png' };
    const it = { kind: 'post' as const, img: { style: 'flat' as any, range: 'many' as any, seed: 1, n: 5, urls: ['/a', '/b', null, '/d', '/e'], status: 'ready' as const, meta: [m, m, null, m, m] } };
    expect(briefPreflightInput(it, 'x', 'hi').images).toHaveLength(4);
    expect(briefPreflightInput(it, 'linkedin', 'hi').images).toHaveLength(4);
    expect(preflight('linkedin', briefPreflightInput({ ...it, img: { ...it.img, status: 'generating' } }, 'linkedin', 'hi')).map(p => p.code)).toEqual(['images_pending']);
    expect(briefPreflightInput({ kind: 'reply', img: null }, 'x', 'hi').images).toEqual([]);
  });
});

describe('time zone math', () => {
  it('converts wall time in the business zone to an instant', () => {
    expect(new Date(zonedTimeToUtc('2026-10-24', '09:00', NY)).toISOString()).toBe('2026-10-24T13:00:00.000Z');
    expect(new Date(zonedTimeToUtc('2026-01-15', '09:00', NY)).toISOString()).toBe('2026-01-15T14:00:00.000Z');
    expect(new Date(zonedTimeToUtc('2026-07-01', '09:00', 'Europe/London')).toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(new Date(zonedTimeToUtc('2026-07-01', '09:00', 'Europe/Berlin')).toISOString()).toBe('2026-07-01T07:00:00.000Z');
    expect(new Date(zonedTimeToUtc('2026-07-01', '09:00', 'Asia/Dubai')).toISOString()).toBe('2026-07-01T05:00:00.000Z');
    expect(new Date(zonedTimeToUtc('2026-07-01', '09:00', 'Africa/Lagos')).toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(new Date(zonedTimeToUtc('2026-07-01', '09:00', 'Asia/Kolkata')).toISOString()).toBe('2026-07-01T03:30:00.000Z');
  });
  it('moves a time skipped by DST forward, and takes the earlier of a repeated time', () => {
    // US spring forward 2026-03-08 02:00 → 03:00: 02:30 doesn't exist → 03:30 EDT
    expect(new Date(zonedTimeToUtc('2026-03-08', '02:30', NY)).toISOString()).toBe('2026-03-08T07:30:00.000Z');
    expect(new Date(zonedTimeToUtc('2026-03-08', '03:30', NY)).toISOString()).toBe('2026-03-08T07:30:00.000Z');
    // US fall back 2026-11-01: 01:30 happens twice → the first (EDT)
    expect(new Date(zonedTimeToUtc('2026-11-01', '01:30', NY)).toISOString()).toBe('2026-11-01T05:30:00.000Z');
    // UK spring forward 2026-03-29 01:00 → 02:00
    expect(new Date(zonedTimeToUtc('2026-03-29', '01:30', 'Europe/London')).toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });
  it('round-trips local parts', () => {
    const ms = zonedTimeToUtc('2026-10-24', '12:30', NY);
    expect(localParts(ms, NY)).toEqual({ date: '2026-10-24', time: '12:30' });
  });
  it('detects past slots against the business zone, not the server clock', () => {
    expect(isPastSlot('2026-10-23', '10:00', NY, T0)).toBe(true);
    expect(isPastSlot('2026-10-23', '10:30', NY, T0)).toBe(false);
    expect(isPastSlot('2026-10-22', '22:00', NY, T0)).toBe(true);
    // 10:00 AM in Los Angeles is still ahead when it's 10:00 AM in New York
    expect(isPastSlot('2026-10-23', '09:00', 'America/Los_Angeles', T0)).toBe(false);
  });
});

describe('time zone labels (Intl, any IANA zone)', () => {
  const jan = Date.parse('2026-01-15T15:00:00Z'); const jul = Date.parse('2026-07-15T15:00:00Z');
  it('uses US generic abbreviations', () => {
    expect(tzLabel(NY, jan)).toEqual({ abbr: 'ET', name: 'Eastern Time' });
    expect(tzLabel(NY, jul)).toEqual({ abbr: 'ET', name: 'Eastern Time' });
    expect(tzLabel('America/Los_Angeles', jul).abbr).toBe('PT');
    expect(tzLabel('America/Phoenix', jul).abbr).toBe('MST');
  });
  it('labels European and other zones by date', () => {
    expect(tzLabel('Europe/London', jan)).toEqual({ abbr: 'GMT', name: 'United Kingdom Time' });
    expect(tzLabel('Europe/London', jul).abbr).toBe('BST');
    expect(tzLabel('Europe/Berlin', jan)).toEqual({ abbr: 'CET', name: 'Central European Time' });
    expect(tzLabel('Europe/Berlin', jul).abbr).toBe('CEST');
    expect(tzLabel('Asia/Dubai', jul)).toEqual({ abbr: 'GST', name: 'Gulf Standard Time' });
    expect(tzLabel('Africa/Lagos', jul)).toEqual({ abbr: 'GMT+1', name: 'West Africa Standard Time' });
    expect(tzLabel('UTC', jul)).toEqual({ abbr: 'UTC', name: 'Coordinated Universal Time' });
  });
  it('builds the status time and the Schedule window note', () => {
    expect(atTz(NY, '2026-10-24', '09:00')).toBe('9:00 AM ET');
    expect(atTz('Europe/London', '2026-12-01', '17:30')).toBe('5:30 PM GMT');
    expect(tzNote(NY, T0)).toBe('Times are in Eastern Time (ET). Change it in Settings → Publishing.');
  });
  it('formats chip times', () => {
    expect(shortTime('09:00')).toBe('9a'); expect(shortTime('12:30')).toBe('12:30p'); expect(shortTime('00:00')).toBe('12a'); expect(shortTime('17:05')).toBe('5:05p');
  });
});

describe('schedule window', () => {
  it('offers 14 days and 6:00 AM–10:00 PM in 30-minute steps', () => {
    const d = dayOptions('2026-10-23');
    expect(d).toHaveLength(14); expect(d[0]).toBe('2026-10-23'); expect(d[13]).toBe('2026-11-05');
    expect(TIME_SLOTS[0]).toBe('06:00'); expect(TIME_SLOTS[TIME_SLOTS.length - 1]).toBe('22:00'); expect(TIME_SLOTS).toHaveLength(33);
  });
  it('defaults to tomorrow at the usual slot (packs) or today 5 PM (Brief)', () => {
    expect(defaultSlot('pack', 'linkedin', '2026-10-23')).toEqual({ date: '2026-10-24', time: '09:00' });
    expect(defaultSlot('pack', 'x', '2026-10-23')).toEqual({ date: '2026-10-24', time: '12:30' });
    expect(defaultSlot('brief', 'x', '2026-10-23')).toEqual({ date: '2026-10-23', time: '17:00' });
  });
});

describe('locking', () => {
  const due = Date.parse(dueAtIso('2026-10-24', '12:30', NY));
  it('locks 5 minutes before send, while sending, and past due', () => {
    expect(isLocked(pub(), due - LOCK_MS - 1000)).toBe(false);
    expect(isLocked(pub(), due - LOCK_MS)).toBe(true);
    expect(isLocked(pub(), due + 60_000)).toBe(true);
    expect(isLocked(pub({ status: 'sending' }), due - 864e5)).toBe(true);
    expect(isLocked(null, due)).toBe(false);
  });
  it('never locks posted, failed or held posts', () => {
    expect(isLocked(pub({ status: 'posted' }), due)).toBe(false);
    expect(isLocked(pub({ status: 'failed' }), due)).toBe(false);
    expect(isLocked(pub({ held: true }), due + 3600e3)).toBe(false);
  });
  it('drag rules: locked, past day, past time, same day', () => {
    expect(moveCheck(pub(), '2026-10-24', '2026-10-23', NY, T0)).toBe('same');
    expect(moveCheck(pub(), '2026-10-26', '2026-10-23', NY, T0)).toBeNull();
    expect(moveCheck(pub(), '2026-10-22', '2026-10-23', NY, T0)).toBe(COPY.pastDay);
    expect(moveCheck(pub({ time: '09:00', dueAt: dueAtIso('2026-10-24', '09:00', NY) }), '2026-10-23', '2026-10-23', NY, T0)).toBe(COPY.pastTime);
    expect(moveCheck(pub(), '2026-10-26', '2026-10-24', NY, due - 60_000)).toBe(COPY.lockedMove);
    expect(moveCheck(pub({ status: 'posted' }), '2026-10-26', '2026-10-23', NY, T0)).toBe(COPY.notScheduled);
  });
});

describe('panel state and Schedule all', () => {
  const post = (p: Partial<Pub> | null, extra: any = {}) => ({ text: 'hello', imageMeta: { bytes: 1000, type: 'image/png' }, pub: p ? pub(p) : null, ...extra });
  it('walks the §3 states in prototype order', () => {
    expect(packPanelState('reddit', post(null), [X], null, T0)).toBe('copy_only');
    expect(packPanelState('x', post(null), [PROF], null, T0)).toBe('not_connected');
    expect(packPanelState('x', post(null), [X], X, T0)).toBe('ready');
    expect(packPanelState('x', post({}), [X], X, T0)).toBe('scheduled');
    expect(packPanelState('x', post({}), [X], X, Date.parse(pub().dueAt) - 60_000)).toBe('sending');
    expect(packPanelState('x', post({ status: 'posted' }), [X], X, T0)).toBe('posted');
    expect(packPanelState('x', post({ status: 'failed' }), [X], X, T0)).toBe('failed');
    expect(packPanelState('x', post({ held: true }), [{ ...X, expired: true }], { ...X, expired: true }, T0)).toBe('expired');
  });
  it('dims rows with the prototype reasons', () => {
    expect(showScheduleAll(['linkedin', 'x', 'reddit'])).toBe(true); expect(showScheduleAll(['linkedin', 'facebook'])).toBe(false);
    expect(scheduleAllWhy('reddit', post(null), [X], T0)).toBe('Copy and paste');
    expect(scheduleAllWhy('x', post({ status: 'posted' }), [X], T0)).toBe('Already posted');
    expect(scheduleAllWhy('x', post({}), [X], Date.parse(pub().dueAt))).toBe('Sending soon');
    expect(scheduleAllWhy('x', post(null), [], T0)).toBe('Not connected');
    expect(scheduleAllWhy('x', post(null), [{ ...X, expired: true }], T0)).toBe('Reconnect needed');
    expect(scheduleAllWhy('x', post(null, { text: 'a'.repeat(300) }), [X], T0)).toBe('Fix issues first');
    expect(scheduleAllWhy('linkedin', post({ platform: 'linkedin' }), [PAGE], T0)).toBeNull();
  });
});

describe('X replies', () => {
  const reply = (p: Partial<BriefItem> = {}) => ({ kind: 'reply' as const, plat: 'x' as const, url: 'https://x.com/someone/status/1843000000000000001', title: 'Any tips @FieldnoteApp?', body: '', replyTo: null, ...p });
  it('parses status ids and mentions', () => {
    expect(xStatusId('https://x.com/a_b/status/1843000000000000001?s=20')).toBe('1843000000000000001');
    expect(xStatusId('https://twitter.com/a/status/12')).toBe('12');
    expect(xStatusId('https://x.com/a')).toBeNull();
    expect(mentions('hey @fieldnoteapp!', '@fieldnoteapp')).toBe(true);
    expect(mentions('hey @fieldnoteapp2', '@fieldnoteapp')).toBe(false);
    expect(mentions('mail me@fieldnoteapp', '@fieldnoteapp')).toBe(false);
  });
  it('Reply now always opens X\'s reply box, connected or not, when the thread has a status id', () => {
    expect(briefPublish([X], reply({ title: 'no mention' }))).toMatchObject({ platform: 'x', can: true, direct: true, replyMode: 'intent' });
    expect(briefPublish([X], reply())).toMatchObject({ direct: true, replyMode: 'intent' });
    expect(briefPublish([], reply())).toMatchObject({ direct: true, replyMode: 'intent' });
    expect(briefPublish([{ ...X, expired: true }], reply())).toMatchObject({ direct: true, replyMode: 'intent' });
    expect(briefPublish([X], reply({ url: 'https://x.com/someone' }))).toMatchObject({ direct: false, replyMode: null });
    expect(xReplyMode(reply())).toBe('intent');
    expect(xReplyMode(reply({ plat: 'reddit' }))).toBeNull();
  });
  it('builds the X reply-box URL', () => {
    expect(xReplyIntentUrl('1843', 'Try a change log & a weekly review?')).toBe('https://x.com/intent/tweet?in_reply_to=1843&text=Try%20a%20change%20log%20%26%20a%20weekly%20review%3F');
  });
  it('routes brief posts and refuses non-postable platforms', () => {
    expect(briefPublish([X, PROF, PAGE], { kind: 'post', pl: 'linkedin', acct: 'company', title: '' })).toMatchObject({ platform: 'linkedin', direct: true });
    expect(briefPublish([X, PROF, PAGE], { kind: 'post', pl: 'linkedin', acct: 'company', title: '' }).acct?.id).toBe('a3');
    expect(briefPublish([X, { ...PROF, expired: true }], { kind: 'post', pl: 'linkedin', title: '' })).toMatchObject({ can: true, direct: false });
    expect(briefPublish([X], { kind: 'reply', plat: 'reddit', title: '' })).toMatchObject({ can: false, direct: false, platform: null });
  });
});

describe('sending helpers', () => {
  it('escapes LinkedIn little-text reserved characters but keeps hashtags', () => {
    expect(liCommentary('Scope (v2) is *done* — see [notes] @maya_c #scope #1 a#b \\ ~ | {x} <y>'))
      .toBe('Scope \\(v2\\) is \\*done\\* — see \\[notes\\] \\@maya\\_c #scope #1 a\\#b \\\\ \\~ \\| \\{x\\} \\<y\\>');
    expect(liCommentary('#launch day')).toBe('#launch day');
  });
  it('matches sent text against X read-back with t.co links', () => {
    expect(normForMatch('New post:  https://fieldnote.app/blog/x\nRead it')).toBe(normForMatch('New post: https://t.co/abc123 Read it'));
  });
});

describe('cost and expiry', () => {
  it('estimates X cost per publish (links cost more) and LinkedIn as free', () => {
    expect(publishCostUsd('x', 'post', 'plain post')).toBe(0.015);
    expect(publishCostUsd('x', 'post', 'read https://fieldnote.app/blog')).toBe(0.2);
    expect(publishCostUsd('x', 'reply', 'https://a.b')).toBe(0.01);
    expect(publishCostUsd('linkedin', 'post', 'https://a.b')).toBe(0);
  });
  it('flags posts due after a LinkedIn token ends', () => {
    const a = { ...PROF, expiresAt: '2026-11-01T12:00:00.000Z' };
    expect(expiresBefore(a, Date.parse('2026-11-02T00:00:00Z'))).toBe(true);
    expect(expiresBefore(a, Date.parse('2026-10-30T00:00:00Z'))).toBe(false);
    expect(expiresBefore(X, Date.parse('2030-01-01T00:00:00Z'))).toBe(false);
    expect(expiryNote(a, NY)).toBe('LinkedIn profile access for Maya Chen ends Sun, Nov 1. Reconnect before then, or this post waits until you do.');
  });
});

describe('copy', () => {
  it('appends "Nothing was published." except for unknown outcomes', () => {
    expect(failedLine({ platform: 'x', code: 'rate_limit', err: errCopy('rate_limit', 'x') })).toBe('X is limiting posts right now. Try again later. Nothing was published.');
    expect(failedLine({ platform: 'linkedin', code: 'unknown', err: null })).toBe('Radar couldn’t confirm the post went out. Check LinkedIn before trying again.');
  });
});

describe('socialItems', () => {
  it('collects pack and brief pubs, sorted by send time, with held and locked flags', () => {
    const B = {
      social: { accounts: [{ ...X, expired: true }, PAGE], packs: [{ id: 'p1', name: 'Scope creep', posts: {
        x: { pub: pub() }, linkedin: { pub: pub({ platform: 'linkedin', acct: 'a3', date: '2026-10-23', time: '10:02', dueAt: dueAtIso('2026-10-23', '10:02', NY) }) }, reddit: { pub: null },
      } }] },
      brief: { days: { '2026-10-23': { items: [
        { id: 'x:1', kind: 'post', title: 'Feed post', pub: pub({ platform: 'linkedin', acct: 'a3', date: '2026-10-25', time: '17:00', dueAt: dueAtIso('2026-10-25', '17:00', NY), direct: true }) },
        { id: 'x:2', kind: 'reply', title: 'Copied by hand', pub: pub({ status: 'posted', direct: false }) },
      ] } } },
    } as unknown as Pick<Workspace, 'social' | 'brief'>;
    const items = socialItems({ ...B, social: { ...B.social, packs: B.social.packs.map(p => ({ ...p, posts: { ...p.posts, x: { pub: { ...p.posts.x!.pub!, held: true } } } })) } } as any, T0);
    expect(items.map(i => i.id)).toEqual(['s:p1:linkedin', 's:p1:x', 'b:2026-10-23:x:1']);
    expect(items[0]).toMatchObject({ locked: true, held: false, acctLabel: 'Fieldnote · Page', k: 'linkedin' });
    expect(items[1]).toMatchObject({ locked: false, held: true, acctLabel: '@fieldnoteapp' });
    expect(items[2]).toMatchObject({ src: 'brief', day: '2026-10-23', itemId: 'x:1', k: 'linkedin' });
    expect(scheduledCount(B.social.packs[0].posts as any)).toBe(2);
  });
});
