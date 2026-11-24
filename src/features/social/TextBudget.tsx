'use client';
// Live text budget for a post editor (custom posts, design.md §2 "Counters", §6). It renders `textBudget` from
// lib/socialPublish — the same function the server's preflight enforces — so the counter and the server never disagree.
import React, { useEffect, useRef, useState } from 'react';
import { plat } from '@/lib/constants';
import { textBudget } from '@/lib/socialPublish';
import type { Platform } from '@/lib/types';

const n0 = (x: number) => x.toLocaleString('en-US');
export type BudgetState = 'ok' | 'over' | 'empty';
export interface BudgetView {
  state: BudgetState; over: number;
  /** Visible counter, exact: "312 / 280 · 32 over", "1,204 / 5,000 bytes", "1,204 characters". */
  counter: string;
  /** The line under the editor, or null when within the limit. */
  message: string | null;
  /** What the polite live region says when the state changes. */
  announce: string;
  /** Changes only between within the limit, over (in steps of 10) and empty: the live region speaks on a new key only. */
  key: string;
}

export function budgetView(k: Platform, text: string, o: { video?: boolean } = {}): BudgetView {
  const b = textBudget(k, text, o); const pl = plat(k).l;
  const empty = !text.trim(); const unit = b.unit === 'bytes' ? 'bytes' : 'characters';
  const counter = b.max == null ? `${n0(b.used)} characters` : `${n0(b.used)} / ${n0(b.max)}${b.unit === 'bytes' ? ' bytes' : ''}${b.over ? ` · ${n0(b.over)} over` : ''}`;
  if (empty) return { state: 'empty', over: 0, counter, message: `Write something to post on ${pl}.`, announce: `${pl}: no text yet.`, key: 'empty' };
  if (b.over > 0) return { state: 'over', over: b.over, counter, message: `Shorten by ${n0(b.over)} ${unit === 'bytes' ? 'bytes' : b.over === 1 ? 'character' : 'characters'} to post on ${pl}. You can still save.`, announce: `${pl}: ${n0(b.over)} ${unit} over the ${n0(b.max!)} limit.`, key: `over:${Math.ceil(b.over / 10)}` };
  return { state: 'ok', over: 0, counter, message: null, announce: b.max == null ? `${pl}: ${n0(b.used)} characters.` : `${pl}: within the ${n0(b.max)} ${unit} limit.`, key: 'ok' };
}

/** The exact counter. Put its `id` in the editor's aria-describedby. */
export function BudgetCounter({ view, id, style }: { view: BudgetView; id?: string; style?: React.CSSProperties }) {
  return <span id={id} className="xs num" style={{ color: view.state === 'over' ? 'var(--bad)' : 'var(--mute)', whiteSpace: 'nowrap', ...style }}>{view.counter}</span>;
}

/** The message line (over the limit: red; empty: muted until `strict`, e.g. after the user tried to save). */
export function BudgetMessage({ view, id, strict }: { view: BudgetView; id?: string; strict?: boolean }) {
  if (!view.message) return <span id={id} hidden />;
  const bad = view.state === 'over' || (view.state === 'empty' && strict);
  return <span id={id} className="xs" style={{ color: bad ? 'var(--bad)' : 'var(--mute)' }}>{view.message}</span>;
}

/** Visually hidden polite live region: speaks only when the budget state changes, never on every keystroke. */
export function BudgetLive({ view }: { view: BudgetView }) {
  const prev = useRef(view.key); const [say, setSay] = useState('');
  useEffect(() => { if (prev.current === view.key) return; prev.current = view.key; setSay(view.announce); }, [view.key, view.announce]);
  return <span className="sr" aria-live="polite" aria-atomic="true">{say}</span>;
}

/** Counter + message + live region as one block, for PackView's editors. `id` prefixes the counter and message ids. */
export function TextBudget({ k, text, video, id, strict }: { k: Platform; text: string; video?: boolean; id: string; strict?: boolean }) {
  const view = budgetView(k, text, { video });
  return <div className="col" style={{ gap: 4, marginTop: 10 }}>
    <BudgetCounter view={view} id={`${id}-count`} style={{ alignSelf: 'flex-end' }} />
    <BudgetMessage view={view} id={`${id}-msg`} strict={strict} />
    <BudgetLive view={view} />
  </div>;
}
/** aria-describedby for an editor using `TextBudget id={id}`. */
export const budgetDescribedBy = (id: string) => `${id}-count ${id}-msg`;
