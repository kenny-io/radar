'use client';
import { useEffect, useRef, useState } from 'react';
import { EducationPreference } from './EducationPreference';
import { Btn } from '@/components/ui';
import type { EngagementPreferences } from '@/server/services/lifecycle/preferences';

const fields: { key: keyof EngagementPreferences; title: string; description: string }[] = [
  { key: 'dailyBrief', title: 'Daily Brief follow-through', description: 'A reminder if a brief has been ready for an hour and you haven’t copied or posted a reply.' },
  { key: 'calendarReminders', title: 'Calendar reminders', description: 'A reminder after 24 hours if you haven’t approved or scheduled anything from a new content plan.' },
  { key: 'articleSocial', title: 'Social follow-through', description: 'A reminder to turn a new article into social posts after two hours, or to schedule or post a social pack after 24 hours.' },
];
const endpoint = '/api/me/email-preferences';

/** Preferences belong to the account, across its businesses. New accounts receive them by default and can turn individual categories off. */
export function EmailSettings() {
  const [value, setValue] = useState<EngagementPreferences | null>(null);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [saved, setSaved] = useState(false), [retry, setRetry] = useState(0);
  const generation = useRef(0), savingRef = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const load = async () => {
      if (savingRef.current) return;
      const version = ++generation.current;
      setLoading(true); setError('');
      try {
        const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error();
        const next = await response.json() as EngagementPreferences;
        if (alive && version === generation.current) setValue(next);
      } catch (e) {
        if (alive && version === generation.current && !(e instanceof Error && e.name === 'AbortError')) setError('Your email preferences couldn’t load. Try again.');
      } finally { if (alive && version === generation.current) setLoading(false); }
    };
    void load(); window.addEventListener('focus', load);
    return () => { alive = false; generation.current++; controller.abort(); window.removeEventListener('focus', load); };
  }, [retry]);

  const change = async (key: keyof EngagementPreferences, checked: boolean) => {
    if (!value || savingRef.current || loading) return;
    const previous = value;
    const version = ++generation.current;
    savingRef.current = true; setSaving(true); setSaved(false); setError('');
    setValue({ ...value, [key]: checked });
    try {
      const response = await fetch(endpoint, { method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [key]: checked }) });
      if (!response.ok) throw new Error();
      const next = await response.json() as EngagementPreferences;
      if (version === generation.current) { setValue(next); setSaved(true); }
    } catch {
      if (version === generation.current) { setValue(previous); setError('Your change wasn’t saved. Try again.'); }
    } finally {
      savingRef.current = false;
      if (version === generation.current) setSaving(false);
    }
  };
  if (loading && !value) return <><EducationPreference /><p className="small sub" role="status">Loading your email preferences…</p></>;
  if (!value) return <><EducationPreference /><div className="col" style={{ gap: 12, alignItems: 'flex-start' }}><p className="small" role="alert">{error}</p><Btn size="sm" onClick={() => setRetry(n => n + 1)}>Try again</Btn></div></>;
  return <div aria-busy={loading || saving}>
    <EducationPreference />
    <p className="small sub" style={{ marginTop: 0 }}>Manage your work reminders. Radar checks that the next step is still unfinished before emailing you.</p>
    <p className="xs sub">Optional emails share a limit of one new message every 24 hours across your businesses, sent during the day. These choices don’t affect billing or security.</p>
    {fields.map(field => <label key={field.key} className="row" style={{ alignItems: 'flex-start', gap: 14, padding: '18px 0', borderTop: '1px solid var(--line2)', cursor: loading || saving ? 'wait' : 'pointer' }}>
      <input type="checkbox" checked={value[field.key]} onChange={event => void change(field.key, event.target.checked)} disabled={loading || saving} style={{ width: 18, height: 18, margin: '2px 0 0', flex: 'none', accentColor: 'var(--ink)' }} />
      <span className="col" style={{ gap: 4 }}><span className="small" style={{ fontWeight: 500 }}>{field.title}</span><span className="xs sub">{field.description}</span></span>
    </label>)}
    <div aria-live="polite" style={{ minHeight: 24 }}>
      {saving ? <p className="xs sub" role="status">Saving…</p> : saved ? <p className="xs sub" role="status">Email preferences saved.</p> : null}
      {error && <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}><p className="small" role="alert">{error}</p>{error.includes('load') && <Btn size="sm" onClick={() => setRetry(n => n + 1)}>Try again</Btn>}</div>}
    </div>
  </div>;
}
