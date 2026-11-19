'use client';
import React, { useEffect, useState } from 'react';
import { useApp } from '@/client/app';
import { Btn } from '@/components/ui';
import { legacyVideoStyle, type VideoStyleId } from '@/lib/videoStyles';
import { VideoStylePicker } from './VideoStylePicker';

export function VideoStyleDefaults() {
  const app = useApp(); const B = app.B!; const saved = legacyVideoStyle(B.social.auto.videoStyle);
  const [value, setValue] = useState<VideoStyleId>(saved); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { setValue(saved); }, [saved, B.id]);
  async function save() {
    if (busy || B.role === 'Viewer') return;
    setBusy(true); setError('');
    try { await app.act('social.videoStyleDefault', { videoStyle: value }, { silent: true }); app.toast('Default style saved. Existing packs keep their choices.'); }
    catch (e: any) { setError(e?.message || 'Radar couldn’t save your default style. Try again.'); }
    finally { setBusy(false); }
  }
  return <section className="col" aria-label="Default video & slide style" aria-busy={busy} style={{ gap: 12, borderTop: '1px solid var(--line2)', paddingTop: 18 }}>
    <h3 className="small" style={{ fontWeight: 600 }}>Default video & slide style</h3>
    <p className="xs sub">Used for new generation requests, including authorized automatic drafts. Existing packs keep their choices. Saving a style does not enable automation.</p>
    <VideoStylePicker value={value} onChange={setValue} disabled={busy || B.role === 'Viewer'} label="Default video & slide style" />
    {B.role !== 'Viewer' && <div><Btn size="sm" loading={busy} disabled={value === saved} onClick={save}>Save default style</Btn></div>}
    {error && <p role="alert" className="xs" style={{ color: 'var(--bad)' }}>{error}</p>}
  </section>;
}
