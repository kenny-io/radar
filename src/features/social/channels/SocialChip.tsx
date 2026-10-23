'use client';
// Calendar / This week item for a scheduled or sent post — port of SocialChip (prototype/radar-channels.jsx). Drag payload
// is the sid; on touch devices (pointer: coarse) a tap opens Move post instead of dragging.
import React, { useState } from 'react';
import { useApp } from '@/client/app';
import { PlatLogo } from '@/components/brand';
import { Btn } from '@/components/ui';
import { PLAT_L, atTz, shortTime, type SocialItem } from '@/lib/socialPublish';
import { fmtDW } from '@/lib/format';
import { ScheduleModal } from './ScheduleModal';
import { chipLabel, findPub, repub, rescheduleAction, withPub } from './logic';

export function SocialChip({ it, onOpen, compact }: { it: SocialItem; onOpen: (it: SocialItem) => void; compact?: boolean }) {
  const app = useApp(); const B = app.B!; const [mv, setMv] = useState(false);
  const draggable = it.status === 'scheduled' && !it.locked;
  const label = chipLabel(it);
  const click = () => { if (draggable && matchMedia('(pointer: coarse)').matches) setMv(true); else onOpen(it); };
  const tc = it.status === 'failed' ? 'var(--bad)' : it.held ? 'var(--warn)' : it.locked ? 'var(--signal-ink)' : 'var(--mute)';
  // Move post: the same day and time keeps its slot (social.move also works while the account is on hold); a new time reschedules.
  const save = ({ date, time }: { date: string; time: string }) => {
    setMv(false);
    const pub = findPub(B, it.id)?.pub; const toast = () => app.toast(`Moved to ${fmtDW(date)} at ${atTz(B.tz, date, time)}`);
    const how = rescheduleAction(pub || { status: it.status, date: it.date, time: it.time }, date, time); if (how === 'none') return;
    const opt = pub ? { optimistic: (b: typeof B) => withPub(b, it.id, repub(pub, date, time, B.tz)) } : {};
    (how === 'move' ? app.act('social.move', { sid: it.id, date }, opt) : app.act('social.schedule', { sid: it.id, date, time }, opt)).then(toast).catch(() => {});
  };
  return <>
    <button type="button" draggable={draggable} onDragStart={ev => { ev.dataTransfer.setData('text', it.id); ev.dataTransfer.effectAllowed = 'move'; }} onClick={click} className="tap soc-chip" aria-label={label} title={label}
      style={{ textAlign: 'left', border: 0, background: 'transparent', boxShadow: 'inset 0 0 0 1px var(--line2)', borderRadius: 9, padding: compact ? '5px 6px' : '6px 8px', display: 'flex', alignItems: 'center', gap: compact ? 5 : 7, cursor: draggable ? 'grab' : 'pointer', opacity: it.status === 'posted' ? .55 : 1, minWidth: 0, maxWidth: '100%', overflow: 'hidden', color: 'var(--ink)' }}>
      <span aria-hidden="true" style={{ display: 'inline-flex', flex: 'none' }}><PlatLogo k={it.k} s={13} /></span>
      <span className="xs num" style={{ color: tc, flex: compact ? '0 1 auto' : 'none', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.status === 'posted' ? (compact ? '✓' : 'Posted') : it.status === 'failed' ? (compact ? '!' : 'Failed') : it.held && !compact ? 'On hold' : shortTime(it.time)}</span>
      {!compact && <span className="xs trunc" style={{ minWidth: 0 }}>{it.name}</span>}
    </button>
    {draggable && <ScheduleModal open={mv} onClose={() => setMv(false)} title={`Move ${PLAT_L[it.k]} post`} sub={it.name} initial={{ date: it.date, time: it.time }}
      extra={<Btn kind="ghost" onClick={() => { setMv(false); onOpen(it); }}>Open post</Btn>} onSave={save} lockTime={it.held} />}
  </>;
}
