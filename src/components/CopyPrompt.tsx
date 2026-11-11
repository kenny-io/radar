'use client';
import React, { useEffect, useId, useRef, useState } from 'react';
import { Btn } from '@/components/ui';
import { copyPromptText } from '@/lib/promptClipboard';

/** Copying is local and read-only; recovery also works when browser clipboard access is denied. */
export function CopyPrompt({ prompt, label, all = false }: { prompt: string; label: string; all?: boolean }) {
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const statusId = useId();
  const requestId = useRef(0);
  useEffect(() => { setState('idle'); return () => { requestId.current++; }; }, [prompt]);
  const copy = async () => {
    const request = ++requestId.current;
    setState('copying');
    try { await copyPromptText(prompt); if (request === requestId.current) setState('copied'); }
    catch { if (request === requestId.current) setState('failed'); }
  };
  return <div className="col" style={{ gap: 6, minWidth: 0, alignItems: 'flex-start', width: '100%' }}>
    <Btn size="sm" icon={state === 'copied' ? 'check' : 'copy'} loading={state === 'copying'} onClick={copy} aria-label={label} aria-describedby={statusId}>{state === 'copied' ? 'Copied' : all ? 'Copy all changes' : 'Copy prompt'}</Btn>
    <span id={statusId} role="status" className="xs" style={{ color: state === 'failed' ? 'var(--bad)' : 'var(--ink2)' }}>{state === 'copied' ? 'Prompt copied. Paste it into your coding agent.' : state === 'failed' ? 'Clipboard access failed. Try again, or select and copy the prompt below.' : ''}</span>
    {state === 'failed' && <textarea className="input" aria-label={`Prompt for manual copying: ${label}`} readOnly value={prompt} onFocus={e => e.currentTarget.select()} rows={7} style={{ width: '100%', minWidth: 0, fontSize: 13, resize: 'vertical' }} />}
  </div>;
}
