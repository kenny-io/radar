import { describe, expect, it } from 'vitest';
import { COPY, dueAtIso, socialItems } from '@/lib/socialPublish';
import type { BriefItem, Pub, SocialAccount, SocialPack, Workspace } from '@/lib/types';
import { chipLabel, dropKind, findPub, planMove, scheduleAllRows, socialIssues, withPub } from './logic';

const TZ = 'America/New_York'; const TODAY = '2026-10-23';
const NOW = Date.parse('2026-10-23T15:00:00Z'); // 11:00 AM ET
const X: SocialAccount = { id: 'ax', ch: 'x', name: 'Fieldnote', handle: '@fieldnoteapp' };
const LP: SocialAccount = { id: 'alp', ch: 'li_profile', name: 'Maya Chen' };
const PG: SocialAccount = { id: 'apg', ch: 'li_page', name: 'Fieldnote' };
const pub = (p: Partial<Pub> & Pick<Pub, 'platform' | 'date' | 'time'>): Pub => ({ status: 'scheduled', acct: null, dueAt: dueAtIso(p.date, p.time, TZ), ...p });
const post = (text: string, p?: Pub | null) => ({ text, style: 'branded' as const, seed: 1, imageUrl: '/f.png', copiedAt: null, v: 1, imageMeta: { bytes: 1000, type: 'image/png' }, pub: p ?? null });
const item = (id: string, extra: Partial<BriefItem> = {}): BriefItem => ({ id, kind: 'post', pl: 'linkedin', plats: ['linkedin'], title: 'Post ' + id, tag: '', why: '', drafts: { linkedin: 'Hello' }, edits: {}, mention: false, st: 'open', ...extra });

function ws(o: { packs?: SocialPack[]; items?: BriefItem[]; accounts?: SocialAccount[] } = {}): Workspace {
  return { today: TODAY, tz: TZ, counts: { briefOpen: 0, review: 0, backlinksPending: 0, highSuggestions: 0 },
    social: { packs: o.packs || [], auto: {} as any, img: null, publishing: true, accounts: o.accounts || [X, LP, PG] },
    brief: { setup: true, settings: {} as any, days: { [TODAY]: { date: TODAY, scannedAt: '', items: o.items || [] } } } } as unknown as Workspace;
}
const pack = (id: string, posts: SocialPack['posts']): SocialPack => ({ id, name: 'Pack ' + id, source: { kind: 'idea', label: 'x' }, created: TODAY, style: 'branded', auto: false, posts });

describe('drop routing', () => {
  it('sends pack and Brief sids to social.move, everything else to the article move', () => {
    expect(dropKind('s:p1:linkedin')).toBe('social');
    expect(dropKind('b:2026-10-23:x:1849201')).toBe('social'); // Brief ids may contain ':' (the prototype only routed s:)
    expect(dropKind('e_123')).toBe('article');
    expect(dropKind('s:p1:reddit')).toBe('article'); // not a postable sid
  });
  it('finds Brief pubs whose item id contains a colon', () => {
    const B = ws({ items: [item('x:1849201', { kind: 'reply', plat: 'x', pub: pub({ platform: 'x', date: TODAY, time: '17:00' }) })] });
    expect(findPub(B, 'b:2026-10-23:x:1849201')?.pub?.time).toBe('17:00');
  });
});

describe('planMove (drag to another day)', () => {
  const B = ws({ packs: [pack('p1', { linkedin: post('hi', pub({ platform: 'linkedin', date: '2026-10-24', time: '09:00', acct: PG.id })), x: post('yo', pub({ platform: 'x', date: TODAY, time: '11:03', acct: X.id })) })],
    items: [item('i1', { st: 'scheduled', pub: pub({ platform: 'linkedin', date: TODAY, time: '17:00', direct: true }) })] });
  it('moves a pack post, keeping its time, with the prototype toast', () => {
    const r = planMove(B, 's:p1:linkedin', '2026-10-26', NOW);
    expect(r).toMatchObject({ kind: 'move', toast: 'LinkedIn post moved to Mon, Oct 26 at 9:00 AM ET' });
    if (r.kind === 'move') { expect(r.pub.date).toBe('2026-10-26'); expect(r.pub.time).toBe('09:00'); expect(r.pub.dueAt).toBe('2026-10-26T13:00:00.000Z'); }
  });
  it('moves a Brief post ("Post moved to …")', () => {
    expect(planMove(B, 'b:2026-10-23:i1', '2026-10-25', NOW)).toMatchObject({ kind: 'move', toast: 'Post moved to Sun, Oct 25 at 5:00 PM ET' });
  });
  it('refuses past days and locked posts with the shared copy; same day is a no-op', () => {
    expect(planMove(B, 's:p1:linkedin', '2026-10-22', NOW)).toEqual({ kind: 'refuse', msg: COPY.pastDay });
    expect(planMove(B, 's:p1:x', '2026-10-25', NOW)).toEqual({ kind: 'refuse', msg: COPY.lockedMove }); // 3 minutes before send
    expect(planMove(B, 's:p1:linkedin', '2026-10-24', NOW)).toEqual({ kind: 'noop' });
    expect(planMove(B, 's:nope:linkedin', '2026-10-25', NOW)).toEqual({ kind: 'noop' });
  });
});

describe('withPub (optimistic)', () => {
  it('schedules a Brief item: st becomes scheduled and the to-do count drops; clearing restores open', () => {
    const B = ws({ items: [item('i1'), item('i2')] });
    const p = pub({ platform: 'linkedin', date: TODAY, time: '17:00', direct: true });
    const B2 = withPub(B, 'b:2026-10-23:i1', p);
    expect(B2.brief.days[TODAY].items[0].st).toBe('scheduled'); expect(B2.counts.briefOpen).toBe(1);
    const B3 = withPub(B2, 'b:2026-10-23:i1', null);
    expect(B3.brief.days[TODAY].items[0].st).toBe('open'); expect(B3.counts.briefOpen).toBe(2);
  });
  it('sets a pack post pub without touching other posts', () => {
    const B = ws({ packs: [pack('p1', { linkedin: post('a'), x: post('b') })] });
    const B2 = withPub(B, 's:p1:x', pub({ platform: 'x', date: TODAY, time: '12:30' }));
    expect(B2.social.packs[0].posts.x!.pub?.time).toBe('12:30'); expect(B2.social.packs[0].posts.linkedin!.pub).toBeNull();
  });
});

describe('Needs attention', () => {
  it('failed: prototype copy, and no "Nothing was published." when the outcome is unknown', () => {
    const B = ws({ packs: [pack('p1', { linkedin: post('a', pub({ platform: 'linkedin', date: TODAY, time: '08:30', status: 'failed', code: 'rejected', err: 'LinkedIn rejected the post.' })) }),
      pack('p2', { linkedin: post('b', pub({ platform: 'linkedin', date: TODAY, time: '09:30', status: 'failed', code: 'unknown', err: 'Radar couldn’t confirm the post went out. Check LinkedIn before trying again.' })) })] });
    const [f] = socialIssues(B, NOW);
    expect(f).toMatchObject({ label: '2 posts didn’t go out', head: 'A LinkedIn post didn’t go out.', body: '“Pack p1” on LinkedIn: LinkedIn rejected the post. Nothing was published.' });
    expect(f.open?.id).toBe('s:p1:linkedin');
    const only = socialIssues(ws({ packs: [B.social.packs[1]] }), NOW)[0];
    expect(only.body).toBe('“Pack p2” on LinkedIn: Radar couldn’t confirm the post went out. Check LinkedIn before trying again.');
  });
  it('expired account: counts its held posts, and tolerates posts whose account is gone', () => {
    const exp = { ...X, expired: true };
    const B = ws({ accounts: [exp, LP], packs: [pack('p1', { x: post('a', pub({ platform: 'x', date: '2026-10-25', time: '12:30', acct: X.id, held: true })) }), pack('p2', { x: post('b', pub({ platform: 'x', date: '2026-10-25', time: '12:30', acct: null, held: false })) })] });
    const r = socialIssues(B, NOW).find(i => i.id === 'expax')!;
    expect(r).toMatchObject({ tone: 'warn', label: 'Reconnect X', head: 'Reconnect X to keep posting.', body: 'X access for @fieldnoteapp expired. 1 scheduled post is on hold.' });
  });
});

describe('calendar chip label', () => {
  it('carries the full text for hover and screen readers', () => {
    const B = ws({ packs: [pack('p1', { linkedin: post('a', pub({ platform: 'linkedin', date: '2026-10-24', time: '09:00', acct: PG.id })), x: post('b', pub({ platform: 'x', date: TODAY, time: '07:10', status: 'posted', acct: X.id })) })] });
    const [posted, sched] = socialItems(B, NOW);
    expect(chipLabel(sched)).toBe('LinkedIn · Scheduled 9:00 AM · Pack p1 · Fieldnote · Page · drag to another day');
    expect(chipLabel(posted)).toBe('X · Posted · Pack p1 · @fieldnoteapp');
  });
});

describe('Schedule all rows', () => {
  const B = ws({ accounts: [X, LP, PG] });
  const pk = pack('p1', { linkedin: post('a'), x: post('b'), reddit: post('c') });
  it('staggers by default, picks the page for LinkedIn, and lists dimmed rows last', () => {
    const rows = scheduleAllRows(pk, ['x', 'reddit', 'linkedin'], B.social.accounts!, NOW, { mode: 'stagger', same: '09:00', times: {}, acc: {} });
    expect(rows.map(r => [r.k, r.time, r.why, r.a?.id ?? null])).toEqual([['linkedin', '09:00', null, 'apg'], ['x', '12:30', null, 'ax'], ['reddit', '09:00', 'Copy and paste', null]]);
  });
  it('same time and an explicit account choice', () => {
    const rows = scheduleAllRows(pk, ['linkedin', 'x'], B.social.accounts!, NOW, { mode: 'same', same: '15:00', times: { x: '08:00' }, acc: { linkedin: 'alp' } });
    expect(rows.map(r => [r.k, r.time, r.a?.id])).toEqual([['linkedin', '15:00', 'alp'], ['x', '15:00', 'ax']]);
  });
  it('dims an expired-only platform as Reconnect needed', () => {
    const rows = scheduleAllRows(pk, ['linkedin', 'x'], [{ ...X, expired: true }, PG], NOW, { mode: 'stagger', same: '09:00', times: {}, acc: {} });
    expect(rows.find(r => r.k === 'x')?.why).toBe('Reconnect needed');
  });
});
