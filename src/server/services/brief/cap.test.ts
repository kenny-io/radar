// DBR-8 (owner decision 2026-10-26, "2 more later"): the first scan picks at most 2 replies per platform per account;
// later scans of the day bring each account up to 4 on a platform, counting every reply already in the day.
import { describe, expect, it } from 'vitest';
import type { BriefAccount, BriefItem, BriefPlatform } from '@/lib/types';
import { DAY_REPLIES, FIRST_SCAN_REPLIES, fitToCap, replyCap, slotsLeft } from './cap';
import { selectReplies, type Scored } from './rank';

let n = 0;
const reply = (plat: BriefPlatform, acct: BriefAccount = 'founder', st: BriefItem['st'] = 'open'): BriefItem => ({ id: `r${++n}`, kind: 'reply', plat, acct, st } as BriefItem);
const legacy = (plat: BriefPlatform): BriefItem => ({ id: `r${++n}`, kind: 'reply', plat, st: 'open' } as BriefItem);   // no acct = founder
const post = (): BriefItem => ({ id: `p${++n}`, kind: 'post', plats: ['x'], st: 'open' } as unknown as BriefItem);
const many = (k: number, f: () => BriefItem) => Array.from({ length: k }, f);
const scored = (plat: BriefPlatform, score: number, extra: Partial<Scored> = {}): Scored => ({ id: `${plat}:${++n}`, plat, score, reject: 'none', brand: false, asks: false, ...extra } as Scored);

describe('reply cap per platform per account', () => {
  it('is 2 on the first scan and 4 for the day on every later scan (Scan again, Keep, background rescans)', () => {
    expect([FIRST_SCAN_REPLIES, DAY_REPLIES]).toEqual([2, 4]);
    expect([replyCap('first'), replyCap('again'), replyCap('keep')]).toEqual([2, 4, 4]);
  });

  it('the first scan stops at 2 even when more threads clear the bar', () => {
    const left = slotsLeft([], 'founder', ['reddit', 'hn'], 'first');
    expect(left).toEqual({ reddit: 2, hn: 2 });
    const picked = selectReplies([scored('reddit', 0.9), scored('reddit', 0.8), scored('reddit', 0.7), scored('hn', 0.6)], ['reddit', 'hn'], left);
    expect(picked.map(s => s.plat)).toEqual(['reddit', 'reddit', 'hn']);
    expect(picked.map(s => s.score)).toEqual([0.9, 0.8, 0.6]);
  });

  it('a later scan with the morning’s 2 adds up to 2 more, and only threads that clear the bar', () => {
    const day = many(2, () => reply('reddit'));
    const left = slotsLeft(day, 'founder', ['reddit'], 'again');
    expect(left).toEqual({ reddit: 2 });
    const picked = selectReplies([scored('reddit', 0.9), scored('reddit', 0.4), scored('reddit', 0.8, { reject: 'hostile' }), scored('reddit', 0.7), scored('reddit', 0.6)], ['reddit'], left);
    expect(picked.map(s => s.score)).toEqual([0.9, 0.7]);
    expect(fitToCap(day, many(3, () => reply('reddit')), 'again')).toHaveLength(2);
  });

  it('with 4 already in the day a later scan adds none, whatever their status', () => {
    const day = [reply('x', 'founder', 'posted'), reply('x', 'founder', 'skipped'), reply('x', 'founder', 'expired'), legacy('x')];
    expect(slotsLeft(day, 'founder', ['x'], 'again')).toEqual({ x: 0 });
    expect(slotsLeft(day, 'founder', ['x'], 'keep')).toEqual({ x: 0 });
    expect(fitToCap(day, [reply('x')], 'again')).toEqual([]);
  });

  it('counts each account on its own, and feed posts not at all', () => {
    const day = [...many(4, () => reply('x', 'founder')), reply('x', 'company'), post(), post()];
    expect(slotsLeft(day, 'founder', ['x', 'linkedin'], 'again')).toEqual({ x: 0, linkedin: 4 });
    expect(slotsLeft(day, 'company', ['x', 'linkedin'], 'again')).toEqual({ x: 3, linkedin: 4 });
    const drafted = [reply('x', 'founder'), ...many(4, () => reply('x', 'company')), reply('linkedin', 'founder')];
    const added = fitToCap(day, drafted, 'again');
    expect(added.map(i => `${i.acct}:${i.plat}`)).toEqual(['company:x', 'company:x', 'company:x', 'founder:linkedin']);
  });

  it('re-checked under the lock: never a thread already in the day, and the first-scan cap where it applies', () => {
    const day = [reply('hn')];
    expect(fitToCap(day, [day[0], reply('hn'), reply('hn')], 'again')).toHaveLength(2);
    expect(fitToCap(day, [day[0], reply('hn'), reply('hn')], 'first')).toHaveLength(1);
  });
});
