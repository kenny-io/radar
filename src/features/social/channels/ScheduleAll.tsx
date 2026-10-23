'use client';
// Schedule all — port of ScheduleAll (prototype/radar-channels.jsx): one day, Staggered or Same time, an account per
// platform when there's a choice, and dimmed rows with the reason. `social.scheduleAll` is all or nothing.
import React, { useEffect, useState } from 'react';
import { useApp } from '@/client/app';
import { PlatLogo } from '@/components/brand';
import { Btn, Modal, Seg, Status } from '@/components/ui';
import { accountsOf, acctLabel, isPastSlot, showScheduleAll } from '@/lib/socialPublish';
import { plat } from '@/lib/constants';
import { addDays, fmtDW, fmtTime } from '@/lib/format';
import type { SocialPack } from '@/lib/types';
import { packKeys } from '../PackThumb';
import { DayPick, TimeSel, TzNote } from './ScheduleModal';
import { scheduleAllRows } from './logic';
import { useNowMs } from './useSocial';

export function ScheduleAll({ pack }: { pack: SocialPack }) {
  const app = useApp(); const { toast } = app; const B = app.B!; const now = useNowMs();
  const keys = packKeys(pack);
  const [open, setOpen] = useState(false); const [d, setD] = useState(addDays(B.today, 1)); const [mode, setMode] = useState<'stagger' | 'same'>('stagger'); const [same, setSame] = useState('09:00');
  const [times, setTimes] = useState<Record<string, string>>({}); const [acc, setAcc] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setD(addDays(B.today, 1)); setTimes({}); setAcc({}); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!showScheduleAll(keys)) return null;
  const rows = scheduleAllRows(pack, keys, accountsOf(B), now, { mode, same, times, acc });
  const go = rows.filter(r => !r.why && r.a); const past = go.some(r => isPastSlot(d, r.time, B.tz, now));
  const save = async () => {
    setBusy(true);
    try {
      await app.flushLater();
      const r = await app.act<{ scheduled: number }>('social.scheduleAll', { packId: pack.id, date: d, rows: go.map(x => ({ platform: x.k, time: x.time, acctId: x.a!.id })) });
      const n = r?.scheduled ?? go.length;
      setOpen(false); toast(`${n} post${n === 1 ? '' : 's'} scheduled for ${fmtDW(d)}`, { tone: 'ok' });
    } catch { /* toasted; the window stays open */ }
    setBusy(false);
  };
  return <><Btn icon="calendar" onClick={() => setOpen(true)}>Schedule all</Btn>
    <Modal open={open} onClose={() => setOpen(false)} dismissable={!busy} width={540} label="Schedule this pack"><div className="col" style={{ padding: 30, gap: 20 }}>
      <div className="col" style={{ gap: 6 }}><h2 className="h2">Schedule this pack</h2><p className="sub small">Every connected platform goes out on the same day.</p></div>
      <DayPick d={d} setD={setD} />
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}><span className="small grow">Timing</span><Seg value={mode} onChange={setMode} options={[{ v: 'stagger' as const, l: 'Staggered' }, { v: 'same' as const, l: 'Same time' }]} />{mode === 'same' && <TimeSel v={same} set={setSame} />}</div>
      <div className="col" style={{ borderTop: '1px solid var(--line2)' }}>{rows.map(r => {
        const l = plat(r.k).l; const moves = !r.why && r.post.pub?.status === 'scheduled';
        return <div key={r.k} className="row" style={{ gap: 12, padding: '12px 0', borderBottom: '1px solid var(--line2)', opacity: r.why ? .5 : 1, flexWrap: 'wrap' }}>
          <PlatLogo k={r.k} s={18} /><span className="col grow" style={{ minWidth: 120 }}><span className="small" style={{ fontWeight: 500 }}>{l}</span><span className="xs sub">{r.why || (r.as.length > 1 ? '' : acctLabel(r.a))}{moves ? (r.as.length > 1 ? '' : ' · ') + `moves from ${fmtDW(r.post.pub!.date)}` : ''}</span></span>
          {!r.why && r.as.length > 1 && <select className="input" style={{ width: 170, height: 36, fontSize: 13 }} value={r.a?.id} onChange={e => setAcc({ ...acc, [r.k]: e.target.value })} aria-label={l + ' account'}>{r.as.map(a => <option key={a.id} value={a.id}>{acctLabel(a)}</option>)}</select>}
          {!r.why && (mode === 'stagger' ? <TimeSel v={r.time} set={v => setTimes({ ...times, [r.k]: v })} label={l + ' time'} w={120} /> : <span className="small sub num">{fmtTime(r.time)}</span>)}
        </div>;
      })}</div>
      <TzNote />
      {past && <Status tone="warn">A time has passed. Pick a later day or time.</Status>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><Btn kind="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Btn><Btn kind="primary" icon="calendar" loading={busy} disabled={!go.length || past} onClick={save}>{go.length ? `Schedule ${go.length} post${go.length > 1 ? 's' : ''}` : 'Nothing to schedule'}</Btn></div>
    </div></Modal></>;
}
