'use client';
// "Write a post" (design.md §2): the user's own text per platform, no AI. It only writes: `social.createCustom` saves a
// custom pack, then PackView takes over for media and Post now / Schedule per platform (the upload route needs a pack id).
import React, { useEffect, useId, useState } from 'react';
import { PlatLogo, PlatName } from '@/components/brand';
import { useApp } from '@/client/app';
import { AutoText, Btn, Field, Modal } from '@/components/ui';
import { PLAT, plat } from '@/lib/constants';
import { defaultPostName } from '@/lib/customPost';
import { canPost } from '@/lib/socialPublish';
import type { Platform } from '@/lib/types';
import { BudgetCounter, BudgetLive, BudgetMessage, budgetView } from './TextBudget';

export const NAME_MAX = 120;
export const TEXT_MAX = 20000;
const INITIAL: Platform[] = ['linkedin', 'x'];
export interface Draft { text: string; linked: boolean }
type Drafts = Record<Platform, Draft>;
const freshDrafts = (): Drafts => Object.fromEntries(PLAT.map(p => [p.k, { text: '', linked: true }])) as Drafts;

/** What each platform field holds: the starting text while linked, else its own text. */
export const draftText = (d: Draft, start: string) => (d.linked ? start : d.text);
/** Toggle a platform, keeping pick order (it becomes the pack's tab order). */
export const togglePlatform = (sel: Platform[], k: Platform): Platform[] => (sel.includes(k) ? sel.filter(x => x !== k) : [...sel, k]);
/** The exact `social.createCustom` input (the action is strict: no client-only fields). */
export function customInput(name: string, sel: Platform[], drafts: Drafts, start: string) {
  const n = name.trim();
  return { ...(n ? { name: n } : {}), posts: sel.map(k => ({ platform: k, text: draftText(drafts[k], start) })) };
}
/** Hint under a platform toggle. */
export function platformHint(k: Platform, publishing: boolean): string {
  if (!publishing || !canPost(k)) return 'Copy and paste';
  if (k === 'youtube') return 'Needs a video';
  if (k === 'instagram' || k === 'tiktok') return 'Needs an image or video';
  return '';
}

export function CustomPostComposer({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (packId: string) => void }) {
  const app = useApp(); const B = app.B!; const pubOn = !!B.social.publishing; const uid = useId();
  const [name, setName] = useState(''); const [sel, setSel] = useState<Platform[]>(INITIAL); const [start, setStart] = useState('');
  const [drafts, setDrafts] = useState<Drafts>(freshDrafts); const [tried, setTried] = useState(false);
  const [err, setErr] = useState(''); const [saving, setSaving] = useState(false); const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (!open) return; setName(''); setSel(INITIAL); setStart(''); setDrafts(freshDrafts()); setTried(false); setErr(''); setSaving(false); setConfirm(false); }, [open]);

  const dirty = !!(name.trim() || start.trim() || PLAT.some(p => !drafts[p.k].linked && drafts[p.k].text.trim()));
  const close = () => { if (saving) return; if (dirty) setConfirm(true); else onClose(); };
  const firstText = sel.map(k => draftText(drafts[k], start)).find(t => t.trim()) || '';
  const edit = (k: Platform, text: string) => { setErr(''); setDrafts(d => ({ ...d, [k]: { text, linked: false } })); };
  const relink = (k: Platform) => setDrafts(d => ({ ...d, [k]: { ...d[k], linked: true } }));
  const save = async () => {
    if (saving || !sel.length) return;
    const input = customInput(name, sel, drafts, start);
    if (input.posts.every(p => !p.text.trim())) { setTried(true); setErr('Write something to post.'); return; }
    setErr(''); setSaving(true);
    try {
      const r = await app.act<{ packId: string }>('social.createCustom', input, { silent: true });
      setSaving(false); onSaved(r.packId);
    } catch (e: any) { setTried(true); setErr(e?.message || 'Radar couldn’t save this post. Try again.'); setSaving(false); }
  };

  return <>
    <Modal open={open} onClose={close} dismissable={!confirm && !saving} full focus width={720} label="Write a post">
      <div className="col cp" style={{ minHeight: 0 }}>
        <div className="col cp-body" style={{ gap: 22 }}>
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}><h2 className="h2 grow">Write a post</h2><Btn kind="ghost" icon="x" aria-label="Close" onClick={close} /></div>
          <Field label="Name (optional)" hint="Shown in your content library. Leave it empty to use your first line.">
            <input className="input" data-autofocus maxLength={NAME_MAX} value={name} placeholder={defaultPostName(firstText) || 'Thally launch'} onChange={e => setName(e.target.value)} />
          </Field>
          <div className="col" style={{ gap: 7 }}>
            <span className="label" id={`${uid}-plats`}>Platforms</span>
            <div className="row" role="group" aria-labelledby={`${uid}-plats`} style={{ flexWrap: 'wrap', gap: 8 }}>
              {PLAT.map(p => { const on = sel.includes(p.k); const hint = platformHint(p.k, pubOn); return <button key={p.k} type="button" className="cp-plat" aria-pressed={on} data-on={on} onClick={() => { setErr(''); setSel(s => togglePlatform(s, p.k)); }}>
                <PlatLogo k={p.k} s={16} /><span className="col" style={{ alignItems: 'flex-start', gap: 1 }}><span>{p.l}</span>{hint && <span className="xs sub">{hint}</span>}</span>
              </button>; })}
            </div>
            {!sel.length && <span className="xs sub">Pick at least one platform.</span>}
          </div>
          <Field label="Starting text" hint="Copied into each platform below. Edit any platform without changing the others.">
            <AutoText className="input" maxLength={TEXT_MAX} value={start} onChange={e => { setErr(''); setStart(e.target.value); }} style={{ lineHeight: 1.5, overflowWrap: 'anywhere' }} />
          </Field>
          {sel.map(k => { const d = drafts[k]; const text = draftText(d, start); const view = budgetView(k, text); const id = `${uid}-${k}`; const l = plat(k).l;
            return <div key={k} className="col" style={{ gap: 8 }}>
              <div className="row" style={{ gap: '4px 12px', flexWrap: 'wrap', borderTop: '1px solid var(--line2)', paddingTop: 14 }}>
                <span className="small grow" style={{ fontWeight: 500 }}><PlatName k={k} l={l} s={15} /></span>
                <BudgetCounter view={view} id={`${id}-count`} />{!canPost(k) && <span className="xs sub">· copy and paste</span>}
              </div>
              <AutoText className="input" maxLength={TEXT_MAX} value={text} aria-label={`${l} post text`} aria-describedby={`${id}-count ${id}-msg`} onChange={e => edit(k, e.target.value)} style={{ lineHeight: 1.5, overflowWrap: 'anywhere' }} />
              <div className="row" style={{ gap: '4px 12px', flexWrap: 'wrap', alignItems: 'baseline' }}>
                <span className="grow" style={{ minWidth: 0 }}><BudgetMessage view={view} id={`${id}-msg`} strict={tried} /></span>
                {!d.linked && <Btn kind="link" className="xs" onClick={() => relink(k)}>Use starting text</Btn>}
              </div>
              <BudgetLive view={view} />
            </div>; })}
          {err && <p className="small" role="alert" style={{ color: 'var(--bad)', margin: 0 }}>{err}</p>}
        </div>
        <div className="cp-foot">
          <span className="xs sub grow">Next: add images or video and schedule each platform.</span>
          <div className="row cp-acts" style={{ gap: 8 }}><Btn kind="ghost" disabled={saving} onClick={close}>Cancel</Btn><Btn kind="primary" loading={saving} disabled={!sel.length} onClick={save}>Save post</Btn></div>
        </div>
      </div>
    </Modal>
    <Modal open={open && confirm} onClose={() => setConfirm(false)} width={420} focus label="Discard this post?"><div className="col" style={{ padding: 28, gap: 14 }}>
      <h2 className="h2">Discard this post?</h2>
      <p className="sub small">Your text isn’t saved yet.</p>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}><Btn kind="ghost" data-autofocus onClick={() => setConfirm(false)}>Keep writing</Btn><Btn kind="danger" onClick={() => { setConfirm(false); onClose(); }}>Discard</Btn></div>
    </div></Modal>
  </>;
}
