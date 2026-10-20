'use client';
// Social Marketing library — port of SocialMarketing (prototype/radar-social.jsx). Routes: ?generate=1 opens the flow,
// ?pack=ID shows the pack. Radar never posts to social platforms for the user (README §2.5 #1).
import { PlatName } from '@/components/brand';
import React, { useEffect, useState } from 'react';
import { useApp } from '@/client/app';
import { Btn, Empty, PageHead, Status } from '@/components/ui';
import { plat } from '@/lib/constants';
import { fmtTime } from '@/lib/format';
import { PackThumb } from './PackThumb';
import { SocialFlow } from './SocialFlow';
import { PackView } from './PackView';
import { AutoModal } from './AutoModal';

export function SocialMarketing() {
  const app = useApp(); const { route, go } = app; const B = app.B!;
  const packs = B.social.packs;
  const [flow, setFlow] = useState(!!(route.params && route.params.generate)); const [auto, setAuto] = useState(false);
  const packId = route.params && route.params.pack; const pack = packs.find(p => p.id === packId);
  useEffect(() => { if (route.params && route.params.generate) setFlow(true); }, [route.params]);
  if (pack) return <PackView pack={pack} />;
  const a = B.social.auto;
  return <div className="page">
    <PageHead title="Social Marketing" sub="Platform-ready posts and visuals in your brand. You copy and publish them yourself — Radar never posts for you.">
      <Btn kind="primary" icon="plus" onClick={() => setFlow(true)}>Generate social posts</Btn>
    </PageHead>
    <div className="row small" style={{ gap: 14, margin: '-14px 0 30px', flexWrap: 'wrap' }}>
      {a.on ? <><Status tone="ok">Auto-generating {a.freq === 'daily' ? 'daily' : a.days.join(', ')} at {fmtTime(a.time)}</Status><span className="sub"><span style={{ display: 'inline-flex', gap: 12, verticalAlign: 'middle', marginRight: 6 }}>{a.platforms.map(k => <PlatName key={k} k={k} l={plat(k).l} s={14} gap={6} />)}</span>· saved to your library</span></> : <span className="sub">Automatic generation is off.</span>}
      <Btn kind="link" className="small" onClick={() => setAuto(true)}>{a.on ? 'Edit' : 'Set up'}</Btn>
    </div>
    {packs.length ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 18 }}>{packs.map(p => <PackThumb key={p.id} p={p} brand={B.profile.brand} onClick={() => go('social', { pack: p.id })} />)}</div>
      : <Empty icon="social" title="Your content library is empty" body="Start from an idea, an article URL, or one of your Radar articles. Each pack has copy and visuals for every platform you pick."><Btn kind="primary" icon="plus" onClick={() => setFlow(true)}>Generate social posts</Btn></Empty>}
    <SocialFlow open={flow} onClose={() => { setFlow(false); if (route.params && route.params.generate) go('social'); }} />
    <AutoModal open={auto} onClose={() => setAuto(false)} />
  </div>;
}
