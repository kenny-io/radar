'use client';
// Activity (first-five RL-4): the bell in the shell with the member's unread count, and the panel listing Radar's
// notifications for the business, newest first. Opening the panel marks everything read for this member.
// The unread number is the workspace's count plus the toast events received since (client/liveUnread.ts).
// .factory/first-five-optimizations/architecture.md §4. Styles are in radar.css (a stylesheet imported here would be
// page-level CSS, which remounts the app provider: handoff-e2.md, deviation 1).
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/client/app';
import { actCall } from '@/client/api';
import { liveUnread } from '@/client/liveUnread';
import { Btn, Sheet, Skel, TONE } from '@/components/ui';
import { agoLabel, badgeText, bellLabel, internalHref, isNew } from './activity';
import type { ActivityItem } from '@/lib/types';

const PAGE = 20;
/** One row more than is shown is asked for, so "Load more" appears only when there really is more. */
const ASK = { limit: PAGE + 1 };
const cut = (items: ActivityItem[]) => ({ items: items.slice(0, PAGE), more: items.length > PAGE });
interface ListReply { items: ActivityItem[]; unread: number; seenAt: string }
interface PanelState { status: 'loading' | 'ready' | 'error'; items: ActivityItem[]; seenAt: string | null; more: boolean; loadingMore: boolean; moreError: boolean }
const EMPTY: PanelState = { status: 'loading', items: [], seenAt: null, more: false, loadingMore: false, moreError: false };
/** What a tone means, for readers who do not see the dot. */
const TONE_WORD: Record<string, string> = { bad: 'Problem: ', warn: 'Heads up: ' };

export function ActivityBell(): React.ReactElement | null {
  const app = useApp(); const { bid, B } = app; const router = useRouter();
  const [open, setOpen] = useState(false); const [st, setSt] = useState<PanelState>(EMPTY);
  const btn = useRef<HTMLButtonElement>(null); const panelId = useId(); const seq = useRef(0); const bidNow = useRef(bid); bidNow.current = bid;
  const live = useSyncExternalStore(liveUnread.subscribe, () => liveUnread.count(bid), () => 0);
  // A workspace from the server brings a fresh `counts` object: its number replaces the toasts counted since the last one.
  const counts = B?.counts;
  useLayoutEffect(() => { liveUnread.settle(bid); }, [counts, bid]);
  const unread = (counts?.activityUnread || 0) + live;

  const zero = useCallback(() => { app.setB(b => (b.counts.activityUnread ? { ...b, counts: { ...b.counts, activityUnread: 0 } } : b)); liveUnread.settle(bid); }, [app.setB, bid]); // eslint-disable-line react-hooks/exhaustive-deps
  /** First page, then mark read. The badge is zeroed only once the member could actually see the list. */
  const load = useCallback(async (quiet = false) => {
    // A fresh open starts a new generation (closing does too), so a late reply for an earlier one is dropped. A quiet
    // reload joins the current generation: it must not cancel a "Load more" that is under way.
    if (!bid) return; const mine = quiet ? seq.current : ++seq.current;
    if (!quiet) setSt(EMPTY);
    try {
      const r = (await actCall<ListReply>(bid, 'activity.list', ASK)).data!; const first = cut(r.items);
      if (seq.current !== mine) return;
      // A quiet reload (something arrived while the panel is open) adds the new rows on top and keeps the pages already loaded.
      setSt(s => (quiet && s.status === 'ready' ? { ...s, items: [...first.items.filter(x => !s.items.some(y => y.id === x.id)), ...s.items] } : { status: 'ready', ...first, seenAt: r.seenAt, loadingMore: false, moreError: false }));
      actCall(bid, 'activity.seen', {}).then(() => { if (bidNow.current === bid) zero(); }, () => { /* the count stays; the next open tries again */ });
    } catch { if (seq.current === mine && !quiet) setSt({ ...EMPTY, status: 'error' }); }
  }, [bid, zero]);
  const more = async () => {
    const last = st.items[st.items.length - 1]; if (!bid || !last || st.loadingMore) return; const mine = seq.current;
    setSt(s => ({ ...s, loadingMore: true, moreError: false }));
    try {
      const next = cut((await actCall<ListReply>(bid, 'activity.list', { ...ASK, before: last.id })).data!.items);
      if (seq.current !== mine) return;
      setSt(s => ({ ...s, items: [...s.items, ...next.items.filter(x => !s.items.some(y => y.id === x.id))], more: next.more, loadingMore: false }));
    } catch { if (seq.current === mine) setSt(s => ({ ...s, loadingMore: false, moreError: true })); }
  };
  const close = useCallback(() => { seq.current++; setOpen(false); }, []);
  const toggle = () => { if (open) { close(); return; } setOpen(true); load(); };
  // Something new arrived while the panel is open: show it (and mark it read) without closing anything.
  useEffect(() => { if (open && live > 0 && st.status === 'ready') load(true); }, [live]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { close(); }, [bid, close]);

  const follow = (href: string) => (ev: React.MouseEvent<HTMLAnchorElement>) => {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return; // a new tab is the browser's business
    ev.preventDefault(); close(); router.push(href);
  };
  const now = Date.now();
  return <>
    <button ref={btn} type="button" className={'btn btn-ghost btn-icon act-bell' + (open ? ' on' : '')} onClick={toggle} disabled={!bid} aria-label={bellLabel(unread)} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 21h4" /></svg>
      {unread > 0 && <span className="act-badge num" aria-hidden="true">{badgeText(unread)}</span>}
    </button>
    <Sheet open={open} onClose={close} width={420} title="Activity" id={panelId} label="Activity" focus={btn}>
      {st.status === 'loading' && <div className="col" style={{ gap: 18 }} role="status" aria-label="Loading activity">{[0, 1, 2, 3].map(i => <div key={i} className="col" style={{ gap: 8 }}><Skel w={i % 2 ? '72%' : '90%'} /><Skel w={70} h={10} /></div>)}</div>}
      {st.status === 'error' && <div className="col" style={{ gap: 12, alignItems: 'flex-start' }} role="alert"><p>Radar couldn’t load your activity.</p><Btn icon="refresh" onClick={() => load()}>Retry</Btn></div>}
      {st.status === 'ready' && !st.items.length && <p className="sub">Nothing yet. Radar will note finished drafts, failures and anything that needs you here.</p>}
      {st.status === 'ready' && st.items.length > 0 && <>
        <ul className="act-list">{st.items.map(it => {
          const href = internalHref(it.action?.href); const fresh = isNew(it.at, st.seenAt);
          return <li key={it.id} className="act-item">
            <i className="dot" style={{ background: TONE[it.tone || 'mute'] }} aria-hidden="true" />
            <div className="col grow" style={{ gap: 5 }}>
              <p className="act-msg">{it.tone && TONE_WORD[it.tone] && <span className="sr">{TONE_WORD[it.tone]}</span>}{it.msg}</p>
              <div className="row xs sub" style={{ gap: 10, flexWrap: 'wrap' }}>
                {fresh && <span className="act-new">New</span>}
                <time dateTime={it.at} title={new Date(it.at).toLocaleString()}>{agoLabel(it.at, now)}</time>
                {href && it.action && <a className="act-link" href={href} onClick={follow(href)}>{it.action.label}</a>}
              </div>
            </div>
          </li>;
        })}</ul>
        {st.more && <div className="col" style={{ gap: 8, marginTop: 16, alignItems: 'flex-start' }}><Btn size="sm" loading={st.loadingMore} onClick={more}>Load more</Btn>{st.moreError && <span className="xs" role="alert" style={{ color: 'var(--bad)' }}>Radar couldn’t load more. Try again.</span>}</div>}
      </>}
    </Sheet>
  </>;
}
