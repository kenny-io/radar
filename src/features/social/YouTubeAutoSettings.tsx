'use client';
import React, { useEffect, useState } from 'react';
import { useApp } from '@/client/app';
import { ApiError } from '@/client/api';
import { Btn, Field } from '@/components/ui';
import { accountsOf } from '@/lib/socialPublish';
import { eligibleYouTubeDefaults } from '@/lib/youtubeAutomation';
import type { YouTubeAutoDefaults } from '@/lib/types';
export function YouTubeAutoSettings() {
  const app = useApp(); const B = app.B!;
  const account = accountsOf(B).find(a => a.ch === 'youtube');
  const owner = B.role === 'Owner'; const live = !!account && !account.expired && !account.verificationHold;
  const saved = eligibleYouTubeDefaults(B.social.auto, account);
  const [privacy, setPrivacy] = useState<YouTubeAutoDefaults['privacy'] | ''>(saved?.privacy || '');
  const [audience, setAudience] = useState(saved ? String(saved.madeForKids) : '');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { setPrivacy(saved?.privacy || ''); setAudience(saved ? String(saved.madeForKids) : ''); }, [B.social.auto.youtubeDefaultsVersion, account?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save(clear = false) {
    if (!owner || busy || (!clear && (!live || !privacy || !audience))) return;
    setBusy(true); setError('');
    try {
      await app.act('social.youtubeDefaults', { expectedVersion: B.social.auto.youtubeDefaultsVersion || null, defaults: clear ? null : { acctId: account!.id, privacy, madeForKids: audience === 'true' } }, { silent: true });
      app.toast(clear ? 'YouTube automatic publishing choices cleared. Existing uploads may still finish.' : `Future automatic YouTube videos: ${privacy}, ${audience === 'true' ? 'made for kids' : 'not made for kids'}.`);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Radar couldn’t save your YouTube choices. Try again.'); }
    finally { setBusy(false); }
  }
  return <section className="col" aria-label="YouTube automatic publishing" aria-busy={busy} style={{ gap: 12, borderTop: '1px solid var(--line2)', paddingTop: 18 }}>
    <h3 className="small" style={{ fontWeight: 600 }}>YouTube automatic publishing</h3>
    <p className="xs sub">These choices apply to future automatically generated YouTube videos. Radar generates an editable title from the explanation. Videos publish automatically only while Marketing Autopilot or your separate Schedule posts automation authorizes it.</p>
    {account && <p className="small" style={{ overflowWrap: 'anywhere' }}>{account.name}{!live ? ' · Reconnect required' : ''}</p>}
    {!live && <div><Btn size="sm" kind="ghost" onClick={() => app.go('settings', { social: true })}>{account ? 'Reconnect YouTube' : 'Connect YouTube'}</Btn></div>}
    <fieldset disabled={!owner || !live || busy} className="grid-2" style={{ border: 0, padding: 0, margin: 0, minWidth: 0, gap: 12 }}>
      <Field label="Visibility"><select aria-label="YouTube automatic visibility" className="input" value={privacy} onChange={e => setPrivacy(e.target.value as typeof privacy)}><option value="">Choose visibility</option><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></Field>
      <Field label="Audience"><select aria-label="YouTube automatic audience" className="input" value={audience} onChange={e => setAudience(e.target.value)}><option value="">Choose audience</option><option value="true">Made for kids</option><option value="false">Not made for kids</option></select></Field>
    </fieldset>
    {!saved && <p role="status" className="xs sub">YouTube will remain a draft until the owner chooses visibility and audience.</p>}
    {!owner && <p className="xs sub">Ask the owner to configure YouTube automatic publishing.</p>}
    {owner && <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}><Btn size="sm" loading={busy} disabled={!live || !privacy || !audience} onClick={() => save()}>Save choices</Btn><Btn size="sm" kind="ghost" disabled={busy || !B.social.auto.youtubeDefaults} onClick={() => save(true)}>Clear choices</Btn>{privacy === 'public' && <span className="xs sub">Future automatic videos will be Public.</span>}</div>}
    {error && <p role="alert" className="xs" style={{ color: 'var(--bad)' }}>{error} <button type="button" className="unlink" onClick={() => app.refresh()}>Reload settings</button></p>}
    <p className="xs sub">Saving choices does not enable automation or change existing posts. Clearing stops future unstarted automatic uploads; an upload already accepted may still finish.</p>
  </section>;
}
