'use client';
// TEMPORARY dev-only test page for the publishing area. Delete before finishing.
import React, { useState } from 'react';
import { useApp } from '@/client/app';
import { Btn, Section, Status } from '@/components/ui';
import { PublishingSettings } from '@/features/publishing/PublishingSettings';
import { PublishIntro } from '@/features/publishing/PublishIntro';
import { BlogConnect, type BlogConnectProps } from '@/features/publishing/BlogConnect';

export default function Page() {
  const app = useApp(); const B = app.B;
  const [intro, setIntro] = useState(false); const [conn, setConn] = useState<BlogConnectProps['type']>(null);
  if (!B) return null;
  const ents = B.calendar.entries.filter(e => ['scheduled', 'publishing', 'published', 'failed'].includes(e.status));
  return <div className="page col" style={{ gap: 30, maxWidth: 860 }}>
    <Section title="Publishing"><PublishingSettings /></Section>
    <div className="row" style={{ gap: 10 }}><Btn id="open-intro" onClick={() => setIntro(true)}>Open PublishIntro</Btn></div>
    <div className="col" id="entries" style={{ gap: 8 }}>{ents.map(e => <div key={e.id} className="row small" style={{ gap: 10 }} data-entry={e.id}>
      <span className="grow">{e.title} · {e.date}</span><Status tone={e.status === 'failed' ? 'bad' : e.status === 'published' ? 'ok' : 'signal'}>{e.status}</Status>
      <span className="mono xs">{e.publishedUrl || ''}{e.publishError ? `${e.publishError.platform} returned ${e.publishError.message}` : ''}</span>
      {e.status === 'scheduled' && <Btn size="sm" onClick={() => app.act('publish.now', { entryId: e.id })}>Publish now</Btn>}
      {e.status === 'failed' && <Btn size="sm" onClick={() => app.act('publish.retry', { entryId: e.id })}>Retry</Btn>}
    </div>)}</div>
    <PublishIntro open={intro} onClose={() => setIntro(false)} onPick={k => { setIntro(false); setConn(k); }} onSkip={() => setIntro(false)} existing={B.blog.conns.map(c => c.type)} />
    <BlogConnect type={conn} onClose={() => setConn(null)} onSaved={c => { setConn(null); app.toast(c.type + ' saved', { tone: 'ok' }); }} />
  </div>;
}
