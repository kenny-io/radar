'use client';
// Post panel on a social pack — port of PublishBox (prototype/radar-channels.jsx, handoff §3). The state comes from
// `packPanelState`, problems from `preflight`, and every write is a server action (the server re-checks all of it).
import React, { useState } from 'react';
import { useApp } from '@/client/app';
import { Btn, Modal, Status } from '@/components/ui';
import { PLAT_L, SOC_CH, accountsFor, accountsOf, acctLabel, atTz, canPost, chOf, defaultSlot, failedLine, minsUntil, packPanelState, packPreflightInput, packSid, pickAccount, preflight, type Problem } from '@/lib/socialPublish';
import { plat } from '@/lib/constants';
import { fmtDW } from '@/lib/format';
import type { Platform, Pub, SocialAccount, SocialChannel, SocialPack, SocialPost } from '@/lib/types';
import { ConnectSocial } from './ConnectSocial';
import { LogoLabel } from './LogoLabel';
import { ScheduleModal } from './ScheduleModal';
import { compressToast, postedAs, repub, rescheduleAction, withPub } from './logic';
import { useNowMs } from './useSocial';

/** Preflight problems: amber dot + text, with a one-click fix where there is one. */
export function Issues({ list, onFix, busy }: { list: Problem[]; onFix: (p: Problem) => void; busy?: boolean }) {
  if (!list.length) return null;
  return <div className="col" style={{ gap: 8 }}>{list.map((x, i) => <div key={i} className="row" style={{ gap: 10, alignItems: 'flex-start' }}><i className="dot" style={{ background: 'var(--warn)', marginTop: 7, flex: 'none' }} /><span className="small grow">{x.msg}</span>{x.fix && <Btn size="sm" kind="ghost" loading={busy} onClick={() => onFix(x)}>{x.fix.l}</Btn>}</div>)}</div>;
}

/** Toast after a Post now / Try again that came back `failed` (a failed send is not an error). */
export const failToast = (pub: Pub) => (pub.code === 'unknown' ? failedLine(pub) : 'Couldn’t post. Nothing was published.');

export function PublishBox({ pack, k, post, nImg, onCopy, onDownload }: { pack: SocialPack; k: Platform; post: SocialPost; nImg: number; onCopy: () => void; onDownload: () => void }) {
  const app = useApp(); const { toast } = app; const B = app.B!; const tz = B.tz; const now = useNowMs();
  const pl = plat(k).l; const all = accountsOf(B); const accts = accountsFor(all, k);
  const pub = post.pub || null;
  const [chosen, setChosen] = useState<string | null>(null); const [conn, setConn] = useState<SocialChannel | null>(null); const [re, setRe] = useState<SocialAccount | null>(null);
  const [sch, setSch] = useState(false); const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false); const [fixing, setFixing] = useState(false);
  const cur = pickAccount(all, k, { pubAcct: pub?.acct, chosen });
  const state = packPanelState(k, post, all, cur, now);
  const issues = canPost(k) ? preflight(k, packPreflightInput(post)) : [];
  const blocked = issues.length > 0;
  const sid = canPost(k) ? packSid(pack.id, k) : '';
  const label = (acctLabel(cur) || pub?.acctLabel || '');
  const at = (p: Pub) => `${fmtDW(p.date)} at ${atTz(tz, p.date, p.time)}`;

  const doPost = async () => {
    setConfirm(false); setBusy(true);
    try {
      await app.flushLater();
      const r = await app.act<{ pub: Pub }>('social.postNow', { sid, acctId: cur?.id });
      if (r.pub?.status === 'posted') toast(`Posted to ${pl} as ${label}`, { tone: 'ok' });
      else if (r.pub?.status === 'failed') toast(failToast(r.pub), { tone: 'bad' });
    } catch { /* toasted */ }
    setBusy(false);
  };
  const schedule = async ({ date, time }: { date: string; time: string }) => {
    setSch(false);
    const how = rescheduleAction(pub, date, time); if (how === 'none') return;
    await app.flushLater();
    const done = () => toast(`Scheduled for ${fmtDW(date)} at ${atTz(tz, date, time)}`, { tone: 'ok' });
    // Same time, new day: social.move (works while the account is on hold). A new time: social.schedule.
    if (how === 'move' && pub) { app.act('social.move', { sid, date }, { optimistic: b => withPub(b, sid, repub(pub, date, time, tz)) }).then(done).catch(() => {}); return; }
    const base: Pub = pub || { status: 'scheduled', platform: k as 'x' | 'linkedin', date, time, dueAt: '', acct: cur?.id || null, acctLabel: label };
    app.act('social.schedule', { sid, date, time, acctId: cur?.id }, { optimistic: b => withPub(b, sid, { ...repub(base, date, time, tz), status: 'scheduled', acct: cur?.id || null, err: null, code: null }) })
      .then(done).catch(() => {});
  };
  const unschedule = () => {
    app.act('social.unschedule', { sid }, { optimistic: b => withPub(b, sid, null) }).then(() => toast('Unscheduled. The post is still in your library.')).catch(() => {});
  };
  const fix = async () => {
    setFixing(true);
    try { const r = await app.act<{ compressed: number }>('social.compress', { sid }); toast(compressToast(r?.compressed), { tone: r?.compressed ? 'ok' : null }); } catch { /* toasted */ }
    setFixing(false);
  };

  const secondary = <div className="row" style={{ gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}><Btn size="sm" kind="ghost" icon="copy" onClick={onCopy}>Copy text</Btn>{nImg > 0 && <Btn size="sm" kind="ghost" icon="download" onClick={onDownload}>{nImg > 1 ? `${nImg} images` : 'Image'}</Btn>}</div>;
  const modals = canPost(k) && <>
    <ConnectSocial ch={conn} reconnect={re} open={!!conn} onClose={() => { setConn(null); setRe(null); }} onConnected={a => setChosen(a.id)} />
    <ScheduleModal open={sch} onClose={() => setSch(false)} title={`Schedule ${pl} post`} sub="You can drag it to another day on the calendar later." acct={cur} lockTime={!!cur?.expired && pub?.status === 'scheduled'}
      initial={pub && pub.status === 'scheduled' ? { date: pub.date, time: pub.time } : defaultSlot('pack', k, B.today)} onSave={schedule} />
    <Modal open={confirm} onClose={() => setConfirm(false)} width={440} label="Post now"><div className="col" style={{ padding: 30, gap: 16 }}>
      <h2 className="h2">{`Post to ${pl} now?`}</h2>
      <p className="sub">It goes live as <span style={{ color: 'var(--ink)' }}>{label}</span>{nImg > 0 ? ` with ${nImg} image${nImg > 1 ? 's' : ''}` : ''}. You can delete it on {pl} afterwards.</p>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}><Btn kind="ghost" onClick={() => setConfirm(false)}>Cancel</Btn><Btn kind="primary" onClick={doPost}><LogoLabel k={k}>Post now</LogoLabel></Btn></div>
    </div></Modal>
  </>;

  const avail = B.social.channels || SOC_CH.map(c => c.k);
  const connectable = SOC_CH.filter(c => c.plat === k && avail.includes(c.k));
  if (state === 'copy_only' || (state === 'not_connected' && !connectable.length)) return <div className="col" style={{ gap: 10 }}>
    <Btn kind="primary" className="btn-block" icon="copy" onClick={onCopy}>Copy text</Btn>
    {nImg > 0 && <Btn className="btn-block" icon="download" onClick={onDownload}>{nImg > 1 ? `Download ${nImg} images` : 'Download image'}</Btn>}
    <span className="xs sub" style={{ textAlign: 'center' }}>{canPost(k) ? 'Copying or downloading doesn’t publish anything.' : `Radar can’t post to ${pl}. Copy it and post it yourself.`}</span>
  </div>;
  if (state === 'not_connected') return <div className="col" style={{ gap: 10 }}>
    {connectable.map(c => <Btn key={c.k} className="btn-block" onClick={() => { setRe(null); setConn(c.k); }}><LogoLabel k={c.plat}>{`Connect ${c.l}`}</LogoLabel></Btn>)}
    <span className="xs sub" style={{ textAlign: 'center' }}>Connect once to post or schedule from Radar.</span>
    {secondary}{modals}
  </div>;
  const as = pub ? postedAs(pub, all) : '';
  if (state === 'posted' && pub) return <div className="col" style={{ gap: 12 }}>
    <Status tone="ok">{`Posted ${at(pub)}`}</Status>
    {as && <span className="small sub" style={{ marginTop: -6 }}>{`As ${as}`}</span>}
    <Btn className="btn-block" disabled={!pub.url} onClick={() => pub.url && window.open(pub.url, '_blank', 'noopener')}><LogoLabel k={k}>{`View on ${pl}`}</LogoLabel></Btn>
    {secondary}
  </div>;
  if (state === 'sending' && pub) return <div className="col" style={{ gap: 12 }}>
    <Status tone="signal" pulse>{pub.status === 'sending' || minsUntil(pub, now) < 0 ? `Sending to ${pl}…` : `Sending at ${atTz(tz, pub.date, pub.time)}`}</Status>
    <span className="small sub" style={{ marginTop: -6 }}>{`As ${label} · it’s too close to send time to change now`}</span>
    {secondary}
  </div>;
  const expired = state === 'expired'; const scheduled = pub?.status === 'scheduled';
  return <div className="col" style={{ gap: 12 }}>
    {expired && cur ? <div className="col" style={{ gap: 2 }}><Status tone="warn">{`${chOf(cur.ch).l} needs reconnecting`}</Status><span className="small sub">{scheduled ? `Scheduled for ${at(pub!)}, on hold until you reconnect.` : `${pl} access for ${acctLabel(cur)} expired.`}</span></div>
      : state === 'scheduled' && pub ? <div className="col" style={{ gap: 2 }}><Status tone="ok">{`Scheduled · ${at(pub)}`}</Status><span className="small sub">{`As ${label} · edits are included until it posts`}</span></div>
        : state === 'failed' && pub ? <div className="col" style={{ gap: 2 }}><Status tone="bad">{`Didn’t post ${at(pub)}`}</Status><span className="small sub">{failedLine(pub)}</span></div>
          : <div className="row" style={{ gap: 12 }}><span className="small grow">Post as</span>{accts.length > 1 ? <select className="input" style={{ width: 200, height: 34, fontSize: 13 }} value={cur?.id} onChange={e => setChosen(e.target.value)} aria-label="Post as">{accts.map(a => <option key={a.id} value={a.id}>{acctLabel(a) + (a.expired ? ' (reconnect)' : '')}</option>)}</select> : <span className="small sub">{label}</span>}</div>}
    <Issues list={issues} onFix={fix} busy={fixing} />
    {expired && cur ? <Btn kind="primary" className="btn-block" onClick={() => { setRe(cur); setConn(cur.ch); }}><LogoLabel k={k}>{`Reconnect ${chOf(cur.ch).l}`}</LogoLabel></Btn>
      : <Btn kind="primary" className="btn-block" loading={busy} disabled={blocked} onClick={() => setConfirm(true)}><LogoLabel k={k}>{state === 'failed' ? 'Try again' : 'Post now'}</LogoLabel></Btn>}
    {scheduled ? <div className="row" style={{ gap: 8 }}><Btn className="grow" icon="calendar" disabled={busy || blocked} onClick={() => setSch(true)}>Reschedule</Btn><Btn kind="ghost" disabled={busy} onClick={unschedule}>Unschedule</Btn></div>
      : !expired && <Btn className="btn-block" icon="calendar" disabled={blocked || busy} onClick={() => setSch(true)}>Schedule</Btn>}
    {secondary}{modals}
  </div>;
}
