// RL-6: error toasts stay until dismissed and are announced as alerts; the three-toast limit never drops an error the
// user has not dismissed to make room for a status toast.
import { describe, expect, it } from 'vitest';
import { TOAST_MS, retainToasts, toastPlan, type ToastLike } from './toasts';

let n = 0;
const ok = (msg: string): ToastLike => ({ id: ++n, msg, tone: 'ok' });
const plain = (msg: string): ToastLike => ({ id: ++n, msg });
const bad = (msg: string): ToastLike => ({ id: ++n, msg, tone: 'bad' });
const msgs = (l: ToastLike[]) => l.map(t => t.msg);
const push = (l: ToastLike[], ...ts: ToastLike[]) => ts.reduce((acc, t) => retainToasts(acc, t), l);

describe('toastPlan', () => {
  it('an error has no timer and is an alert', () => {
    expect(toastPlan({ tone: 'bad' })).toEqual({ sticky: true, role: 'alert', ms: null });
    // A caller-supplied duration does not make an error leave by itself.
    expect(toastPlan({ tone: 'bad', ms: 1000 })).toEqual({ sticky: true, role: 'alert', ms: null });
  });
  it('every other tone is a status that leaves after 4.2 s, or after the duration the caller gave', () => {
    for (const tone of ['ok', 'warn', 'signal', null, undefined]) expect(toastPlan({ tone })).toEqual({ sticky: false, role: 'status', ms: 4200 });
    expect(TOAST_MS).toBe(4200);
    expect(toastPlan({ tone: 'ok', ms: 9000 }).ms).toBe(9000);
  });
});

describe('retainToasts', () => {
  it('status toasts behave as before: the newest three show', () => {
    expect(msgs(push([], ok('a'), plain('b'), ok('c'), plain('d')))).toEqual(['b', 'c', 'd']);
  });
  it('an undismissed error is not pushed out by newer status toasts', () => {
    const l = push([], bad('failed'), ok('a'), ok('b'), ok('c'), ok('d'));
    expect(msgs(l)).toEqual(['failed', 'c', 'd']);
  });
  it('a new error takes the place of the oldest status toast, not of another error', () => {
    expect(msgs(push([], ok('a'), bad('e1'), ok('b'), bad('e2')))).toEqual(['e1', 'b', 'e2']);
  });
  it('with three errors showing, a status toast still shows (as a fourth) and the errors all stay', () => {
    const three = push([], bad('e1'), bad('e2'), bad('e3'));
    const withStatus = retainToasts(three, ok('saved'));
    expect(msgs(withStatus)).toEqual(['e1', 'e2', 'e3', 'saved']);
    // The next status replaces that one: never more than one extra.
    expect(msgs(retainToasts(withStatus, ok('moved')))).toEqual(['e1', 'e2', 'e3', 'moved']);
  });
  it('only a newer error pushes out an error, and only when three are already showing', () => {
    expect(msgs(push([], bad('e1'), bad('e2'), bad('e3'), bad('e4')))).toEqual(['e2', 'e3', 'e4']);
  });
  it('the same error again replaces its earlier copy instead of stacking', () => {
    const l = push([], bad('Radar couldn’t finish this. Try again.'), ok('a'), bad('Radar couldn’t finish this. Try again.'));
    expect(msgs(l)).toEqual(['a', 'Radar couldn’t finish this. Try again.']);
    expect(l[1].id).toBe(n); // the newer one
    // The same words as a status toast are not merged.
    expect(push([], ok('Saved'), ok('Saved'))).toHaveLength(2);
  });
});
