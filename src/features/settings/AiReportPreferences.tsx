'use client';
import { useEffect, useRef, useState } from 'react';
import { Btn } from '@/components/ui';
interface Preference { id:string; domain:string; weeklyEmail:boolean }
const endpoint = '/api/me/ai-report-preferences';
export function AiReportPreferences() {
  const [rows,setRows] = useState<Preference[]|null>(null), [loading,setLoading] = useState(true), [busy,setBusy] = useState(false), [error,setError] = useState(''), [saved,setSaved] = useState(false), [retry,setRetry] = useState(0);
  const generation = useRef(0), saving = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    const load = async () => {
      if (saving.current) return;
      const version = ++generation.current; setLoading(true); setError('');
      try { const response = await fetch(endpoint,{credentials:'same-origin',cache:'no-store',signal:controller.signal}); if (!response.ok) throw new Error(); const data = await response.json(); if (alive && version === generation.current) setRows(data); }
      catch(e) { if (alive && version === generation.current && !(e instanceof Error && e.name === 'AbortError')) setError('Your weekly AI report preferences couldn’t load. Try again.'); }
      finally { if (alive && version === generation.current) setLoading(false); }
    };
    void load(); window.addEventListener('focus',load);
    return () => { alive = false; generation.current++; controller.abort(); window.removeEventListener('focus',load); };
  },[retry]);
  const change = async (row:Preference, checked:boolean) => {
    if (!rows || loading || saving.current) return;
    const previous = rows, version = ++generation.current; saving.current = true; setBusy(true); setError(''); setSaved(false); setRows(rows.map(r => r.id === row.id ? {...r,weeklyEmail:checked} : r));
    try { const response = await fetch(endpoint,{method:'PATCH',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({businessId:row.id,weeklyEmail:checked})}); if (!response.ok) throw new Error(); const data = await response.json(); if (version === generation.current) { setRows(data); setSaved(true); } }
    catch { if (version === generation.current) { setRows(previous); setError('Your change wasn’t saved. Try again.'); } }
    finally { saving.current = false; if (version === generation.current) setBusy(false); }
  };
  return <section aria-label="Weekly AI recommendation reports" aria-busy={loading||busy} style={{marginBottom:24}}>
    <h2 className="h3">Weekly AI recommendation reports</h2>
    <p className="small sub">A weekly report for each business with collected AI answers. Reports share the daily optional-email limit and don’t require research participation.</p>
    {loading && !rows ? <p className="xs sub" role="status">Loading report preferences…</p> : rows?.map(row => <label key={row.id} className="row" style={{gap:12,padding:'12px 0',alignItems:'flex-start'}}><input type="checkbox" checked={row.weeklyEmail} disabled={loading||busy} onChange={e => void change(row,e.target.checked)} style={{width:18,height:18,accentColor:'var(--ink)'}}/><span className="small" style={{overflowWrap:'anywhere'}}>Weekly AI report for {row.domain}</span></label>)}
    {rows?.length === 0 && <p className="xs sub">Report preferences appear here for businesses you own or administer.</p>}
    <div aria-live="polite">{busy ? <p role="status" className="xs sub">Saving…</p> : saved ? <p role="status" className="xs sub">Report preferences saved.</p> : null}</div>
    {error && <div><p className="small" role="alert">{error}</p>{error.includes('load') && <Btn size="sm" onClick={() => setRetry(n=>n+1)}>Try again</Btn>}</div>}
  </section>;
}
