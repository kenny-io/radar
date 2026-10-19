'use client';
// Port of KeywordList (prototype/radar-keywords.jsx). Volume/difficulty come from the keyword provider (job keywords.estimate);
// "Your position" from Search Console (B.measured); suggestions from job keywords.suggest (B.kwSuggestions).
import React, { useState } from 'react';
import { Btn, Inferred } from '@/components/ui';
import { KW_SRC_L, kwIntentHeuristic } from '@/lib/constants';
import { fmtN } from '@/lib/format';
import type { Edited, GscStatus, Keyword, KeywordSuggestion, Profile, Workspace } from '@/lib/types';

export const kwList = (p: Profile | null | undefined): Keyword[] => (p && p.keywords && p.keywords.list) || [];

export interface KeywordListProps {
  profile: Profile; edited: Edited; onChange: (p: Profile, key: string) => void;
  gsc?: GscStatus; measured?: Workspace['measured']; suggestions?: KeywordSuggestion[]; compact?: boolean;
}
export function KeywordList({ profile, edited, onChange, gsc, measured = {}, suggestions = [], compact }: KeywordListProps) {
  const list = kwList(profile); const [draft, setDraft] = useState(''); const [sug, setSug] = useState(false);
  const save = (l: Keyword[]) => { const p: Profile = JSON.parse(JSON.stringify(profile)); p.keywords = { list: l }; onChange(p, 'keywords.list'); };
  const add = (k: string | KeywordSuggestion) => {
    const kw = (typeof k === 'string' ? k : k.kw).trim().toLowerCase(); if (!kw || list.find(x => x.kw === kw)) return;
    save([...list, typeof k === 'string' ? { kw, intent: kwIntentHeuristic(kw), vol: null, kd: null, src: 'user', priority: false } : { kw, intent: k.intent, vol: k.vol, kd: k.kd, src: k.src, priority: false }]);
  };
  const sorted = [...list].sort((a, b) => (Number(b.priority) - Number(a.priority)) || ((b.vol || 0) - (a.vol || 0)));
  const pri = list.filter(k => k.priority).length; const sugs = suggestions.filter(s => !list.find(x => x.kw === s.kw));
  const connected = gsc === 'connected' || gsc === 'error';
  return <div className="col" style={{ gap: 16 }}>
    <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}><p className="small sub grow" style={{ minWidth: 240, maxWidth: 560 }}>Radar targets these in every topic, article, and post, and tracks them in search results and AI answers. Star up to 3 as priorities.</p>{list.length > 0 && <Inferred edited={!!edited['keywords.list']} />}</div>
    <form className="row" style={{ gap: 8 }} onSubmit={e => { e.preventDefault(); add(draft); setDraft(''); }}><input className="input" placeholder="Add a keyword your customers search for" value={draft} onChange={e => setDraft(e.target.value)} /><Btn type="submit" icon="plus" disabled={!draft.trim()}>Add</Btn></form>
    <div style={{ borderTop: '1px solid var(--line)' }}>
      <div className="row xs sub kw-row" style={{ padding: '8px 4px', gap: 14 }}><span style={{ width: 28 }} /><span className="grow">Keyword</span><span className="kw-c" style={{ width: 84, textAlign: 'right' }}>Searches</span><span className="kw-c" style={{ width: 66, textAlign: 'right' }}>Difficulty</span><span style={{ width: 92, textAlign: 'right' }}>Your position</span><span style={{ width: 32 }} /></div>
      {sorted.map(k => {
        const m = measured[k.kw] || null; const pos = connected ? (m ? m.pos.toFixed(1) : 'Not ranking') : '—';
        return <div key={k.kw} className="row kw-row" style={{ padding: '10px 4px', borderTop: '1px solid var(--line2)', gap: 14 }}>
          <button type="button" aria-label={k.priority ? 'Remove priority' : 'Make priority'} aria-pressed={k.priority} disabled={!k.priority && pri >= 3} onClick={() => save(list.map(x => x.kw === k.kw ? { ...x, priority: !x.priority } : x))} style={{ width: 28, height: 28, border: 0, background: 'none', cursor: 'pointer', color: k.priority ? 'var(--signal)' : 'var(--faint)', display: 'grid', placeItems: 'center', opacity: !k.priority && pri >= 3 ? .3 : 1 }}><svg width="16" height="16" viewBox="0 0 24 24" fill={k.priority ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></svg></button>
          <span className="col grow" style={{ minWidth: 0, gap: 1 }}><span className="trunc" style={{ fontWeight: k.priority ? 600 : 500 }}>{k.kw}</span><span className="xs sub trunc">{k.intent} · {KW_SRC_L[k.src]}</span></span>
          <span className="kw-c num small" style={{ width: 84, textAlign: 'right' }}>{k.vol != null ? '~' + fmtN(k.vol) : <span className="sub">Estimating…</span>}</span>
          <span className="kw-c num small sub" style={{ width: 66, textAlign: 'right' }}>{k.kd != null ? k.kd : '—'}</span>
          <span className="num small" style={{ width: 92, textAlign: 'right', color: pos === 'Not ranking' || pos === '—' ? 'var(--mute)' : (m && m.pos > 10 ? 'var(--signal-ink)' : 'var(--ink)') }}>{pos}</span>
          <Btn kind="ghost" size="sm" icon="x" aria-label={'Remove ' + k.kw} onClick={() => save(list.filter(x => x.kw !== k.kw))} style={{ width: 32 }} />
        </div>;
      })}
      {!list.length && <p className="small sub" style={{ padding: '16px 4px' }}>No keywords yet. Add one above or use Radar’s suggestions.</p>}
    </div>
    <span className="xs sub">Searches and difficulty are estimates. Position is measured in Search Console{connected ? '' : ' once connected'}.</span>
    {!compact && <div className="col" style={{ gap: 4, marginTop: 6 }}>
      <Btn kind="link" className="small" style={{ alignSelf: 'flex-start' }} iconR={sug ? 'chevD' : 'chevR'} onClick={() => setSug(!sug)}>{sugs.length} suggested keywords</Btn>
      {sug && <div className="enter" style={{ marginTop: 8 }}>{sugs.map((s, i) => <div key={s.kw} className="row" style={{ padding: '10px 4px', borderTop: i ? '1px solid var(--line2)' : 0, gap: 14 }}>
        <span className="col grow" style={{ minWidth: 0 }}><span className="trunc">{s.kw}</span><span className="xs sub">{s.why} · ~{fmtN(s.vol)} searches</span></span>
        <Btn size="sm" icon="plus" onClick={() => add(s)}>Add</Btn></div>)}{!sugs.length && <p className="small sub">You’ve added every suggestion.</p>}</div>}
    </div>}
    <style>{`@media(max-width:640px){.kw-c{display:none!important}}`}</style>
  </div>;
}
