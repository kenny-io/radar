'use client';
// Settings → Content → Writing instructions: standing instructions per set, layered into every writing prompt
// (server: src/server/ai/instructions.ts). Each field autosaves on its own; Viewers read them but can't change them.
import React, { useEffect, useId, useRef, useState } from 'react';
import { useApp } from '@/client/app';
import { ApiError, actCall } from '@/client/api';
import { AutoText, Btn, Section } from '@/components/ui';
import { INSTRUCTION_MAX, INSTRUCTION_SETS, cleanInstruction } from '@/lib/constants';
import type { InstructionKey, Workspace } from '@/lib/types';

const GENERAL = INSTRUCTION_SETS.filter(s => s.group === 'general');
const PLATFORMS = INSTRUCTION_SETS.filter(s => s.group === 'platform');
const MAX_L = INSTRUCTION_MAX.toLocaleString('en-US');
/** Text whose save failed, by business and set, so leaving the section and coming back never loses it. */
const unsaved = new Map<string, string>();

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return <div className="row" style={{ padding: '18px 0', borderTop: '1px solid var(--line2)', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
    <span className="col set-l" style={{ width: 220, gap: 3 }}><span className="small" style={{ fontWeight: 500 }}>{title}</span>{hint && <span className="xs sub" style={{ overflowWrap: 'anywhere' }}>{hint}</span>}</span>
    <div className="grow col" style={{ gap: 8, minWidth: 0, flexBasis: 240 }}>{children}</div>
  </div>;
}

/** One set. Shows the local draft while it has unsaved or focused edits, the workspace value otherwise, so a failed save
 *  or a workspace refresh never discards typed text and another member's change appears when the field is clean. */
function InstructionField({ k, label, ph, viewer, focus }: { k: InstructionKey; label: string; ph: string; viewer: boolean; focus?: boolean }) {
  const app = useApp(); const B = app.B!;
  const bid = B.id; const key = `${bid}:${k}`;
  const saved = B.instructions?.[k] || '';
  const [draft, setDraftState] = useState<string | null>(() => (viewer ? null : unsaved.get(key) ?? null));
  const [st, setSt] = useState<'idle' | 'saving' | 'saved' | 'failed'>(draft != null ? 'failed' : 'idle');
  const [err, setErr] = useState('');
  const metaId = useId();
  const draftRef = useRef(draft);
  const confirmed = useRef(saved); // last value known to be stored
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flying = useRef<string | null>(null); // text of the request in flight (one at a time per field, so saves land in order)
  const again = useRef(false);
  const focused = useRef(false);
  const liveBid = useRef(app.bid); liveBid.current = app.bid;
  if (draft == null) confirmed.current = saved;
  const setDraft = (v: string | null) => { draftRef.current = v; setDraftState(v); };
  const drop = () => { unsaved.delete(key); setDraft(null); };

  const send = (t: string) => {
    flying.current = t; setSt('saving'); setErr('');
    const optimistic = (b: Workspace): Workspace => { const n = { ...b.instructions }; if (t) n[k] = t; else delete n[k]; return { ...b, instructions: n }; };
    // Always written to the business this text was typed for, even if the current business changed meanwhile.
    const req: Promise<unknown> = liveBid.current === bid ? app.act('settings.instructions', { set: k, text: t }, { optimistic, keepLocal: true, silent: true }) : actCall(bid, 'settings.instructions', { set: k, text: t });
    req.then(() => {
      flying.current = null; confirmed.current = t;
      if (cleanInstruction(draftRef.current ?? '').length <= INSTRUCTION_MAX) unsaved.delete(key); // an over-limit draft typed meanwhile is kept
      if (again.current) { again.current = false; flush(); return; }
      if (cleanInstruction(draftRef.current ?? t) !== t) return; // edited since: its own timer saves it
      setSt('saved');
      if (!focused.current) drop();
    }, (e: unknown) => {
      flying.current = null;
      if (again.current) { again.current = false; flush(); return; }
      if (timer.current) return; // a newer edit is about to be saved
      if (draftRef.current != null) unsaved.set(key, draftRef.current);
      const tooLong = e instanceof ApiError && e.code === 'too_long';
      setErr(tooLong ? e.message : ''); setSt('failed');
      if (!tooLong) app.toast('Radar couldn’t save your instructions. Your text is still here.', { tone: 'bad', action: { label: 'Try again', fn: flush } });
    });
  };
  function flush() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const v = draftRef.current; if (v == null) return;
    const t = cleanInstruction(v);
    if (t.length > INSTRUCTION_MAX) return; // over the limit: nothing is sent
    if (flying.current != null) { again.current = flying.current !== t; return; }
    if (t === confirmed.current) { setSt('saved'); setErr(''); if (!focused.current) drop(); return; }
    send(t);
  }
  const change = (v: string) => {
    setDraft(v); setErr('');
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    // Over the limit: nothing is sent, so keep the text for a return to this section. A sendable edit clears that copy
    // (a failed save puts it back).
    if (cleanInstruction(v).length > INSTRUCTION_MAX) { unsaved.set(key, v); setSt('idle'); return; }
    unsaved.delete(key);
    setSt('saving');
    timer.current = setTimeout(flush, 800);
  };
  const blur = () => {
    focused.current = false;
    if (timer.current) flush();
    else if (flying.current == null && draftRef.current != null && cleanInstruction(draftRef.current) === confirmed.current) drop();
  };
  // Leaving the section (set-pane remounts on tab change) sends a pending edit at once.
  const flushRef = useRef(flush); flushRef.current = flush;
  useEffect(() => () => { if (timer.current) flushRef.current(); }, []);

  const value = draft ?? saved;
  const n = cleanInstruction(value).length; const over = n > INSTRUCTION_MAX;
  if (viewer && !value) return <span className="small sub">None</span>;
  const state = over ? `Too long to save. Shorten it to ${MAX_L} characters.` : st === 'failed' ? err || 'Not saved.' : st === 'saving' ? 'Saving…' : st === 'saved' ? 'Saved' : '';
  const bad = over || st === 'failed';
  return <>
    <AutoText className={'input' + (over ? ' err' : '')} minRows={3} value={value} readOnly={viewer} aria-readonly={viewer || undefined} autoFocus={focus} placeholder={viewer ? undefined : ph}
      aria-label={'Writing instructions: ' + label} aria-describedby={metaId} aria-invalid={over || undefined}
      onChange={viewer ? undefined : e => change(e.target.value)} onFocus={() => { focused.current = true; }} onBlur={viewer ? undefined : blur} />
    <div className="row" id={metaId} style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
      <span className="row" style={{ gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
        <span className="xs sub" role="status" aria-live="polite" style={bad ? { color: 'var(--bad)' } : undefined}>{state}</span>
        {!over && st === 'failed' && !err && <button type="button" className="unlink" onClick={flush}>Try again</button>}
      </span>
      <span className="xs sub num" style={over ? { color: 'var(--bad)' } : undefined}>{n.toLocaleString('en-US')} / {MAX_L}</span>
    </div>
  </>;
}

export function WritingInstructionsSettings() {
  const { B } = useApp();
  // Platform sets stay compact until used: a row shows when it has text or was opened this visit.
  const [opened, setOpened] = useState<InstructionKey[]>(() => PLATFORMS.filter(s => B?.instructions?.[s.k] || (B && unsaved.has(`${B.id}:${s.k}`))).map(s => s.k));
  const [added, setAdded] = useState<InstructionKey | null>(null);
  // A row that gains text (here or from another member) stays for the rest of the visit, even if it is cleared again.
  const have = PLATFORMS.filter(s => B?.instructions?.[s.k]).map(s => s.k).join(' ');
  useEffect(() => { if (have) setOpened(o => { const more = (have.split(' ') as InstructionKey[]).filter(k => !o.includes(k)); return more.length ? [...o, ...more] : o; }); }, [have]);
  if (!B) return null;
  const viewer = B.role === 'Viewer';
  const ins = B.instructions || {};
  const shown = PLATFORMS.filter(s => (viewer ? !!ins[s.k] : opened.includes(s.k) || !!ins[s.k]));
  const rest = viewer ? [] : PLATFORMS.filter(s => !shown.includes(s));
  const add = (k: InstructionKey) => { setOpened(o => [...o, k]); setAdded(k); };
  return <Section title="Writing instructions" style={{ marginTop: 0 }}>
    <p className="small sub" style={{ marginBottom: 8, maxWidth: 590 }}>Standing instructions for how Radar writes. They apply to every new draft, regeneration and rewrite, and Radar’s accuracy and platform rules still apply.</p>
    <p className="xs sub" style={{ marginBottom: 6, maxWidth: 590 }}>The most specific instruction wins: platform, then content type, then everything. Existing drafts don’t change until you regenerate or rewrite them.</p>
    <p className="xs sub" style={{ marginBottom: viewer ? 12 : 20, maxWidth: 590 }}>Radar won’t invent facts, add links where a platform forbids them or go over a platform’s length limit, whatever the instructions say. Daily Brief drafts stay short and never use hashtags or emoji. Put facts and figures in your Business Profile.</p>
    {viewer && <p className="small sub" style={{ marginBottom: 20 }}>Only editors, admins and owners can change these.</p>}
    {[...GENERAL, ...shown].map(s => <Row key={s.k} title={s.l} hint={s.d}><InstructionField k={s.k} label={s.l} ph={s.ph} viewer={viewer} focus={added === s.k} /></Row>)}
    {rest.length > 0 && <Row title="By platform" hint="Extra instructions for one platform. They add to the ones above.">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>{rest.map(s => <Btn key={s.k} size="sm" icon="plus" aria-label={'Add instructions for ' + s.l} onClick={() => add(s.k)}>{s.l}</Btn>)}</div>
    </Row>}
  </Section>;
}
