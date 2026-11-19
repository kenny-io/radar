'use client';
// Connect window — port of ConnectSocial (prototype/radar-channels.jsx) on real OAuth: the platform's own sign-in opens in a
// popup (`openOAuth(chOf(ch).provider)`), then `social.connect` (a first LinkedIn page picks from `social.pages`).
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '@/client/app';
import { openOAuth } from '@/client/api';
import { oauthErrorCopy } from '@/lib/oauthReturn';
import { PlatLogo } from '@/components/brand';
import { Btn, Icon, Modal, Status } from '@/components/ui';
import { PLAT_L, acctLabel, chOf } from '@/lib/socialPublish';
import type { SocialAccount, SocialChannel, SocialPage } from '@/lib/types';
import { LogoLabel } from './LogoLabel';

type St = 'intro' | 'auth' | 'page' | 'saving';

export function ConnectSocial({ ch, open, onClose, onConnected, reconnect }: { ch: SocialChannel | null; open: boolean; onClose: () => void; onConnected?: (a: SocialAccount) => void; reconnect?: SocialAccount | null }) {
  const app = useApp(); const { toast } = app;
  const c = ch ? chOf(ch) : null;
  const [st, setSt] = useState<St>('intro'); const [err, setErr] = useState(''); const [pages, setPages] = useState<SocialPage[]>([]); const [page, setPage] = useState<string | null>(null);
  const ref = useRef<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => { pending.current?.abort(); pending.current = null; if (open) { setSt('intro'); setErr(''); setPage(null); setPages([]); ref.current = null; } return () => { pending.current?.abort(); pending.current = null; }; }, [open, ch]);
  if (!c) return null;
  const pl = PLAT_L[c.plat]; const busy = st === 'auth' || st === 'saving';
  const close = () => { const request = pending.current; pending.current = null; request?.abort(); onClose(); };
  const finish = async (pageId?: string) => {
    setSt('saving'); setErr('');
    try {
      const r = await app.act<{ account: SocialAccount; reconnected: boolean; released: number }>('social.connect', { ch: c.k, oauthRef: ref.current, ...(pageId ? (c.k === 'instagram' ? { accountId: pageId } : { pageId }) : {}) }, { silent: true });
      const n = r.released || 0;
      toast(reconnect ? `${c.l} reconnected${n ? `. ${n} held post${n > 1 ? 's' : ''} will go out as scheduled.` : '.'}` : `${c.l} connected`, { tone: 'ok' });
      onConnected && onConnected(r.account); close();
    } catch (e: any) { setSt(pageId ? 'page' : 'intro'); setErr(e?.message || `${pl} didn’t respond. Nothing changed — try again.`); }
  };
  // The popup must open straight from the click (popup blockers), so nothing is awaited before openOAuth.
  const auth = async () => {
    setErr(''); setSt('auth');
    const request = new AbortController(); pending.current = request;
    const r = await openOAuth(c.provider, app.bid!, reconnect ? { reconnect: '1' } : {}, { signal: request.signal });
    if (pending.current !== request || request.signal.aborted) return;
    pending.current = null;
    if (!r.ok || !r.result?.oauthRef) { setSt('intro'); setErr(oauthErrorCopy(pl, r.error)); return; }
    ref.current = r.result.oauthRef;
    if ((c.k === 'li_page' || (c.k === 'instagram' && r.result?.pickAccount)) && !reconnect) {
      try {
        const p = await app.act<{ pages?: SocialPage[]; accounts?: SocialPage[]; error?: string }>(c.k === 'instagram' ? 'social.instagramAccounts' : 'social.pages', { oauthRef: ref.current }, { silent: true });
        if (p.error) { setSt('intro'); setErr(p.error); return; }
        setPages(p.accounts || p.pages || []); setSt('page');
      } catch (e: any) { setSt('intro'); setErr(e?.message || `${pl} didn’t respond. Nothing changed — try again.`); }
      return;
    }
    finish();
  };
  return <Modal open={open} onClose={st === 'saving' ? null : close} dismissable={st !== 'saving'} width={460} label={(reconnect ? 'Reconnect ' : 'Connect ') + c.l}><div className="col" style={{ padding: 30, gap: 20 }}>
    <div className="row" style={{ gap: 12 }}><PlatLogo k={c.plat} s={32} /><h2 className="h2 grow">{reconnect ? `Reconnect ${c.l}` : `Connect ${c.l}`}</h2><Btn kind="ghost" icon="x" aria-label="Close" onClick={close} disabled={st === 'saving'} /></div>
    {st === 'page' || (st === 'saving' && pages.length > 0) ? <>
      {pages.length ? <>
        <p className="sub">Choose the {c.k === 'instagram' ? 'Instagram account' : 'page'} Radar should post to. You can change it later.</p>
        <div className="col" role="radiogroup" aria-label={c.k === 'instagram' ? 'Instagram account' : 'LinkedIn page'}>{pages.map((p, i) => <button key={p.id} type="button" role="radio" aria-checked={page === p.id} onClick={() => setPage(p.id)} className="row tap" style={{ gap: 12, padding: '12px 10px', margin: '0 -10px', border: 0, borderTop: i ? '1px solid var(--line2)' : 0, background: 'none', borderRadius: 10, cursor: 'pointer', textAlign: 'left' }}>
          <span className="col grow"><span className="small" style={{ fontWeight: 500 }}>{p.name}</span>{p.followers != null && <span className="xs sub">{`${p.followers.toLocaleString('en-US')} followers`}</span>}</span>
          <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 99, flex: 'none', boxShadow: page === p.id ? 'inset 0 0 0 5px var(--ink)' : 'inset 0 0 0 1.5px var(--line)', transition: 'box-shadow .2s' }} /></button>)}</div>
      </> : <p className="sub">{c.k === 'instagram' ? 'No Instagram accounts were shared with Radar. Connect again and share the professional account you want to use.' : 'You don’t manage any LinkedIn pages. Ask a page admin to add you, then try again.'}</p>}
      {err && <div role="alert"><Status tone="bad" style={{ whiteSpace: 'normal' }}>{err}</Status></div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><Btn kind="ghost" onClick={close} disabled={st === 'saving'}>Cancel</Btn>{pages.length > 0 && <Btn kind="primary" disabled={!page} loading={st === 'saving'} onClick={() => finish(page!)}>{c.k === 'instagram' ? 'Connect account' : 'Connect page'}</Btn>}</div>
    </> : <>
      {reconnect && <p className="sub" style={{ marginBottom: -8 }}>{`${pl} access for ${acctLabel(reconnect)} expired. Sign in again to resume posting.`}</p>}
      <p className="sub">Radar can publish posts you approve, immediately or on your schedule.{c.k === 'instagram' ? ' Connect an Instagram Business or Creator account.' : c.k === 'youtube' ? ' Choose the YouTube channel Radar should publish to.' : ''}</p>
      <div className="col small" style={{ borderTop: '1px solid var(--line2)' }}>{[(c.k === 'youtube' ? 'Publish generated videos with your chosen visibility' : c.k === 'instagram' || c.k === 'tiktok' ? 'Publish photos and videos' : 'Publish posts and images') + (c.k === 'li_page' ? ' to a page you manage' : ''), 'Read your account name and profile'].map(t => <span key={t} className="row" style={{ gap: 10, padding: '11px 0', borderBottom: '1px solid var(--line2)' }}><Icon n="check" s={14} style={{ color: 'var(--mute)' }} />{t}</span>)}</div>
      {err && <div role="alert"><Status tone="bad" style={{ whiteSpace: 'normal' }}>{err}</Status></div>}
      {st === 'auth' && <p className="xs sub" role="status">Finish sign-in in the other window. If it closed or stopped responding, cancel and try again.</p>}
      {c.k === 'youtube' && <p className="xs sub">Radar uses YouTube API Services to identify your channel, upload videos you approve and check their processing status. Read our <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a> and the <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener">YouTube Terms of Service</a>.</p>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><Btn kind="ghost" onClick={close} disabled={st === 'saving'}>Cancel</Btn><Btn kind="primary" loading={busy} disabled={busy} onClick={auth}><LogoLabel k={c.plat}>{`Continue with ${pl}`}</LogoLabel></Btn></div>
    </>}
  </div></Modal>;
}
