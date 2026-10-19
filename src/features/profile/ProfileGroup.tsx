'use client';
// Port of ProfileGroup (prototype/radar-onboarding.jsx). Used by onboarding Review and the Business Profile page.
import React, { useRef } from 'react';
import { Btn, ColorField, Field, Inferred, ListEditor, LogoTile } from '@/components/ui';
import { langs } from '@/lib/constants';
import { KeywordList } from './KeywordList';
import type { Edited, GscStatus, KeywordSuggestion, Profile, Workspace } from '@/lib/types';

export type GroupKey = 'business' | 'audience' | 'keywords' | 'brand';
export interface ProfileGroupProps {
  group: GroupKey; profile: Profile; edited: Edited; onChange: (p: Profile, key: string) => void;
  gsc?: GscStatus; measured?: Workspace['measured']; suggestions?: KeywordSuggestion[];
}
export function ProfileGroup({ group, profile, edited, onChange, gsc, measured, suggestions }: ProfileGroupProps) {
  const P: any = (profile as any)[group];
  const up = (k: string, v: any, extra?: Record<string, any>) => { const p = JSON.parse(JSON.stringify(profile)); p[group][k] = v; if (extra) Object.assign(p[group], extra); onChange(p, group + '.' + k); };
  const M = (k: string) => <Inferred edited={!!edited[group + '.' + k]} />;
  const fileRef = useRef<HTMLInputElement>(null);
  if (group === 'keywords') return <KeywordList profile={profile} edited={edited} onChange={onChange} gsc={gsc} measured={measured} suggestions={suggestions} />;
  if (group === 'business') return <div className="col" style={{ gap: 22 }}>
    <div className="grid-2"><Field label="Business name" mark={M('name')}><input className="input" value={P.name} onChange={e => up('name', e.target.value)} /></Field><Field label="Industry" mark={M('industry')}><input className="input" value={P.industry} onChange={e => up('industry', e.target.value)} /></Field></div>
    <Field label="Description" mark={M('description')}><textarea className="input" rows={2} value={P.description} onChange={e => up('description', e.target.value)} /></Field>
    <Field label="Positioning" mark={M('positioning')} hint="How you’d describe your place in the market in one sentence."><textarea className="input" rows={2} value={P.positioning} onChange={e => up('positioning', e.target.value)} /></Field>
    <div className="grid-2"><Field label="Offerings" mark={M('offerings')}><ListEditor items={P.offerings} onChange={v => up('offerings', v)} placeholder="Add offering" /></Field><Field label="Differentiators" mark={M('differentiators')}><ListEditor items={P.differentiators} onChange={v => up('differentiators', v)} placeholder="Add differentiator" /></Field></div>
  </div>;
  if (group === 'audience') return <div className="col" style={{ gap: 22 }}>
    <div className="grid-2"><Field label="Customer segments" mark={M('segments')}><ListEditor items={P.segments} onChange={v => up('segments', v)} placeholder="Add segment" /></Field><Field label="Key buyers" mark={M('buyers')}><ListEditor items={P.buyers} onChange={v => up('buyers', v)} placeholder="Add buyer" /></Field></div>
    <div className="grid-2"><Field label="Needs" mark={M('needs')}><ListEditor items={P.needs} onChange={v => up('needs', v)} placeholder="Add need" /></Field><Field label="Competitors" mark={M('competitors')} hint="Radar avoids promoting these and finds gaps they leave."><ListEditor items={P.competitors} onChange={v => up('competitors', v)} placeholder="Add competitor" /></Field></div>
  </div>;
  const L = langs(); const langOpts = P.language && !L.includes(P.language) ? [P.language, ...L] : L;
  return <div className="col" style={{ gap: 24 }}>
    <Field label="Logo" mark={P.logo && P.logoUploaded ? <span className="edited"><i />Uploaded</span> : P.logo ? M('logo') : <span className="xs" style={{ color: 'var(--warn)' }}>Not found</span>}>
      <div className="row" style={{ gap: 16 }}><LogoTile brand={P} s={64} /><div className="col" style={{ gap: 6 }}><div className="row" style={{ gap: 8 }}><Btn size="sm" icon="upload" onClick={() => fileRef.current?.click()}>{P.logo ? 'Replace' : 'Upload logo'}</Btn>{P.logo && <Btn size="sm" kind="ghost" onClick={() => up('logo', null, { logoUploaded: false })}>Remove</Btn>}</div><span className="xs sub">SVG or PNG, square works best. Used on generated visuals.</span></div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => up('logo', r.result, { logoUploaded: true }); r.readAsDataURL(f); e.target.value = ''; }} /></div>
    </Field>
    <div className="grid-2"><ColorField label="Primary color" value={P.primary} onChange={v => up('primary', v)} mark={M('primary')} /><ColorField label="Secondary color" value={P.secondary} onChange={v => up('secondary', v)} mark={M('secondary')} /></div>
    <Field label="Brand voice" mark={M('voice')} hint="Generated articles and posts are written in this voice."><textarea className="input" rows={2} value={P.voice} onChange={e => up('voice', e.target.value)} /></Field>
    <div className="grid-2"><Field label="Language" mark={M('language')}><select className="input" value={P.language} onChange={e => up('language', e.target.value)}>{langOpts.map(l => <option key={l}>{l}</option>)}</select></Field><Field label="Target markets" mark={M('markets')}><ListEditor items={P.markets} onChange={v => up('markets', v)} placeholder="Add market" /></Field></div>
  </div>;
}
