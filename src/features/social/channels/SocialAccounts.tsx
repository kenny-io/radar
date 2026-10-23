'use client';
// Settings → Social accounts — port of SocialAccounts (prototype/radar-channels.jsx). One row per channel; channels this
// deployment can't connect yet (no OAuth app configured) show "Not available yet".
import React, { useState } from 'react';
import { useApp } from '@/client/app';
import { PlatLogo } from '@/components/brand';
import { Btn, Status } from '@/components/ui';
import { SOC_CH, accountsOf, acctLabel, chOf } from '@/lib/socialPublish';
import type { SocialAccount, SocialChannel } from '@/lib/types';
import { ConnectSocial } from './ConnectSocial';
import { LogoLabel } from './LogoLabel';

export function SocialAccounts() {
  const app = useApp(); const { toast } = app; const B = app.B!;
  const [ch, setCh] = useState<SocialChannel | null>(null); const [re, setRe] = useState<SocialAccount | null>(null); const [busy, setBusy] = useState<string | null>(null);
  const accts = accountsOf(B); const avail = B.social.channels || SOC_CH.map(c => c.k);
  const disconnect = async (a: SocialAccount) => {
    setBusy(a.id);
    try {
      const r = await app.act<{ ch: SocialChannel; unscheduled: number }>('social.disconnect', { acctId: a.id });
      const n = r.unscheduled || 0;
      toast(`${chOf(a.ch).l} disconnected${n ? `. ${n} scheduled post${n > 1 ? 's were' : ' was'} unscheduled.` : ''}`);
    } catch { /* toasted */ }
    setBusy(null);
  };
  return <>
    {SOC_CH.map(c => {
      const a = accts.find(x => x.ch === c.k);
      return <div key={c.k} className="row" style={{ gap: 14, padding: '16px 0', borderTop: '1px solid var(--line2)', flexWrap: 'wrap' }}>
        <PlatLogo k={c.plat} s={28} />
        <span className="col grow" style={{ minWidth: 180, gap: 2 }}><span className="small" style={{ fontWeight: 500 }}>{c.l}</span><span className="xs sub">{a ? (a.expired ? `${acctLabel(a)} · access expired, scheduled posts are on hold` : acctLabel(a)) : c.d}</span></span>
        {a && a.expired ? <><Status tone="warn">Reconnect needed</Status><Btn size="sm" onClick={() => { setRe(a); setCh(c.k); }}><LogoLabel k={c.plat}>Reconnect</LogoLabel></Btn></>
          : a ? <><Status tone="ok">Connected</Status><button type="button" className="unlink" disabled={busy === a.id} aria-busy={busy === a.id} onClick={() => disconnect(a)}>Disconnect</button></>
            : avail.includes(c.k) ? <Btn size="sm" onClick={() => { setRe(null); setCh(c.k); }}><LogoLabel k={c.plat}>Connect</LogoLabel></Btn>
              : <span className="small sub">Not available yet</span>}
      </div>;
    })}
    <p className="xs sub" style={{ paddingTop: 14, borderTop: '1px solid var(--line2)' }}>Facebook, Reddit and Quora posts are copy-and-paste for now.</p>
    <ConnectSocial ch={ch} reconnect={re} open={!!ch} onClose={() => { setCh(null); setRe(null); }} />
  </>;
}
