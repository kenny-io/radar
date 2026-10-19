'use client';
// CONTRACT (owned by the publishing area): Settings → Publishing rows (Connections, Mode). The Schedule row lives in SettingsPage.
// Port of PublishingSettings (radar-publish.jsx).
import React, { useState } from 'react';
import { useApp } from '@/client/app';
import { Btn, Icon, Status } from '@/components/ui';
import { PlatMark } from '@/components/brand';
import { platLabel } from '@/lib/constants';
import type { BlogState, Workspace } from '@/lib/types';
import { PublishIntro } from './PublishIntro';
import { BlogConnect, type BlogConnectProps } from './BlogConnect';

function Row({ t, d, children }: { t: string; d?: string; children?: React.ReactNode }) {
  return <div className="row" style={{ padding: '18px 0', borderTop: '1px solid var(--line2)', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}><span className="col" style={{ width: 220, gap: 3 }}><span className="small" style={{ fontWeight: 500 }}>{t}</span>{d && <span className="xs sub">{d}</span>}</span><div className="grow col" style={{ gap: 10, minWidth: 240 }}>{children}</div></div>;
}

export function PublishingSettings() {
  const app = useApp(); const { toast } = app; const B = app.B!;
  const bl = B.blog; const conns = bl.conns; const def = bl.defaultId || (conns[0] && conns[0].id);
  const [pick, setPick] = useState(false); const [conn, setConn] = useState<BlogConnectProps['type']>(null); const [menu, setMenu] = useState<string | null>(null);
  const opt = (fn: (b: BlogState) => BlogState) => (W: Workspace): Workspace => {
    const nb = fn(W.blog); const d = nb.conns.find(c => c.id === nb.defaultId) ? nb.defaultId : (nb.conns[0] && nb.conns[0].id) || null;
    return { ...W, blog: { ...nb, defaultId: d } };
  };
  return <>
    <Row t="Connections" d="Articles publish to your default. Pick another per article.">
      {conns.length ? <div className="col">{conns.map((c, i) => <div key={c.id} className="row" style={{ gap: 12, padding: '10px 0', borderTop: i ? '1px solid var(--line2)' : 0, flexWrap: 'wrap' }}>
        <PlatMark k={c.type} s={34} /><span className="col grow" style={{ minWidth: 160 }}><span className="small" style={{ fontWeight: 500 }}>{platLabel(c.type)}{c.id === def && <span className="sub" style={{ fontWeight: 400 }}> · Default</span>}</span><span className="xs sub mono trunc">{c.url}{c.target ? ' · ' + c.target : ''}</span></span>
        {c.status === 'error' && !bl.paused ? <Status tone="bad">Needs reconnecting</Status> : <Status tone={bl.paused ? 'warn' : 'ok'}>{bl.paused ? 'Paused' : 'Connected'}</Status>}
        <div style={{ position: 'relative' }}><Btn kind="ghost" size="sm" icon="dots" aria-label="Connection options" onClick={() => setMenu(menu === c.id ? null : c.id)} />
          {menu === c.id && <div className="pop" style={{ right: 0, top: 'calc(100% + 4px)' }} onMouseLeave={() => setMenu(null)}>
            {c.id !== def && <button className="pop-i" onClick={() => { setMenu(null); app.act('blog.setDefault', { id: c.id }, { optimistic: opt(b => ({ ...b, defaultId: c.id })) }).catch(() => {}); toast(platLabel(c.type) + ' is now your default'); }}><Icon n="check" s={16} />Make default</button>}
            <button className="pop-i" onClick={() => { setMenu(null); setConn({ type: c.type, id: c.id }); }}><Icon n="edit" s={16} />Edit connection</button>
            <button className="pop-i" style={{ color: 'var(--bad)' }} onClick={() => { setMenu(null); app.act('blog.disconnect', { id: c.id }, { optimistic: opt(b => ({ ...b, conns: b.conns.filter(x => x.id !== c.id) })) }).catch(() => {}); toast(platLabel(c.type) + ' disconnected. Scheduled articles move to your default.'); }}><Icon n="trash" s={16} />Disconnect</button>
          </div>}
        </div>
      </div>)}</div> : <span className="small sub">No blog connected yet.</span>}
      <div className="row" style={{ flexWrap: 'wrap' }}><Btn size="sm" icon="plus" onClick={() => setPick(true)}>Add connection</Btn>{conns.length > 0 && <Btn size="sm" kind="ghost" icon={bl.paused ? 'play' : 'pause'} onClick={() => { app.act('blog.pause', { paused: !bl.paused }, { optimistic: opt(b => ({ ...b, paused: !b.paused })) }).catch(() => {}); toast(bl.paused ? 'Publishing resumed' : 'Publishing paused. Scheduled articles will wait.'); }}>{bl.paused ? 'Resume all' : 'Pause all'}</Btn>}</div>
    </Row>
    {conns.length > 0 && <Row t="Mode" d="Autopilot must be turned on explicitly."><span className="small">{bl.mode === 'autopilot' ? 'Daily autopilot — articles publish without review' : 'Review-first — each article waits for your approval'}</span><div><Btn size="sm" kind="ghost" onClick={() => { const dc = conns.find(c => c.id === def) || conns[0]; setConn({ type: dc.type, id: dc.id, step: 'mode' }); }}>Change</Btn></div></Row>}
    <PublishIntro open={pick} onClose={() => setPick(false)} title="Add a blog connection" sub="Publish to more than one place. Each article goes to your default unless you choose another." existing={conns.map(c => c.type)} onPick={k => { setPick(false); setConn(k); }} />
    <BlogConnect type={conn} onClose={() => setConn(null)} onSaved={c => { setConn(null); toast(platLabel(c.type) + ' saved', { tone: 'ok' }); }} />
  </>;
}
