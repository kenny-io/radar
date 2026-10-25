'use client';
// Backlinks network — port of prototype/radar-backlinks.jsx. Real proposals, decisions, live links and preferences.
import React, { useState } from 'react';
import { useApp } from '@/client/app';
import { Btn, Empty, Field, Modal, PageHead, Seg, Status, Tabs, Toggle } from '@/components/ui';
import { fmtD } from '@/lib/format';
import type { BacklinkPrefs, LiveLink, Proposal, Workspace } from '@/lib/types';

const PRINCIPLES: [string, string][] = [['You approve every link', 'Nothing is placed on your site, or pointing to it, without your explicit approval.'], ['Editors decide placement', 'Partners only propose links where they help readers. Either side can edit the sentence or say no.'], ['Always disclosed', 'Every participating site notes its membership. Radar never hides how a link came about.'], ['Qualified links', 'Network links carry rel="sponsored" unless a partner’s editor places it independently. No exact-match anchor schemes.']];

/** Placements that went live move to Live links. */
const visible = (list: Proposal[]) => list.filter(m => !(m as any).placedAt);

export function Backlinks() {
  const app = useApp(); const { B, act, toast } = app;
  const [join, setJoin] = useState(false); const [tab, setTab] = useState<'matches' | 'requests' | 'live' | 'prefs'>('matches');
  if (!B) return null;
  const bl = B.backlinks;
  if (!bl.joined) return <div className="page">
    <PageHead title="Backlinks" sub="An optional network of businesses that link to each other only where it genuinely helps readers." />
    <div style={{ maxWidth: 720 }}>
      <div className="col">{PRINCIPLES.map(([h, d], i) => <div key={h} className="row" style={{ padding: '20px 0', borderTop: '1px solid var(--line' + (i ? '2' : '') + ')', alignItems: 'flex-start', gap: 20 }}><span className="mono sub" style={{ width: 24, flex: 'none', paddingTop: 3 }}>0{i + 1}</span><span className="col" style={{ gap: 4 }}><span className="h3">{h}</span><span className="sub small">{d}</span></span></div>)}</div>
      <div className="row" style={{ marginTop: 30, gap: 16, flexWrap: 'wrap' }}><Btn kind="primary" size="lg" onClick={() => setJoin(true)}>Join the network</Btn><span className="small sub">Free. Leave anytime and request removal of any link.</span></div>
    </div>
    <JoinModal open={join} onClose={() => setJoin(false)} />
  </div>;
  const inbound = visible(bl.inbound), outbound = visible(bl.outbound);
  const pend = inbound.filter(m => !m.decision).length; const pendO = outbound.filter(m => !m.decision).length;
  return <div className="page">
    <PageHead title="Backlinks" sub="Review proposed placements, track live links, and manage how you take part." />
    <Tabs value={tab} onChange={setTab} items={[{ v: 'matches', l: 'Links to you', ct: pend || null }, { v: 'requests', l: 'Links from you', ct: pendO || null }, { v: 'live', l: 'Live links' }, { v: 'prefs', l: 'Preferences' }]} style={{ marginBottom: 28, marginTop: -12 }} />
    <div key={tab} className="enter">
      {tab === 'matches' && <Matches list={inbound} kind="in" />}
      {tab === 'requests' && <Matches list={outbound} kind="out" />}
      {tab === 'live' && <LiveLinks />}
      {tab === 'prefs' && <div style={{ maxWidth: 620 }}><PrefsForm prefs={bl.prefs} onSave={async p => { await act('backlinks.prefs', { prefs: p }, { optimistic: b => ({ ...b, backlinks: { ...b.backlinks, prefs: p } }) }); toast('Preferences saved'); }} cta="Save preferences" />
        <div className="row" style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid var(--line)', gap: 14, flexWrap: 'wrap' }}><span className="grow small sub">Leaving stops new proposals. Existing links stay until you request removal.</span><Btn kind="danger" onClick={() => act('backlinks.leave', {}, { optimistic: b => ({ ...b, backlinks: { ...b.backlinks, joined: false }, counts: { ...b.counts, backlinksPending: 0 } }) }).then(() => toast('You’ve left the network')).catch(() => {})}>Leave network</Btn></div></div>}
    </div>
  </div>;
}

function Matches({ list, kind }: { list: Proposal[]; kind: 'in' | 'out' }) {
  const { B, act, toast } = useApp(); const [rej, setRej] = useState<string | null>(null); const [note, setNote] = useState('');
  const setDecision = (id: string, d: Proposal['decision']) => (b: Workspace): Workspace => {
    const upd = (l: Proposal[]) => l.map(x => (x.id === id ? { ...x, decision: d } : x));
    const inbound = upd(b.backlinks.inbound);
    return { ...b, backlinks: { ...b.backlinks, inbound, outbound: upd(b.backlinks.outbound) }, counts: { ...b.counts, backlinksPending: inbound.filter(x => !x.decision).length } };
  };
  const decide = (m: Proposal, v: 'approved' | 'rejected', n?: string) => {
    const prev = m.decision;
    act('backlinks.decide', { id: m.id, decision: v, note: n || undefined }, { optimistic: setDecision(m.id, v) }).then(() => {
      toast(v === 'approved' ? (kind === 'in' ? 'Approved. The partner’s editor will place it.' : 'Approved. Added when the article next publishes.') : 'Declined. The partner won’t be told why unless you add a note.', { action: { label: 'Undo', fn: () => { act('backlinks.undo', { id: m.id }, { optimistic: setDecision(m.id, prev) }).catch(() => {}); } } });
    }).catch(() => {});
  };
  if (!list.length) return <Empty title="No proposals right now" body="Radar checks for relevant partners weekly." />;
  return <div className="col" style={{ gap: 16 }}>
    <p className="small sub" style={{ marginBottom: 6 }}>{kind === 'in' ? 'Partners propose linking to you from these exact sentences. Approve only the ones that read naturally.' : 'Partners would like a link from your content. You see exactly what would change.'}</p>
    {list.map(m => {
      const d = m.decision;
      return <div key={m.id} className="card" style={{ padding: '22px 24px', opacity: d === 'rejected' ? .55 : 1, transition: 'opacity .3s' }}>
        <div className="row" style={{ alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <span className="col grow" style={{ gap: 3, minWidth: 220 }}><span className="h3">{m.partner} <span className="sub mono" style={{ fontWeight: 400, marginLeft: 6 }}>{m.domain}</span></span><span className="small sub">{m.about || 'Network partner'}</span></span>
          {d === 'auto' ? <div className="row" style={{ gap: 10 }}><Status tone="ok">Auto-approved by your rules</Status><Btn size="sm" kind="ghost" onClick={() => decide(m, 'rejected')}>Decline</Btn></div> : d ? <Status tone={d === 'approved' ? 'ok' : 'mute'}>{d === 'approved' ? (kind === 'in' ? 'Approved · awaiting placement' : 'Approved') : 'Declined'}</Status> : <div className="row" style={{ gap: 8 }}><Btn size="sm" kind="ghost" onClick={() => { setRej(m.id); setNote(''); }}>Decline</Btn><Btn size="sm" kind="primary" icon="check" onClick={() => decide(m, 'approved')}>Approve</Btn></div>}
        </div>
        <div style={{ margin: '18px 0 14px', padding: '16px 18px', borderRadius: 12, background: 'var(--paper)', boxShadow: 'inset 0 0 0 1px var(--line2)' }}>
          <span className="xs sub mono" style={{ display: 'block', marginBottom: 8 }}>{kind === 'in' ? m.page : B!.profile.domain + (m.yourPage || '')}</span>
          <p style={{ fontSize: 16, lineHeight: 1.6 }}>{m.before || m.sentence}<span style={{ textDecoration: 'underline', textDecorationColor: 'var(--signal)', textDecorationThickness: 2, textUnderlineOffset: 4, fontWeight: 500 }}>{m.anchor}</span>{m.after}</p>
        </div>
        <div className="row xs sub" style={{ gap: '6px 22px', flexWrap: 'wrap' }}><span>Links to <span className="mono" style={{ color: 'var(--ink2)' }}>{m.target}</span></span>{m.auth ? <span style={{ whiteSpace: 'nowrap' }}>Authority {m.auth}</span> : null}{m.rel && <span style={{ whiteSpace: 'nowrap' }}>{m.rel}</span>}{m.disclosure && <span>{m.disclosure}</span>}{m.fit && <span style={{ color: 'var(--ink2)' }}>Why it fits: {m.fit}</span>}</div>
        {rej === m.id && <form className="row enter" style={{ marginTop: 14, gap: 8 }} onSubmit={e => { e.preventDefault(); decide(m, 'rejected', note.trim()); setRej(null); }}><input autoFocus className="input" style={{ height: 36, fontSize: 14 }} placeholder="Optional note to the partner" value={note} onChange={e => setNote(e.target.value)} /><Btn size="sm" type="button" kind="ghost" onClick={() => setRej(null)}>Cancel</Btn><Btn size="sm" type="submit">Decline</Btn></form>}
      </div>;
    })}
  </div>;
}

function LiveLinks() {
  const { B, act, toast } = useApp(); const live = B!.backlinks.live || []; const [confirm, setConfirm] = useState<LiveLink | null>(null); const [busy, setBusy] = useState<string | null>(null);
  const tone: Record<LiveLink['status'], [string, string]> = { live: ['ok', 'Live'], lost: ['bad', 'Link not found'], removal: ['warn', 'Removal requested'], removed: ['mute', 'Removed'] };
  if (!live.length) return <Empty title="No live links yet" body="Approved placements appear here once they’re live and verified." />;
  const recheck = async (l: LiveLink) => {
    setBusy(l.id);
    try { const r = await act<{ status: LiveLink['status'] }>('backlinks.recheck', { id: l.id }); toast(r?.status === 'live' ? 'Re-checked. The link is live again.' : 'Re-checked. Still missing — the partner has been notified.'); }
    catch { /* toasted */ } finally { setBusy(null); }
  };
  const remove = async (l: LiveLink) => {
    setConfirm(null);
    try { await act('backlinks.removal', { id: l.id }, { optimistic: b => ({ ...b, backlinks: { ...b.backlinks, live: b.backlinks.live.map(x => (x.id === l.id ? { ...x, status: 'removal' } : x)) } }) }); toast('Removal requested'); } catch { /* toasted */ }
  };
  return <div>
    <div style={{ borderTop: '1px solid var(--line)' }}>{live.map(l => <div key={l.id} className="row" style={{ padding: '16px 4px', borderBottom: '1px solid var(--line2)', gap: 16, flexWrap: 'wrap' }}>
      <span className="col grow" style={{ minWidth: 260, gap: 2 }}><span className="small"><span className="mono">{l.from}</span> <span className="sub">→</span> <span className="mono">{l.to}</span></span><span className="xs sub">“{l.anchor}” · {l.rel} · since {fmtD(l.since)}</span></span>
      <span style={{ width: 170 }}><Status tone={tone[l.status][0]}>{tone[l.status][1]}</Status></span>
      {l.status === 'live' ? <Btn size="sm" kind="ghost" onClick={() => setConfirm(l)}>Request removal</Btn> : l.status === 'lost' ? <Btn size="sm" kind="ghost" icon="refresh" loading={busy === l.id} onClick={() => recheck(l)}>Re-check</Btn> : <span style={{ width: 132 }} />}
    </div>)}</div>
    <p className="xs sub" style={{ marginTop: 12 }}>Radar re-checks every link weekly. Lost links are reported to both sides.</p>
    <Modal open={!!confirm} onClose={() => setConfirm(null)} width={460}>{confirm && <div className="col" style={{ padding: 30, gap: 16 }}><h2 className="h2">Request removal?</h2><p className="sub small">Radar will ask the owner of <span className="mono">{confirm.from.split('/')[0]}</span> to remove the link within 7 days. You’ll see it here once it’s gone.</p><div className="row" style={{ justifyContent: 'flex-end' }}><Btn kind="ghost" onClick={() => setConfirm(null)}>Cancel</Btn><Btn kind="primary" onClick={() => remove(confirm)}>Request removal</Btn></div></div>}</Modal>
  </div>;
}

function PrefsForm({ prefs, onSave, cta, consent }: { prefs: Partial<BacklinkPrefs>; onSave: (p: BacklinkPrefs) => Promise<void> | void; cta: string; consent?: boolean }) {
  const { B } = useApp();
  const [p, setP] = useState<BacklinkPrefs>({ topics: prefs.topics && prefs.topics.length ? prefs.topics : B!.profile.business.offerings.slice(0, 3), max: prefs.max || 4, excludeCompetitors: prefs.excludeCompetitors !== false, outbound: prefs.outbound !== false, qualify: prefs.qualify !== false, autoApprove: !!prefs.autoApprove, minAuth: prefs.minAuth || 50 });
  const [ok, setOk] = useState(!consent); const [busy, setBusy] = useState(false);
  const all = [...new Set([...B!.profile.business.offerings, ...B!.profile.audience.needs.slice(0, 2), ...p.topics])];
  const save = async () => { setBusy(true); try { await onSave(p); } catch { /* toasted */ } finally { setBusy(false); } };
  return <div className="col" style={{ gap: 24 }}>
    <Field label="Relevant topics" hint="Partners are matched on these, from your Business Profile."><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{all.map(t => { const on = p.topics.includes(t); return <button type="button" key={t} onClick={() => setP({ ...p, topics: on ? p.topics.filter(x => x !== t) : [...p.topics, t] })} style={{ height: 34, padding: '0 13px', borderRadius: 99, border: '1px solid ' + (on ? 'var(--ink)' : 'var(--line)'), background: on ? 'var(--ink)' : 'var(--surface)', color: on ? 'var(--on-ink)' : 'var(--ink)', cursor: 'pointer', fontSize: 13 }}>{t}</button>; })}</div></Field>
    <Field label="New proposals per month"><Seg value={p.max} onChange={v => setP({ ...p, max: v })} options={[{ v: 2 as const, l: 'Up to 2' }, { v: 4 as const, l: 'Up to 4' }, { v: 8 as const, l: 'Up to 8' }]} /></Field>
    <div className="col" style={{ borderTop: '1px solid var(--line2)' }}>
      {([['excludeCompetitors', 'Exclude competitors', B!.profile.audience.competitors.join(', ') || 'None listed'], ['outbound', 'Accept requests to link from my articles', 'You review each one before anything changes.'], ['qualify', 'Qualify all network links', 'Adds rel="sponsored". Recommended.']] as [keyof BacklinkPrefs, string, string][]).map(([k, l, d]) => <div key={k} className="row" style={{ padding: '14px 0', borderBottom: '1px solid var(--line2)', gap: 16 }}><span className="col grow"><span className="small" style={{ fontWeight: 500 }}>{l}</span><span className="xs sub">{d}</span></span><Toggle on={!!p[k]} onChange={v => setP({ ...p, [k]: v })} label={l} /></div>)}
    </div>
    <div className="col" style={{ gap: 12 }}><div className="row" style={{ gap: 16 }}><span className="col grow"><span className="small" style={{ fontWeight: 500 }}>Auto-approve matches that meet my rules</span><span className="xs sub">Relevant topic, no competitors, authority at or above your minimum. You can still decline any of them.</span></span><Toggle on={p.autoApprove} onChange={v => setP({ ...p, autoApprove: v })} label="Auto-approve" /></div>
      {p.autoApprove && <div className="row enter" style={{ gap: 12 }}><span className="small sub">Minimum authority</span><Seg value={p.minAuth} onChange={v => setP({ ...p, minAuth: v })} options={[{ v: 30 as const, l: '30+' }, { v: 50 as const, l: '50+' }, { v: 70 as const, l: '70+' }]} /></div>}</div>
    {consent && <label className="row small" style={{ gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} style={{ accentColor: 'var(--ink)', width: 16, height: 16, marginTop: 2 }} /><span>I’ll review each placement on its merits and disclose my participation on {B!.profile.domain}.</span></label>}
    <div className="row"><Btn kind="primary" disabled={!ok || !p.topics.length} loading={busy} onClick={save}>{cta}</Btn></div>
  </div>;
}

/** Join: saves preferences, runs matching right away and reports the real number of matches it found. */
function JoinModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { act, toast, refresh } = useApp();
  const join = async (p: BacklinkPrefs) => {
    const r = await act<{ jobId: string }>('backlinks.join', { prefs: p, consent: true }, { keepLocal: true }); // stay on this modal until matching reports
    let n: number | null = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000) {
      await new Promise(res => setTimeout(res, 900));
      const j = await act<any>('job.get', { id: r.jobId }, { silent: true }).catch(() => null);
      if (j?.status === 'done') { n = j.result?.created ?? 0; break; }
      if (j?.status === 'failed') break;
    }
    await refresh();
    onClose();
    toast(n == null ? 'Welcome to the network. Radar is looking for relevant matches.' : `Welcome to the network. Radar found ${n} relevant match${n === 1 ? '' : 'es'}.`, { tone: 'ok' });
  };
  return <Modal open={open} onClose={onClose} width={600}><div className="col" style={{ padding: 32, gap: 22 }}>
    <div className="col" style={{ gap: 6 }}><h2 className="h1" style={{ fontSize: 24 }}>Set your preferences</h2><p className="sub">You can change these anytime.</p></div>
    <PrefsForm prefs={{}} consent cta="Join network" onSave={join} />
  </div></Modal>;
}
