'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/client/api';
import { Btn, Icon } from '@/components/ui';
import { MAX_HISTORY, MESSAGE_MAX, HISTORY_TEXT_MAX, type SupportMessage, type SupportPage, type SupportRequest, type SupportResponse } from '@/lib/support';
import './support.css';

const STARTERS = ['How do I publish an article?', 'How does Daily Brief work?', 'How do I connect Search Console?'];

/** The face is a small geometric icon, using the same rounded stroke as Radar's UI. */
function SupportHead({ small = false }: { small?: boolean }) {
  return <svg className="support-head" width={small ? 30 : 34} height={small ? 30 : 34} viewBox="0 0 36 36" fill="none" aria-hidden="true">
    <path d="M9 12.5C9 8.9 12 6 15.5 6h5c3.6 0 6.5 2.9 6.5 6.5v9c0 4.7-3.9 8.5-8.5 8.5h-1C12.8 30 9 26.2 9 21.5v-9Z" stroke="currentColor" strokeWidth="1.6" />
    <path d="M5 16v5M31 16v5M14 16v2M22 16v2M14.5 23c2 1.5 5 1.5 7 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M18 6V3" stroke="var(--signal)" strokeWidth="1.8" strokeLinecap="round" /><circle cx="18" cy="2.5" r="1.5" fill="var(--signal)" />
  </svg>;
}

/** Trim oldest context first, keeping the request inside the endpoint's UTF-8 body limit. */
function boundedRequest<T extends SupportRequest>(request: T): T {
  const history = request.history.slice(-MAX_HISTORY).map(m => ({ ...m, text: m.text.slice(0, HISTORY_TEXT_MAX) }));
  const result = { ...request, history };
  while (history.length && new TextEncoder().encode(JSON.stringify(result)).length > 32 * 1024) history.shift();
  return result;
}

export function SupportWidget({ businessId, userEmail, page }: { businessId: string; userEmail: string; page: SupportPage }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'ask' | 'handoff' | null>(null);
  const [error, setError] = useState('');
  const [retryAsk, setRetryAsk] = useState<Extract<SupportRequest, { kind: 'ask' }> | null>(null);
  const [needsHuman, setNeedsHuman] = useState(false);
  const [confirmHandoff, setConfirmHandoff] = useState(false);
  const [handoff, setHandoff] = useState<Extract<SupportResponse, { kind: 'handoff' }> | null>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const handoffActions = useRef<HTMLDivElement>(null);
  const requestBusy = useRef(false);
  const mounted = useRef(true);
  const handoffRequest = useRef<Extract<SupportRequest, { kind: 'handoff' }> | null>(null);
  const id = useId();
  const latestQuestion = [...messages].reverse().find(m => m.role === 'user');

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (open) {
      if (confirmHandoff) handoffActions.current?.querySelector('button')?.focus();
      else composer.current?.focus();
    }
  }, [open, confirmHandoff]);
  useEffect(() => {
    const el = transcript.current;
    if (el && open) el.scrollTop = el.scrollHeight;
  }, [messages, busy, open, confirmHandoff, handoff]);

  const close = () => { setOpen(false); launcher.current?.focus(); };
  const focusComposer = () => {
    if (panel.current?.contains(document.activeElement)) composer.current?.focus();
  };

  async function ask(text: string, retry?: Extract<SupportRequest, { kind: 'ask' }>) {
    const question = text.trim();
    if (!question || question.length > MESSAGE_MAX || requestBusy.current) return;
    const request = retry || boundedRequest({ kind: 'ask', message: question, history: messages, page });
    requestBusy.current = true; setBusy('ask'); setError(''); setRetryAsk(null);
    setConfirmHandoff(false); setHandoff(null); handoffRequest.current = null; setNeedsHuman(false);
    if (!retry) { setMessages(m => [...m, { role: 'user', text: question }]); setDraft(''); }
    try {
      const { data } = await api<{ ok: true; data: SupportResponse }>(`/api/b/${businessId}/support`, { body: request });
      if (!mounted.current) return;
      if (data.kind !== 'answer') throw new Error('Radar couldn’t answer this question. Try again or email support.');
      setMessages(m => [...m, { role: 'assistant', text: data.reply }]); setNeedsHuman(data.needsHuman);
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : 'Radar couldn’t answer this question. Try again or email support.');
      setRetryAsk(request);
    } finally {
      requestBusy.current = false;
      if (mounted.current) { setBusy(null); focusComposer(); }
    }
  }

  async function forward() {
    if (!latestQuestion || requestBusy.current || handoff) return;
    // Preserve the exact request and UUID when retrying an uncertain delivery.
    if (!handoffRequest.current) {
      handoffRequest.current = boundedRequest({ kind: 'handoff', message: latestQuestion.text,
        history: messages, page, requestId: crypto.randomUUID() });
    }
    requestBusy.current = true; setBusy('handoff'); setError('');
    try {
      const { data } = await api<{ ok: true; data: SupportResponse }>(`/api/b/${businessId}/support`, { body: handoffRequest.current });
      if (!mounted.current) return;
      if (data.kind !== 'handoff') throw new Error('Your message couldn’t be sent. Try again.');
      setHandoff(data); setRetryAsk(null); setConfirmHandoff(false);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Your message couldn’t be sent. Try again.');
    } finally {
      requestBusy.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  return <div className="radar-support">
    {open && <section ref={panel} className="support-panel" id={id} role="dialog" aria-modal="false" aria-labelledby={`${id}-title`}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
      <header className="support-header">
        <span className="support-avatar"><SupportHead small /></span>
        <div className="grow"><h2 id={`${id}-title`}>Radar support</h2><p>AI assistant · Here to help</p></div>
        <Btn kind="ghost" icon="x" aria-label="Close support" onClick={close} />
      </header>

      <div className="support-content" ref={transcript}>
        {!messages.length && <div className="support-welcome">
          <h3>A little help, right here.</h3>
          <p>Ask me about using Radar. If you need a person, you can send your question to our team.</p>
          <div className="support-starters">{STARTERS.map(question => <button key={question} type="button" onClick={() => void ask(question)} disabled={!!busy}>{question}<Icon n="arrow" s={15} /></button>)}</div>
        </div>}
        <div className="support-messages" role="log" aria-live="polite" aria-relevant="additions" aria-label="Support conversation">
          {messages.map((message, i) => <div key={i} className={`support-message support-message-${message.role}`}>
            <span className="support-speaker">{message.role === 'user' ? 'You' : 'Radar AI'}</span><p>{message.text}</p>
          </div>)}
        </div>
        {busy === 'ask' && <p className="support-thinking" role="status"><span className="spin" />Thinking about your question…</p>}
        {needsHuman && !confirmHandoff && !handoff && <p className="support-human-note">Let’s get the team to help with this.</p>}

        {confirmHandoff && !handoff && <div className="support-handoff">
          <h3>Send this to our team?</h3>
          <p>Your question, recent conversation and business details will be sent to <strong>support@thally.io</strong>.</p>
          <p>We’ll use <strong>{userEmail}</strong> to reply.</p>
          <div className="support-handoff-actions" ref={handoffActions}>
            <Btn kind="primary" size="sm" loading={busy === 'handoff'} onClick={() => void forward()}>Send to support</Btn>
            <Btn kind="link" size="sm" disabled={!!busy} onClick={() => { setConfirmHandoff(false); setError(''); }}>Keep chatting</Btn>
          </div>
        </div>}
        {handoff && <div className="support-handoff support-sent" role="status">
          <Icon n="check" s={19} /><div><h3>{handoff.delivered ? 'Sent to the team.' : 'Saved as a development test.'}</h3>
            <p>{handoff.delivered ? `We’ll reply to ${userEmail}.` : 'No email was sent. Your message was captured locally for testing.'}</p>
            <p className="support-reference">Reference: {handoff.reference}</p></div>
        </div>}
        {error && <div className="support-error" role="alert"><p>{error}</p>{retryAsk && !confirmHandoff && <Btn kind="link" size="sm" onClick={() => void ask(retryAsk.message, retryAsk)} disabled={!!busy}>Try answer again</Btn>}</div>}
      </div>

      {!confirmHandoff && <form className="support-composer" onSubmit={e => { e.preventDefault(); void ask(draft); }}>
        <label className="support-sr-only" htmlFor={`${id}-question`}>Your question</label>
        <div className="support-input-row"><textarea ref={composer} id={`${id}-question`} placeholder="Ask a question about Radar…" rows={2} maxLength={MESSAGE_MAX} value={draft} readOnly={!!busy}
          onChange={e => setDraft(e.target.value)} aria-describedby={`${id}-hint`}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(draft); } }} />
          <Btn kind="primary" type="submit" icon="arrow" aria-label="Send question" disabled={!draft.trim() || !!busy} />
        </div>
        <div className="support-composer-meta"><span id={`${id}-hint`}>AI answers can be mistaken.</span><span>{draft.length}/{MESSAGE_MAX.toLocaleString('en-US')}</span></div>
      </form>}
      {!confirmHandoff && <footer className="support-footer"><span>{handoff ? 'Have another question?' : 'Need a person?'}</span>
        {handoff ? <Btn kind="link" size="sm" onClick={() => { setConfirmHandoff(false); setHandoff(null); composer.current?.focus(); }}>Keep chatting</Btn>
          : <Btn kind="link" size="sm" disabled={!latestQuestion || !!busy} onClick={() => { setConfirmHandoff(true); setError(''); }}>Email support</Btn>}
      </footer>}
    </section>}
    <button className={`support-launcher${open ? ' support-launcher-open' : ''}`} ref={launcher} type="button" aria-label={open ? 'Close Radar support' : 'Open Radar support'} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { if (open) close(); else setOpen(true); }}><SupportHead /><span className="support-launcher-label">Ask Radar</span></button>
  </div>;
}
