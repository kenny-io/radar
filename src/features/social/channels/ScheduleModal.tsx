'use client';
// Schedule window — port of ScheduleModal / DayPick / TimeSel / TzNote (prototype/radar-channels.jsx). Days and times are
// in the business time zone (B.tz); past checks use the server-corrected clock.
import React, { useEffect, useState } from 'react';
import { useApp } from '@/client/app';
import { Btn, Modal, Status } from '@/components/ui';
import { TIME_SLOTS, dayOptions, expiresBefore, expiryNote, isPastSlot, tzLabel, tzNote, zonedTimeToUtc } from '@/lib/socialPublish';
import { fmtDW, fmtTime } from '@/lib/format';
import type { SocialAccount } from '@/lib/types';
import { useNowMs } from './useSocial';

/** The next 14 days as a 7×2 grid (business today first). */
export function DayPick({ d, setD }: { d: string; setD: (d: string) => void }) {
  const { B } = useApp(); const t = B!.today;
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gap: 6 }} role="radiogroup" aria-label="Day">{dayOptions(t).map(x => {
    const dt = new Date(x + 'T12:00'); const on = x === d;
    const wd = x === t ? 'Today' : dt.toLocaleDateString('en-US', { weekday: 'short' });
    return <button key={x} type="button" role="radio" aria-checked={on} aria-label={x === t ? 'Today' : fmtDW(x)} onClick={() => setD(x)} style={{ height: 54, border: 0, borderRadius: 11, cursor: 'pointer', background: on ? 'var(--ink)' : 'var(--fill)', color: on ? 'var(--on-ink)' : 'var(--ink)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, transition: 'background .2s,color .2s', minWidth: 0 }}>
      <span className="xs" style={{ opacity: on ? .75 : .6 }}>{wd}</span><span className="num" style={{ fontWeight: 600 }}>{dt.getDate()}</span></button>;
  })}</div>;
}

/** 6:00 AM–10:00 PM in 30-minute steps (a stored time off the grid stays selectable). */
export function TimeSel({ v, set, label = 'Time', w = 140, disabled }: { v: string; set: (v: string) => void; label?: string; w?: number; disabled?: boolean }) {
  const opts = TIME_SLOTS.includes(v) ? TIME_SLOTS : [...TIME_SLOTS, v].sort();
  return <select className="input" style={{ width: w, height: 36, fontSize: 13 }} value={v} disabled={disabled} onChange={e => set(e.target.value)} aria-label={label}>{opts.map(o => <option key={o} value={o}>{fmtTime(o)}</option>)}</select>;
}

/** "Times are in Eastern Time (ET). Change it in Settings → Publishing." */
export function TzNote() {
  const { B } = useApp(); const now = useNowMs();
  return <p className="xs sub" style={{ margin: 0 }}>{tzNote(B!.tz, now)}</p>;
}

export function ScheduleModal({ open, onClose, title, sub, initial, onSave, extra, acct, lockTime }: {
  open: boolean; onClose: () => void; title: string; sub?: string; initial: { date: string; time: string }; onSave: (v: { date: string; time: string }) => void; extra?: React.ReactNode;
  /** The account it will post as: shows `expiryNote` when its access ends before the chosen time (the post would be held). */
  acct?: SocialAccount | null;
  /** Keep the time fixed (a held post: its account is expired, so only a move to another day at the same time is possible). */
  lockTime?: boolean;
}) {
  const { B } = useApp(); const tz = B!.tz; const now = useNowMs();
  const [d, setD] = useState(initial.date); const [tm, setTm] = useState(initial.time);
  useEffect(() => { if (open) { setD(initial.date); setTm(initial.time); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const due = zonedTimeToUtc(d, tm, tz);
  const past = isPastSlot(d, tm, tz, now);
  const ends = !!acct && !past && expiresBefore(acct, due);
  return <Modal open={open} onClose={onClose} width={480} label={title}><div className="col" style={{ padding: 30, gap: 20 }}>
    <div className="col" style={{ gap: 6 }}><h2 className="h2">{title}</h2>{sub && <p className="sub small">{sub}</p>}</div>
    <DayPick d={d} setD={setD} />
    <div className="col" style={{ gap: 8 }}><div className="row" style={{ gap: 12 }}><span className="small grow">Time</span><TimeSel v={tm} set={setTm} disabled={lockTime} /><span className="small sub" style={{ minWidth: 22 }}>{tzLabel(tz, due).abbr}</span></div><TzNote /></div>
    {past && <Status tone="warn">That time has passed. Pick a later time.</Status>}
    {ends && <Status tone="warn" style={{ whiteSpace: 'normal', alignItems: 'baseline' }}>{expiryNote(acct!, tz)}</Status>}
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>{extra}<span className="grow" /><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn kind="primary" icon="calendar" disabled={past} onClick={() => onSave({ date: d, time: tm })}>{`Schedule for ${fmtDW(d)}`}</Btn></div>
  </div></Modal>;
}
