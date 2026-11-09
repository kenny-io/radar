'use client';
// Social Marketing library — port of SocialMarketing (prototype/radar-social.jsx). Routes: ?generate=1 opens the flow,
// ?pack=ID shows the pack; ?auto=1 opens draft settings. Autonomous publication requires explicit scheduling or Autopilot.
import { PlatName } from '@/components/brand';
import React, { useEffect, useState } from 'react';
import { useApp } from '@/client/app';
import { Btn, Empty, PageHead, Status } from '@/components/ui';
import { plat, tzShort } from '@/lib/constants';
import { fmtTime, todayIn } from '@/lib/format';
import { accountsOf } from '@/lib/socialPublish';
import { autoSchedules } from './channels/logic';
import { PackThumb } from './PackThumb';
import { SocialFlow } from './SocialFlow';
import { PackView } from './PackView';
import { AutoModal } from './AutoModal';

export function SocialMarketing() {
  const app = useApp(); const { route, go } = app; const B = app.B!;
  const packs = B.social.packs;
  const [flow, setFlow] = useState(!!(route.params && route.params.generate)); const [auto, setAuto] = useState(B.role !== 'Viewer' && !!route.params?.auto);
  const packId = route.params && route.params.pack; const pack = packs.find(p => p.id === packId);
  useEffect(() => { if (route.params && route.params.generate) setFlow(true); }, [route.params]);
  useEffect(() => { if (B.role !== 'Viewer' && route.params?.auto) setAuto(true); }, [route.params, B.role]);
  if (pack) return <PackView pack={pack} />;
  const a = B.social.auto; const pubOn = !!B.social.publishing; const program = !!B.autopilot?.enabled;
  const autoJob = app.jobFor('social.autoRun');
  const jobDate = autoJob?.ref && /^\d{4}-\d{2}-\d{2}$/.test(autoJob.ref) ? autoJob.ref : autoJob ? todayIn(B.tz, new Date(autoJob.createdAt)) : null;
  const preparing = autoJob?.status === 'queued' || autoJob?.status === 'running';
  const failed = a.on && autoJob?.status === 'failed' && !packs.some(p => p.auto && jobDate && p.created >= jobDate);
  const canEdit = B.role !== 'Viewer';
  return <div className="page">
    <PageHead title="Social Marketing" sub={program ? 'Autopilot prepares posts from your Business Profile, calendar and blog, then publishes or schedules them through connected accounts.' : 'Radar prepares social posts from your Business Profile, content calendar and blog articles. Review and edit each pack when you’re ready.'}>
      <Btn kind="primary" icon="plus" disabled={!canEdit} onClick={() => setFlow(true)}>Generate social posts</Btn>
    </PageHead>
    <div className="row small" style={{ gap: 14, margin: '-14px 0 30px', flexWrap: 'wrap' }}>
      {a.on || program ? <><Status tone="ok" style={{ whiteSpace: 'normal' }}>{program ? 'Autopilot · ' : 'Drafts '}{a.freq === 'daily' ? 'daily' : a.days.join(', ')} from {fmtTime(a.time)} {tzShort(B.tz)}</Status><span className="sub"><span style={{ display: 'inline-flex', gap: 12, verticalAlign: 'middle', marginRight: 6, flexWrap: 'wrap' }}>{a.platforms.map(k => <PlatName key={k} k={k} l={plat(k).l} s={14} gap={6} />)}</span>{program ? '· autonomous publishing enabled' : autoSchedules(B) ? '· auto-scheduling enabled' : '· saved for your review'}</span></> : <span className="sub">Automatic drafts are paused. You can still generate a pack whenever you want.</span>}
      {canEdit && <Btn kind="link" className="small" onClick={() => setAuto(true)}>Draft settings</Btn>}{pubOn && canEdit && !accountsOf(B).length && <Btn kind="link" className="small" onClick={() => go('settings', { social: true })}>Connect X or LinkedIn</Btn>}
    </div>
    {(preparing || failed) && <div role="status" className="col" style={{ gap: 8, marginBottom: 24 }}>
      <Status tone={failed ? 'warn' : 'ink'} pulse={preparing} style={{ whiteSpace: 'normal' }}>{failed ? 'Radar couldn’t prepare your latest social pack.' : 'Radar is preparing your next social pack.'}</Status>
      <p className="small sub">{failed ? 'You can generate a pack now. Automatic drafts will try again on your next scheduled day.' : 'It will appear here when it’s ready. You can keep working while Radar writes.'}</p>
    </div>}
    {packs.length ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 18 }}>{packs.map(p => <PackThumb key={p.id} p={p} brand={B.profile.brand} onClick={() => go('social', { pack: p.id })} />)}</div>
      : <Empty icon="social" title={preparing ? 'Your first social pack is on its way' : a.on || program ? 'Your next social posts start here' : 'Your content library is ready'} body={a.on || program ? `Radar prepares a pack ${a.freq === 'daily' ? 'each day' : 'on your selected days'} from ${fmtTime(a.time)} ${tzShort(B.tz)}. ${program ? 'Autopilot publishes or schedules supported posts and emails the owner when help is needed.' : autoSchedules(B) ? 'Auto-scheduling is enabled in Draft settings.' : pubOn ? 'Drafts stay here until you choose to post or schedule them.' : 'Edit, copy and publish them whenever you’re ready.'} Want a pack sooner? Start from an idea or article below.` : 'Turn on automatic drafts in Draft settings, or generate a pack from an idea, an article URL or one of your Radar articles.'}><Btn kind="primary" icon="plus" disabled={!canEdit} onClick={() => setFlow(true)}>Generate social posts</Btn></Empty>}
    <SocialFlow open={flow} onClose={() => { setFlow(false); if (route.params && route.params.generate) go('social'); }} />
    <AutoModal open={auto} onClose={() => { setAuto(false); if (route.params?.auto) go('social'); }} />
  </div>;
}
