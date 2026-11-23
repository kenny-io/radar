'use client';
// Social Marketing library — port of SocialMarketing (prototype/radar-social.jsx). Routes: ?generate=1 opens the flow,
// ?write=1 opens "Write a post" (a custom pack the user writes), ?pack=ID shows the pack; ?auto=1 opens draft settings. Autonomous publication requires explicit scheduling or Autopilot.
import { PlatName } from '@/components/brand';
import React, { useEffect, useState } from 'react';
import { routeToUrl, useApp } from '@/client/app';
import { Btn, Empty, PageHead, Status } from '@/components/ui';
import { plat, tzShort } from '@/lib/constants';
import { fmtTime, todayIn } from '@/lib/format';
import { accountsOf } from '@/lib/socialPublish';
import { autoSchedules } from './channels/logic';
import { PackThumb } from './PackThumb';
import { filterPacks, libraryParams, libraryQuery, packParams, statusCounts, type LibraryStatus } from './library';
import { SocialFlow } from './SocialFlow';
import { PackView } from './PackView';
import { AutoModal } from './AutoModal';
import { CustomPostComposer } from './CustomPostComposer';

export function SocialMarketing() {
  const app = useApp(); const { route, go } = app; const B = app.B!;
  const packs = B.social.packs; const pubOn = !!B.social.publishing;
  const [flow, setFlow] = useState(!!(route.params && route.params.generate)); const [auto, setAuto] = useState(!!route.params?.auto); const [write, setWrite] = useState(!!route.params?.write);
  const parsedQuery = libraryQuery(route.params); const query = pubOn ? parsedQuery : { q: parsedQuery.q }; const packId = typeof route.params?.pack === 'string' ? route.params.pack : route.params?.pack === true ? '1' : ''; const pack = packs.find(p => p.id === packId);
  useEffect(() => { if (route.params && route.params.generate) setFlow(true); }, [route.params]);
  useEffect(() => { if (route.params?.auto) setAuto(true); }, [route.params, B.role]);
  useEffect(() => { if (route.params?.write && B.role !== 'Viewer') setWrite(true); }, [route.params, B.role]);
  if (pack) return <PackView key={pack.id} pack={pack} library={query} />;
  if (packId) return <div className="page"><PageHead title="Pack unavailable" sub="This pack isn’t available in this business." /><a className="btn btn-secondary" href={routeToUrl('social', libraryParams(query))}>Open content library</a></div>;
  const a = B.social.auto; const program = !!B.autopilot?.enabled;
  const autoJob = app.jobFor('social.autoRun');
  const jobDate = autoJob?.ref && /^\d{4}-\d{2}-\d{2}$/.test(autoJob.ref) ? autoJob.ref : autoJob ? todayIn(B.tz, new Date(autoJob.createdAt)) : null;
  const preparing = autoJob?.status === 'queued' || autoJob?.status === 'running';
  const failed = a.on && autoJob?.status === 'failed' && !packs.some(p => p.auto && jobDate && p.created >= jobDate);
  const canEdit = B.role !== 'Viewer';
  const visible = filterPacks(packs, query, pubOn); const counts = statusCounts(packs);
  const updateLibrary = (next: typeof query) => go('social', libraryParams(next), { replace: true, scroll: false });
  const clearFilters = () => updateLibrary({ q: '' });
  return <div className="page">
    <PageHead title="Social Marketing" sub={program ? 'Autopilot prepares posts from your Business Profile, calendar and blog, then publishes or schedules them through connected accounts.' : 'Radar prepares social posts from your Business Profile, content calendar and blog articles. Review and edit each pack when you’re ready.'}>
      <Btn kind="secondary" icon="edit" disabled={!canEdit} onClick={() => setWrite(true)}>Write a post</Btn>
      <Btn kind="primary" icon="plus" disabled={!canEdit} onClick={() => setFlow(true)}>Generate social posts</Btn>
    </PageHead>
    <div className="row small" style={{ gap: 14, margin: '-14px 0 30px', flexWrap: 'wrap' }}>
      {a.on || program ? <><Status tone="ok" style={{ whiteSpace: 'normal' }}>{program ? 'Autopilot · ' : 'Drafts '}{a.freq === 'daily' ? 'daily' : a.days.join(', ')} from {fmtTime(a.time)} {tzShort(B.tz)}</Status><span className="sub"><span style={{ display: 'inline-flex', gap: 12, verticalAlign: 'middle', marginRight: 6, flexWrap: 'wrap' }}>{a.platforms.map(k => <PlatName key={k} k={k} l={plat(k).l} s={14} gap={6} />)}</span>{program ? '· autonomous publishing enabled' : autoSchedules(B) ? '· auto-scheduling enabled' : '· saved for your review'}</span></> : <span className="sub">Automatic drafts are paused. You can still generate a pack whenever you want.</span>}
      <Btn kind="link" className="small" onClick={() => setAuto(true)}>Draft settings</Btn>{pubOn && canEdit && !accountsOf(B).length && <Btn kind="link" className="small" onClick={() => go('settings', { social: true })}>Connect social accounts</Btn>}
    </div>
    {(preparing || failed) && <div role="status" className="col" style={{ gap: 8, marginBottom: 24 }}>
      <Status tone={failed ? 'warn' : 'ink'} pulse={preparing} style={{ whiteSpace: 'normal' }}>{failed ? 'Radar couldn’t prepare your latest social pack.' : 'Radar is preparing your next social pack.'}</Status>
      <p className="small sub">{failed ? 'You can generate a pack now. Automatic drafts will try again on your next scheduled day.' : 'It will appear here when it’s ready. You can keep working while Radar writes.'}</p>
    </div>}
    <section className="col" aria-labelledby="social-library-heading" style={{ gap: 18 }}>
      <div className="col" style={{ gap: 5 }}><h2 id="social-library-heading" className="h2">Content library</h2><p className="small sub">Your saved drafts, scheduled posts and published packs.</p></div>
      <div className="col" style={{ gap: 12 }}>
        <label className="col small" style={{ gap: 7, maxWidth: 520 }}><span>Search saved packs</span><input type="search" className="input" maxLength={120} value={query.q} placeholder="Search by name, topic or platform" onChange={event => updateLibrary({ ...query, q: event.target.value })} /></label>
        {pubOn && <div className="row" role="group" aria-label="Filter packs by status" style={{ flexWrap: 'wrap', gap: 8 }}>
          <Btn size="sm" kind={!query.status ? 'primary' : 'secondary'} aria-pressed={!query.status} onClick={clearFilters}>All packs ({packs.length})</Btn>
          {([['draft', 'Drafts'], ['scheduled', 'Scheduled'], ['posted', 'Posted'], ['mixed', 'Mixed']] as [LibraryStatus, string][]).map(([status, label]) => <Btn key={status} size="sm" kind={query.status === status ? 'primary' : 'secondary'} aria-pressed={query.status === status} onClick={() => updateLibrary({ ...query, status })}>{label} ({counts[status]})</Btn>)}
        </div>}
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}><span className="xs sub" role="status" aria-live="polite">{visible.length} of {packs.length} {packs.length === 1 ? 'pack' : 'packs'}</span>{(query.q || query.status) && <Btn size="sm" kind="link" onClick={clearFilters}>Clear filters</Btn>}</div>
      </div>
      {packs.length ? visible.length ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(240px,100%),1fr))', gap: 18 }}>{visible.map(p => { const params = packParams(p.id, pubOn ? query : { q: query.q }); return <PackThumb key={p.id} p={p} brand={B.profile.brand} href={routeToUrl('social', params)} onOpen={() => go('social', params)} />; })}</div>
        : <Empty icon="search" title="No packs match your search" body="Try another name, topic or platform, or clear the filters to see every saved pack."><Btn onClick={clearFilters}>Clear filters</Btn></Empty>
        : <Empty icon="social" title={preparing ? 'Your first social pack is on its way' : a.on || program ? 'Your next social posts start here' : 'Your content library is ready'} body={a.on || program ? `Radar prepares a pack ${a.freq === 'daily' ? 'each day' : 'on your selected days'} from ${fmtTime(a.time)} ${tzShort(B.tz)}. ${program ? 'Autopilot publishes or schedules supported posts and emails the owner when help is needed.' : autoSchedules(B) ? 'Auto-scheduling is enabled in Draft settings.' : pubOn ? 'Drafts stay here until you choose to post or schedule them.' : 'Edit, copy and publish them whenever you’re ready.'} Want a pack sooner? Write your own post or generate one.` : 'Write your own post, turn on automatic drafts in Draft settings, or generate a pack from an idea, an article URL or one of your Radar articles.'}><Btn kind="secondary" icon="edit" disabled={!canEdit} onClick={() => setWrite(true)}>Write a post</Btn><Btn kind="primary" icon="plus" disabled={!canEdit} onClick={() => setFlow(true)}>Generate social posts</Btn></Empty>}
    </section>
    <SocialFlow open={flow} onClose={() => { setFlow(false); if (route.params && route.params.generate) go('social', libraryParams(query)); }} />
    <CustomPostComposer open={write && canEdit} onClose={() => { setWrite(false); if (route.params?.write) go('social', libraryParams(query)); }} onSaved={packId => { setWrite(false); go('social', packParams(packId, query), route.params?.write ? { replace: true } : undefined); app.toast('Post saved. Add media and schedule each platform here.', { tone: 'ok' }); }} />
    <AutoModal open={auto} onClose={() => { setAuto(false); if (route.params?.auto) go('social', libraryParams(query)); }} />
  </div>;
}
