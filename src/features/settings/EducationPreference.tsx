'use client';
import { useEffect, useRef, useState } from 'react';
import { Btn } from '@/components/ui';
const endpoint = '/api/me/education-preferences';
export function EducationPreference() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false), [retry, setRetry] = useState(0);
  const saving = useRef(false), generation = useRef(0);
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    const load = async () => {
      if (saving.current) return;
      const version = ++generation.current;
      setError('');
      try {
        const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error();
        const value = await response.json();
        if (typeof value.education !== 'boolean') throw new Error();
        if (alive && version === generation.current && !saving.current) setEnabled(value.education);
      } catch (e) { if (alive && version === generation.current && !(e instanceof Error && e.name === 'AbortError')) setError('Weekly education preferences couldn’t load. Try again.'); }
    };
    void load(); window.addEventListener('focus', load);
    return () => { alive = false; generation.current++; controller.abort(); window.removeEventListener('focus', load); };
  }, [retry]);
  async function change(checked: boolean) {
    if (saving.current || enabled === null) return;
    const previous = enabled, version = ++generation.current;
    saving.current = true; setBusy(true); setSaved(false); setError(''); setEnabled(checked);
    try {
      const response = await fetch(endpoint, { method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ education: checked }) });
      if (!response.ok) throw new Error();
      const value = await response.json();
      if (typeof value.education !== 'boolean') throw new Error();
      if (version === generation.current) { setEnabled(value.education); setSaved(true); }
    } catch { if (version === generation.current) { setEnabled(previous); setError('Your weekly education change wasn’t saved. Try again.'); } }
    finally { saving.current = false; setBusy(false); }
  }
  return <div aria-busy={busy} style={{ padding: '0 0 20px' }}>
    {enabled === null ? error ? <div><p className="small" role="alert">{error}</p><Btn size="sm" onClick={() => setRetry(n => n + 1)}>Try again</Btn></div> : <p className="small sub" role="status">Loading weekly education preferences…</p> : <>
      <label className="row" style={{ alignItems: 'flex-start', gap: 14, padding: '18px 0', cursor: busy ? 'wait' : 'pointer' }}>
        <input type="checkbox" checked={enabled} disabled={busy} onChange={event => void change(event.target.checked)} style={{ width: 18, height: 18, margin: '2px 0 0', flex: 'none', accentColor: 'var(--ink)' }} />
        <span className="col" style={{ gap: 4 }}><span className="small" style={{ fontWeight: 500 }}>Radar lessons and guides</span><span className="xs sub">Five weekly feature lessons, plus one-time guides when they’re useful. The weekly series ends after five. Turn this off to stop both lessons and guides.</span></span>
      </label>
      <div aria-live="polite">{busy ? <p className="xs sub" role="status">Saving…</p> : saved ? <p className="xs sub" role="status">Weekly education preference saved.</p> : null}{error && <p className="small" role="alert">{error}</p>}</div>
    </>}
  </div>;
}
