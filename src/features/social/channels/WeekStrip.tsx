'use client';
// Dashboard → This week — port of WeekStrip (prototype/radar-channels.jsx): today plus the next 6 days, articles filled and
// social posts outlined. Under 860px of container width it becomes one row per day (radar.css `.wk-*`).
import React, { useState } from 'react';
import { useApp } from '@/client/app';
import { Icon } from '@/components/ui';
import { socialItems } from '@/lib/socialPublish';
import { addDays } from '@/lib/format';
import { SocialChip } from './SocialChip';
import { dropKind } from './logic';
import { moveSocial, openSocial, useNowMs } from './useSocial';

export function WeekStrip() {
  const app = useApp(); const { go } = app; const B = app.B!; const now = useNowMs();
  const t = B.today; const days = Array.from({ length: 7 }, (_, i) => addDays(t, i)); const [over, setOver] = useState<string | null>(null);
  const soc = socialItems(B, now); const arts = B.calendar.entries;
  if (!days.some(d => arts.some(e => e.date === d) || soc.some(s => s.date === d))) return <p className="small sub" style={{ padding: '12px 0', borderTop: '1px solid var(--line2)' }}>Nothing scheduled this week. <a href="#" onClick={e => { e.preventDefault(); if (arts.length) go('calendar'); else go('social', { generate: true }); }}>{arts.length ? 'Open the calendar' : 'Create social posts'}</a></p>;
  return <div className="wk-wrap"><div className="wk" style={{ border: '1px solid var(--line)', borderRadius: 18, overflow: 'hidden', background: 'var(--surface)' }}>
    {days.map((d, i) => {
      const dt = new Date(d + 'T12:00'); const es = arts.filter(e => e.date === d); const ss = soc.filter(s => s.date === d);
      return <div key={d} className={'wk-d' + (over === d ? ' drop-target' : '')} onDragOver={e => { e.preventDefault(); setOver(d); }} onDragLeave={() => setOver(o => (o === d ? null : o))}
        onDrop={e => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text'); if (id && dropKind(id) === 'social') moveSocial(app, id, d); }}
        style={{ minHeight: 150, padding: 8, borderRight: i < 6 ? '1px solid var(--line2)' : 0, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <span className="xs num wk-h" style={{ padding: '2px 4px 4px', color: d === t ? 'var(--signal-ink)' : 'var(--mute)', fontWeight: d === t ? 600 : 400 }}>{d === t ? 'Today' : dt.toLocaleDateString('en-US', { weekday: 'short' })} {dt.getDate()}</span>
        <div className="col wk-items" style={{ gap: 6, minWidth: 0 }}>
          {es.map(e => <button key={e.id} type="button" className="tap" onClick={() => go('calendar', { open: e.id })} style={{ textAlign: 'left', border: 0, background: 'var(--fill)', borderRadius: 9, padding: '7px 8px', cursor: 'pointer', display: 'flex', gap: 7, alignItems: 'flex-start', minWidth: 0, color: 'var(--ink)' }}><Icon n="doc" s={13} style={{ color: 'var(--mute)', flex: 'none', marginTop: 1 }} /><span className="xs" style={{ fontWeight: 500, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{e.title}</span></button>)}
          {ss.map(s => <SocialChip key={s.id} it={s} onOpen={x => openSocial(go, x)} />)}
        </div>
      </div>;
    })}
  </div></div>;
}
