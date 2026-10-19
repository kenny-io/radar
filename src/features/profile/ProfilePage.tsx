'use client';
// Port of ProfilePage (prototype/radar-app.jsx). Autosaves through profile.update; Re-analyze runs job analysis.site keeping edits.
import React, { useEffect, useState } from 'react';
import { useApp } from '@/client/app';
import { Btn, PageHead } from '@/components/ui';
import { PROFILE_FIELDS, inferredLeft, type ProfileGroupKey } from '@/lib/constants';
import { ProfileGroup } from './ProfileGroup';
import type { Profile, Workspace } from '@/lib/types';

export function ProfilePage() {
  const app = useApp(); const B = app.B!;
  const [saved, setSaved] = useState<number | null>(null);
  const [run, setRun] = useState<{ jobId: string; edits: number } | null>(null);
  const onChange = (p: Profile, key: string) => {
    const edited = { ...B.edited, [key]: true as const };
    const optimistic = (b: Workspace) => ({ ...b, profile: p, edited: { ...b.edited, [key]: true as const } });
    const input = { profile: p, editedKeys: Object.keys(edited) };
    if (key === 'brand.logo') app.act('profile.update', input, { optimistic }).catch(() => {});
    else app.actLater('profile', 'profile.update', input, { optimistic });
    setSaved(Date.now());
  };
  const job = run ? (app.jobs[run.jobId] || B.jobs.find(j => j.id === run.jobId) || null) : null;
  useEffect(() => {
    if (!run || !job) return;
    if (job.status === 'done') { setRun(null); app.toast(`Re-analyzed ${B.profile.domain}. Your ${run.edits} edits were kept.`, { tone: 'ok' }); app.refresh(); }
    else if (job.status === 'failed') { setRun(null); app.toast(job.progress?.failed || job.error || 'Radar couldn’t finish this. Try again.', { tone: 'bad' }); }
  }, [job?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const reanalyze = async () => {
    const edits = Object.keys(B.edited).length;
    try { const r = await app.act<{ jobId: string }>('profile.reanalyze', {}); setRun({ jobId: r.jobId, edits }); } catch { /* toasted */ }
  };
  const inferred = (Object.keys(PROFILE_FIELDS) as ProfileGroupKey[]).reduce((n, g) => n + inferredLeft(B.edited, g), 0);
  return <div className="page" style={{ maxWidth: 860 }}>
    <PageHead title="Business Profile" sub={<span>Radar uses this for every topic, article, and post. {inferred > 0 && <span><span className="inf" style={{ verticalAlign: 1 }}><i />{inferred} inferred</span> fields haven’t been checked yet.</span>}</span>}>
      <span className="xs sub">{saved ? 'All changes saved' : ''}</span>
      <Btn icon="refresh" loading={!!run} onClick={reanalyze}>Re-analyze website</Btn>
    </PageHead>
    {([['business', 'Business'], ['audience', 'Audience'], ['keywords', 'Keywords'], ['brand', 'Brand']] as const).map(([g, l]) => <section key={g} style={{ padding: '34px 0', borderTop: '1px solid var(--line)' }}><h2 className="h2" style={{ marginBottom: 22 }}>{l}</h2><ProfileGroup group={g} profile={B.profile} edited={B.edited} onChange={onChange} gsc={B.gsc.status} measured={B.measured} suggestions={B.kwSuggestions} /></section>)}
  </div>;
}
