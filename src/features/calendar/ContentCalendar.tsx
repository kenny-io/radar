'use client';
// Content Calendar — port of ContentCalendar / Research / CalSetup / PublishLine / MonthGrid / CalList / EntrySheet /
// KwMembership (prototype/radar-calendar.jsx). Research runs as the `calendar.generate` job; every write is a server action.
import React, { useEffect, useMemo, useState } from 'react';
import { useApp, type AppCtx } from '@/client/app';
import { Btn, EntryStatus, Field, Icon, Metric, Modal, PageHead, Seg, Sheet, Status } from '@/components/ui';
import { RadarField, type Blip } from '@/components/RadarField';
import { DOT_COLOR, ENTRY_TYPES, MARKETS, cadenceLabel, langs, platLabel, tzShort } from '@/lib/constants';
import { addDays, fmtD, fmtDW, fmtN, fmtTime } from '@/lib/format';
import type { CalendarEntry, CalendarSettings, EntryType, Workspace } from '@/lib/types';

type Entries = CalendarEntry[];
const LOCKED = ['published', 'scheduled'];
const sortE = (a: Entries) => [...a].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
const withEntries = (B: Workspace, fn: (e: Entries) => Entries): Workspace => ({ ...B, calendar: { ...B.calendar, entries: sortE(fn(B.calendar.entries)) } });
const patchEntry = (id: string, patch: Partial<CalendarEntry>) => (B: Workspace) => withEntries(B, es => es.map(e => (e.id === id ? { ...e, ...patch } : e)));
const kwList = (B: Workspace) => B.profile.keywords?.list || [];

/** Calendar research job state (survives reload: derived from the job, not local state). */
function useResearch(app: AppCtx) {
  const B = app.B!;
  const job = app.jobFor('calendar.generate', B.id);
  const [starting, setStarting] = useState<{ keep: boolean } | null>(null);
  const running = !!job && (job.status === 'queued' || job.status === 'running');
  // Job finished but the workspace hasn't caught up yet: keep the research view so nothing flashes.
  const catching = !!job && job.status === 'done' && !!job.result?.generatedAt && job.result.generatedAt !== B.calendar.generatedAt;
  useEffect(() => { if (catching) app.refresh(); }, [catching]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (job && starting && (running || job.status === 'failed' || job.status === 'done')) setStarting(null); }, [job?.id, job?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = (job?.progress || {}) as { phase?: number; results?: string[]; keep?: boolean; gsc?: boolean };
  const active = running || catching || !!starting;
  return {
    active, setStarting,
    phase: catching ? 7 : running ? (p.phase ?? 0) : 0,
    results: running || catching ? p.results || [] : [],
    keep: starting ? starting.keep : !!p.keep,
    gsc: p.gsc,
  };
}

export function ContentCalendar() {
  const app = useApp(); const { route, toast } = app; const B = app.B!;
  const cal = B.calendar; const entries = cal.entries;
  const params = route.params || {};
  const [setup, setSetup] = useState(!!params.setup && !entries.length);
  const [view, setView] = useState<'calendar' | 'list'>(params.view === 'list' ? 'list' : 'calendar');
  const [open, setOpen] = useState<string | null>(params.open || null);
  const [regen, setRegen] = useState(false); const [filter, setFilter] = useState<string>(params.filter || 'all');
  useEffect(() => { if (params.open) setOpen(params.open); }, [route.params]); // eslint-disable-line react-hooks/exhaustive-deps
  const research = useResearch(app);
  const generate = async (settings: CalendarSettings, keep?: boolean) => {
    setSetup(false); setRegen(false); research.setStarting({ keep: !!keep });
    try { await app.act('calendar.generate', { settings, keep: !!keep }, { optimistic: b => ({ ...b, calendar: { ...b.calendar, settings } }) }); }
    catch { research.setStarting(null); }
  };
  const upd = (id: string, patch: Partial<CalendarEntry>, action = 'calendar.update') => app.act(action, { entryId: id, ...patch }, { optimistic: patchEntry(id, patch) }).catch(() => {});
  const entry = entries.find(e => e.id === open);
  if (research.active) return <Research app={app} phase={research.phase} keep={research.keep} results={research.results} gsc={research.gsc} />;
  if (!entries.length) return <div className="page">
    <PageHead title="Content Calendar" sub="A month of articles researched from your Business Profile, existing content, and search data." />
    <div className="col enter" style={{ alignItems: 'flex-start', gap: 20, padding: '48px 0', borderTop: '1px solid var(--line)' }}>
      <Btn kind="primary" size="lg" icon="calendar" onClick={() => setSetup(true)} style={{ height: 56, padding: '0 26px', fontSize: 16 }}>Generate 30-day content calendar</Btn>
      <span className="small sub">{cal.settings.market} · {cal.settings.language} · starts {fmtD(cal.settings.start)} · {cadenceLabel(cal.settings)} · <a href="#" onClick={e => { e.preventDefault(); setSetup(true); }}>Change</a></span>
    </div>
    <CalSetup open={setup} onClose={() => setSetup(false)} app={app} onGenerate={generate} />
  </div>;
  const counts = { proposed: entries.filter(e => e.status === 'proposed').length, approved: entries.filter(e => e.status !== 'proposed').length };
  const range = `${fmtD(entries[0].date)} – ${fmtD(entries[entries.length - 1].date)}`;
  const approveAll = () => {
    const n = counts.proposed;
    app.act('calendar.approveAll', {}, { optimistic: b => withEntries(b, es => es.map(e => (e.status === 'proposed' ? { ...e, status: 'approved' } : e))) }).catch(() => {});
    toast(`${n} topics scheduled. Radar drafts each one the day before it publishes.`, { tone: 'ok' });
  };
  const move = (id: string, date: string) => {
    const me = entries.find(e => e.id === id); if (!me || me.date === date) return;
    const others = entries.filter(e => e.date === date && e.id !== id && !LOCKED.includes(e.status) && e.status !== 'publishing');
    app.act('calendar.move', { entryId: id, date }, { optimistic: b => withEntries(b, es => es.map(e => (e.id === id ? { ...e, date } : others.some(o => o.id === e.id) ? { ...e, date: me.date } : e))) }).catch(() => {});
    toast(`Moved to ${fmtDW(date)}`);
  };
  return <div className="page" style={{ maxWidth: 1180 }}>
    <PageHead title="Content Calendar" sub={<span>{range} · {entries.length} articles · {cadenceLabel(cal.settings)}</span>}>
      <Seg value={view} onChange={setView} options={[{ v: 'calendar', l: 'Calendar' }, { v: 'list', l: 'List' }]} />
      <Btn icon="refresh" onClick={() => setRegen(true)}>Regenerate</Btn>
      {counts.proposed > 0 && <Btn kind="primary" icon="check" title="Radar drafts each one the day before it publishes" onClick={approveAll}>Approve all {counts.proposed}</Btn>}
    </PageHead>
    <PublishLine app={app} />
    {view === 'calendar' ? <MonthGrid entries={entries} today={B.today} onOpen={setOpen} onMove={move} />
      : <CalList entries={entries} filter={filter} setFilter={setFilter} onOpen={setOpen} />}
    <EntrySheet app={app} entry={entry} onClose={() => setOpen(null)} upd={upd} />
    <Modal open={regen} onClose={() => setRegen(false)} width={480}><div className="col" style={{ padding: 30, gap: 16 }}>
      <h2 className="h2">Regenerate proposed topics?</h2>
      <p className="sub">Radar will research fresh topics for the {counts.proposed} proposed slots. <span style={{ color: 'var(--ink)' }}>{counts.approved} approved and in-progress articles stay exactly where they are.</span></p>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}><Btn kind="ghost" onClick={() => setRegen(false)}>Cancel</Btn><Btn kind="primary" icon="refresh" onClick={() => generate(cal.settings, true)}>Regenerate {counts.proposed}</Btn></div>
    </div></Modal>
  </div>;
}

function researchPhases(B: Workspace, results: string[], gscFlag?: boolean): [string, string][] {
  const g = gscFlag ?? ['connected', 'syncing', 'error'].includes(B.gsc.status);
  const labels = ['Reading your Business Profile', 'Starting from your target keywords', 'Reviewing existing content', g ? 'Pulling Search Console queries' : 'Search Console not connected', 'Researching keywords', 'Clustering and checking competition', 'Scheduling articles'];
  return labels.map((l, i) => [l, results[i] || '']);
}
function Research({ app, phase, keep, results, gsc }: { app: AppCtx; phase: number; keep: boolean; results: string[]; gsc?: boolean }) {
  const ph = researchPhases(app.B!, results, gsc); const [bl, setBl] = useState<Blip[]>([]);
  useEffect(() => { const a = Math.random() * 6.28, r = .2 + Math.random() * .5; setBl(b => [...b, { x: Math.cos(a) * r, y: Math.sin(a) * r, at: performance.now() }]); }, [phase]);
  return <div className="page">
    <div className="card" style={{ overflow: 'hidden' }}>
      <RadarField theme="paper" energy={.9} blips={bl} center={[.5, .5]} scale={1.3} dens={34} style={{ height: 240 }} />
      <div className="col" style={{ padding: '28px 32px 30px', gap: 4 }}>
        <span className="eyebrow">{keep ? 'Refreshing proposed topics' : 'Building your calendar'}</span>
        <h2 className="h1" style={{ marginBottom: 18 }}>Researching what your customers search for.</h2>
        {ph.map(([l, f], i) => <div key={i} className="row" style={{ height: 46, borderTop: '1px solid var(--line2)', opacity: i > phase ? .35 : 1, transition: 'opacity .4s' }}>
          <span style={{ width: 20 }}>{i < phase ? <Icon n="check" s={15} w={2} style={{ color: 'var(--ok)' }} /> : i === phase ? <span className="spin" style={{ color: 'var(--signal)' }} /> : <i className="dot" style={{ background: 'var(--line)' }} />}</span>
          <span className="grow" style={{ fontWeight: i === phase ? 500 : 400 }}>{l}</span>{i < phase && f && <span className="small sub enter">{f}</span>}
        </div>)}
      </div>
    </div>
  </div>;
}

function CalSetup({ open, onClose, app, onGenerate }: { open: boolean; onClose: () => void; app: AppCtx; onGenerate: (s: CalendarSettings) => void }) {
  const B = app.B!; const [s, setS] = useState<CalendarSettings>(B.calendar.settings);
  useEffect(() => { if (open) setS(B.calendar.settings); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const g = B.gsc.status; const LANGS = useMemo(() => langs(), []);
  const markets = MARKETS.includes(s.market) ? MARKETS : [s.market, ...MARKETS];
  const languages = LANGS.includes(s.language) ? LANGS : [s.language, ...LANGS];
  return <Modal open={open} onClose={onClose} width={600}><div className="col" style={{ padding: '32px 32px 26px', gap: 24 }}>
    <div className="col" style={{ gap: 6 }}><h2 className="h1" style={{ fontSize: 24 }}>Generate 30-day content calendar</h2><p className="sub">Using your saved defaults. Change anything for this calendar.</p></div>
    <div className="grid-2"><Field label="Market"><select className="input" value={s.market} onChange={e => setS({ ...s, market: e.target.value })}>{markets.map(m => <option key={m}>{m}</option>)}</select></Field><Field label="Language" hint={LANGS.length + ' languages'}><select className="input" value={s.language} onChange={e => setS({ ...s, language: e.target.value })}>{languages.map(m => <option key={m}>{m}</option>)}</select></Field></div>
    <div className="grid-2"><Field label="Start date"><input type="date" className="input" value={s.start} onChange={e => setS({ ...s, start: e.target.value })} /></Field>
      <Field label="Frequency"><div className="col" style={{ gap: 10 }}><Seg value={s.cadence} onChange={v => setS({ ...s, cadence: v })} options={[{ v: 'daily', l: 'Daily' }, { v: 'weekdays', l: 'Weekdays' }, { v: 'custom', l: 'Custom' }]} />
        {s.cadence === 'custom' && <div className="row enter" style={{ gap: 10 }}><Btn size="sm" kind="secondary" onClick={() => setS({ ...s, perWeek: Math.max(1, s.perWeek - 1) })} aria-label="Fewer">−</Btn><span className="num" style={{ minWidth: 90, textAlign: 'center' }}>{s.perWeek} per week</span><Btn size="sm" kind="secondary" onClick={() => setS({ ...s, perWeek: Math.min(7, s.perWeek + 1) })} aria-label="More">+</Btn></div>}
      </div></Field></div>
    <div className="col" style={{ gap: 8 }}><span className="label">Radar will research from</span>
      <div className="col small" style={{ gap: 6 }}><Status tone="ok">Business Profile</Status><Status tone={kwList(B).length ? 'ok' : 'mute'}>Target keywords · {kwList(B).length}</Status><Status tone={B.site.articles != null ? 'ok' : 'mute'}>{B.site.articles != null ? `Website content · ${B.site.articles} articles` : 'Website content'}</Status>{g === 'connected' || g === 'error' ? <Status tone="ok">Search Console</Status> : g === 'syncing' ? <Status tone="signal" pulse>Search Console · still syncing, partial data</Status> : <Status tone="mute">Search Console not connected · keyword estimates only</Status>}</div></div>
    <div className="row" style={{ justifyContent: 'flex-end', borderTop: '1px solid var(--line2)', paddingTop: 18 }}><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={() => onGenerate(s)}>Generate calendar</Btn></div>
  </div></Modal>;
}

export function PublishLine({ app }: { app: AppCtx }) {
  const B = app.B!; const b = B.blog; const conns = b.conns;
  const conn = conns.find(c => c.id === b.defaultId) || conns[0] || null;
  return <div className="row small" style={{ gap: 14, margin: '-14px 0 22px', flexWrap: 'wrap', color: 'var(--ink2)' }}>
    {!conn ? <span className="sub">Publishing not set up — you’ll connect your blog when you approve your first article.</span>
      : <>{b.paused ? <Status tone="warn">Publishing paused</Status> : <Status tone="ok">{b.mode === 'autopilot' ? 'Autopilot on' : 'Review-first'}</Status>}<span className="sub">{platLabel(conn.type)}{conns.length > 1 ? ` +${conns.length - 1}` : ''} · {fmtTime(b.time)} {tzShort(b.tz)}</span><Btn kind="link" className="small" onClick={() => app.go('settings', { publishing: true })}>Manage</Btn></>}
  </div>;
}

function MonthGrid({ entries, today, onOpen, onMove }: { entries: Entries; today: string; onOpen: (id: string) => void; onMove: (id: string, date: string) => void }) {
  const [over, setOver] = useState<string | null>(null);
  const first = new Date(entries[0].date + 'T12:00'); const startD = addDays(entries[0].date, -((first.getDay() + 6) % 7));
  const last = entries[entries.length - 1].date; const days: string[] = []; let d = startD; while (d <= last || days.length % 7) { days.push(d); d = addDays(d, 1); }
  const by: Record<string, Entries> = {}; entries.forEach(e => { (by[e.date] = by[e.date] || []).push(e); });
  return <div className="cal-grid" style={{ border: '1px solid var(--line)', borderRadius: 18, overflow: 'hidden', background: 'var(--surface)' }}>
    <style>{`.cal-days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}@media(max-width:1180px){.cal-kw{display:none!important}.cal-t{-webkit-line-clamp:3!important;font-size:12px!important}}@media(max-width:760px){.cal-days{grid-template-columns:1fr}.cal-wk{display:none!important}.cal-empty{display:none!important}.cal-cell{min-height:0!important;flex-direction:row!important;align-items:flex-start;gap:12px!important;padding:10px 12px!important;border-right:0!important}.cal-d{width:58px;flex:none;padding:7px 0 0!important;line-height:1.35}.cal-wd{display:block!important}.cal-es{flex:1;min-width:0}.cal-t{-webkit-line-clamp:3!important;font-size:13px!important}}`}</style>
    <div className="cal-days cal-wk" style={{ borderBottom: '1px solid var(--line)' }}>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => <span key={w} className="xs sub" style={{ padding: '10px 12px' }}>{w}</span>)}</div>
    <div className="cal-days">{days.map((day, i) => {
      const es = by[day] || []; const dt = new Date(day + 'T12:00'); const firstOfMonth = dt.getDate() === 1 || i === 0;
      return <div key={day} onDragOver={e => { e.preventDefault(); setOver(day); }} onDragLeave={() => setOver(o => (o === day ? null : o))} onDrop={e => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text'); if (id) onMove(id, day); }}
        className={'cal-cell ' + (over === day ? 'drop-target ' : '') + (es.length ? '' : 'cal-empty')} style={{ minHeight: 118, padding: 8, borderRight: (i % 7 !== 6) ? '1px solid var(--line2)' : 0, borderBottom: '1px solid var(--line2)', display: 'flex', flexDirection: 'column', gap: 6, background: day < today ? 'var(--paper)' : 'transparent' }}>
        <span className="xs num cal-d" style={{ color: day === today ? 'var(--signal-ink)' : 'var(--mute)', fontWeight: day === today ? 600 : 400, padding: '0 4px' }}><span className="cal-wd" style={{ display: 'none' }}>{day === today ? 'Today' : dt.toLocaleDateString('en-US', { weekday: 'short' })}</span>{firstOfMonth ? fmtD(day) : dt.getDate()}<span className="hide-sm">{day === today && ' · Today'}</span></span>
        <div className="cal-es col" style={{ gap: 6 }}>{es.map(e => <button key={e.id} draggable={!['published', 'scheduled', 'publishing'].includes(e.status)} onDragStart={ev => { ev.dataTransfer.setData('text', e.id); ev.dataTransfer.effectAllowed = 'move'; }} onClick={() => onOpen(e.id)} className="tap enter" style={{ textAlign: 'left', border: 0, background: e.status === 'proposed' ? 'transparent' : 'var(--fill)', boxShadow: e.status === 'proposed' ? 'inset 0 0 0 1px var(--line)' : 'none', borderRadius: 9, padding: '7px 8px', display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer', animationDelay: (i % 30) * 12 + 'ms' }}>
          <span className="small cal-t" style={{ lineHeight: 1.3, fontWeight: 500, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{e.title}</span>
          <span className="row cal-kw" style={{ gap: 6 }}><i className="dot" style={{ background: DOT_COLOR[e.status], width: 6, height: 6 }} /><span className="xs sub trunc">{e.mode === 'refresh' ? 'Refresh · ' : ''}{e.kw}</span></span>
        </button>)}</div>
      </div>;
    })}</div>
  </div>;
}

function CalList({ entries, filter, setFilter, onOpen }: { entries: Entries; filter: string; setFilter: (v: string) => void; onOpen: (id: string) => void }) {
  const fl = entries.filter(e => filter === 'all' || (filter === 'proposed' ? e.status === 'proposed' : filter === 'review' ? e.status === 'review' : ['approved', 'scheduled', 'published', 'draft'].includes(e.status)));
  return <div>
    <div className="row" style={{ marginBottom: 12 }}><Seg wrap value={filter} onChange={setFilter} options={[{ v: 'all', l: 'All' }, { v: 'proposed', l: 'Proposed' }, { v: 'review', l: 'Ready for review' }, { v: 'approved', l: 'Approved' }]} /></div>
    <style>{`@media(max-width:640px){.cl-row{flex-wrap:wrap;gap:6px 12px!important;padding:14px 4px!important}.cl-date{width:auto!important}.cl-st{width:auto!important;margin-left:auto}.cl-main{order:3;flex-basis:100%!important}.cl-main .cl-t{white-space:normal}}`}</style>
    <div style={{ borderTop: '1px solid var(--line)' }}>{fl.map(e => <div key={e.id} className="row tap cl-row" onClick={() => onOpen(e.id)} style={{ padding: '14px 10px', borderBottom: '1px solid var(--line2)', gap: 18, cursor: 'pointer' }}>
      <span className="mono sub cl-date" style={{ width: 84, flex: 'none' }}>{fmtDW(e.date)}</span>
      <span className="col grow cl-main" style={{ minWidth: 0 }}><span className="trunc cl-t" style={{ fontWeight: 500 }}>{e.title}</span><span className="xs sub trunc">{e.kw}</span></span>
      <span className="small sub hide-sm" style={{ width: 110 }}>{e.mode === 'refresh' ? 'Refresh' : e.type}</span>
      <span className="cl-st" style={{ width: 140 }}><EntryStatus s={e.status} /></span>
    </div>)}{!fl.length && <p className="sub small" style={{ padding: 20 }}>Nothing here.</p>}</div>
  </div>;
}

interface Alt { id: string; title: string; kw: string; type: EntryType; vol: number | null; kd: number | null; mode: 'new' | 'refresh'; url: string | null; measured: CalendarEntry['measured']; audience: string; relevance: string; outline: string[] }
function EntrySheet({ app, entry, onClose, upd }: { app: AppCtx; entry: CalendarEntry | undefined; onClose: () => void; upd: (id: string, patch: Partial<CalendarEntry>, action?: string) => void }) {
  const { go, toast } = app; const B = app.B!;
  const [alts, setAlts] = useState<Alt[] | null>(null); const [altBusy, setAltBusy] = useState(false); const [title, setTitle] = useState(entry?.title || '');
  useEffect(() => { setAlts(null); setTitle(entry?.title || ''); }, [entry?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!entry) return null; const e = entry; const g = B.gsc.status; const locked = LOCKED.includes(e.status) || e.status === 'publishing';
  const m = e.measured || (B.measured[e.kw] ? { impr: B.measured[e.kw]!.impr, clicks: B.measured[e.kw]!.clicks, pos: Math.round(B.measured[e.kw]!.pos * 10) / 10 } : null);
  const loadAlts = async () => { setAltBusy(true); try { setAlts(await app.act<Alt[]>('calendar.alternatives', { entryId: e.id })); } catch { /* toasted */ } finally { setAltBusy(false); } };
  const toAlt = (x: CalendarEntry | Alt, outline: string[]) => ({ title: x.title, kw: x.kw, type: x.type, vol: x.vol, kd: x.kd, mode: x.mode, url: x.url, measured: x.measured, audience: x.audience, relevance: x.relevance, outline });
  const replace = (a: Alt) => {
    const prev = toAlt(e, B.articles[e.id]?.brief.outline || []);
    const apply = (x: ReturnType<typeof toAlt>) => app.act('calendar.replace', { entryId: e.id, alt: x }, { optimistic: patchEntry(e.id, { ...x }) }).catch(() => {});
    apply(toAlt(a, a.outline)); onClose();
    toast('Topic replaced', { action: { label: 'Undo', fn: () => apply(prev) } });
  };
  const fmtPos = (p: number) => (Math.round(p * 10) / 10).toString();
  return <Sheet open onClose={onClose} width={540} eyebrow={fmtDW(e.date) + ' · ' + (e.mode === 'refresh' ? 'Refresh' : e.type)} footer={<>
    {e.status === 'proposed' && <Btn kind="ghost" icon="refresh" loading={altBusy} onClick={loadAlts}>Replace topic</Btn>}
    <span className="grow" />
    {e.status === 'proposed' ? <Btn kind="primary" icon="check" onClick={() => { upd(e.id, { status: 'approved' }, 'calendar.approve'); toast('Scheduled. Radar drafts it ' + fmtDW(addDays(e.date, -1)) + '.', { tone: 'ok' }); }}>Approve &amp; schedule</Btn>
      : e.status === 'approved' ? <><Btn kind="ghost" onClick={() => upd(e.id, { status: 'proposed' }, 'calendar.unschedule')}>Unschedule</Btn><span className="col" style={{ alignItems: 'flex-end', gap: 2, flex: 'none' }}><Status tone="ink">Scheduled</Status><span className="xs sub" style={{ whiteSpace: 'nowrap' }}>Draft ready {fmtDW(addDays(e.date, -1))} · <a href="#" onClick={ev => { ev.preventDefault(); upd(e.id, { status: 'drafting' }, 'article.draft'); }}>Draft now</a></span></span></>
        : e.status === 'drafting' ? <Status tone="signal" pulse>Radar is drafting…</Status>
          : <Btn kind="primary" iconR="arrow" onClick={() => go('article', e.id)}>Open article</Btn>}
  </>}>
    <div className="col" style={{ gap: 26 }}>
      <div className="col" style={{ gap: 10 }}>
        <textarea className="input-bare" rows={Math.min(3, Math.ceil(title.length / 38)) || 1} style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.25, resize: 'none' }} value={title} onChange={ev => { const v = ev.target.value; setTitle(v); if (v.trim()) app.actLater('title:' + e.id, 'calendar.update', { entryId: e.id, title: v }, { optimistic: patchEntry(e.id, { title: v }) }); }} aria-label="Title" readOnly={locked} />
        <div className="row" style={{ gap: '6px 14px', flexWrap: 'wrap' }}><EntryStatus s={e.status} /><span className="small sub">Keyword · <span style={{ color: 'var(--ink)' }}>{e.kw}</span></span></div>
        <KwMembership app={app} kw={e.kw} />
      </div>
      {alts && <div className="col enter" style={{ gap: 8 }}><span className="label">Pick a replacement</span>{alts.map(a => <button key={a.id} className="card tap row" style={{ padding: '12px 14px', textAlign: 'left', cursor: 'pointer', borderRadius: 12 }} onClick={() => replace(a)}><span className="col grow"><span style={{ fontWeight: 500 }}>{a.title}</span><span className="xs sub">{a.kw}{a.vol != null ? ` · ~${fmtN(a.vol)}/mo` : ''}</span></span><Icon n="arrow" s={15} /></button>)}<Btn kind="link" className="small" onClick={() => setAlts(null)}>Keep current topic</Btn></div>}
      <div className="col" style={{ gap: 6 }}><span className="label">Recommendation</span>{e.mode === 'refresh' ? <p><span style={{ fontWeight: 500 }}>Refresh an existing page</span> · <span className="mono">{e.url}</span></p> : <p style={{ fontWeight: 500 }}>Write a new article</p>}<p className="sub small">{e.relevance}</p></div>
      <div className="col" style={{ gap: 6 }}><span className="label">Audience</span><p className="small">{e.audience}</p></div>
      <div className="col" style={{ gap: 12 }}>
        <div className="row"><span className="label grow">Keyword estimates</span></div>
        <div className="row" style={{ gap: 36 }}><Metric l="Monthly searches" v={e.vol != null ? '~' + fmtN(e.vol) : '—'} /><Metric l="Difficulty" v={e.kd != null ? e.kd + '/100' : '—'} /></div>
        <span className="xs sub">Estimated from third-party keyword data for {B.calendar.settings.market}. Not measured from your site.</span>
      </div>
      <div className="col" style={{ gap: 12, paddingTop: 18, borderTop: '1px solid var(--line2)' }}>
        <span className="label">Measured in Search Console · last 28 days</span>
        {g !== 'connected' && g !== 'error' ? <p className="small sub">{g === 'syncing' ? 'Still syncing. Measured data appears here when it’s ready.' : <span>Not connected, so nothing is measured yet. <a href="#" onClick={ev => { ev.preventDefault(); go('settings', { gsc: true }); }}>Connect Search Console</a></span>}</p>
          : m ? <div className="row" style={{ gap: 36, flexWrap: 'wrap' }}><Metric l="Impressions" v={fmtN(m.impr)} /><Metric l="Clicks" v={fmtN(m.clicks)} /><Metric l="Avg. position" v={fmtPos(m.pos)} /></div>
            : <p className="small sub">No impressions measured — you don’t have a page for this keyword yet.</p>}
      </div>
      <div className="grid-2" style={{ gap: 14 }}>
        <Field label="Publish date"><input type="date" className="input" value={e.date} disabled={locked} onChange={ev => { const v = ev.target.value; if (!v) return; upd(e.id, { date: v }); toast('Rescheduled to ' + fmtDW(v)); }} /></Field>
        <Field label="Content type"><select className="input" value={e.type} disabled={locked} onChange={ev => upd(e.id, { type: ev.target.value as EntryType })}>{ENTRY_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
      </div>
    </div>
  </Sheet>;
}

export function KwMembership({ app, kw }: { app: AppCtx; kw: string }) {
  const { toast } = app; const kl = kwList(app.B!);
  const hit = kl.find(k => k.kw === kw || kw.includes(k.kw) || k.kw.includes(kw));
  if (hit) return <span className="row xs" style={{ gap: 7, color: 'var(--ink2)' }}><i className="dot" style={{ background: hit.priority ? 'var(--signal)' : 'var(--ok)' }} /><span>{`Targets “${hit.kw}”${hit.priority ? ' (priority)' : ''} from your keyword list`}</span></span>;
  return <span className="row xs sub" style={{ gap: 7 }}><i className="dot" style={{ background: 'var(--line)' }} /><span>Not on your keyword list · <Btn kind="link" className="xs" style={{ fontSize: 12, display: 'inline' }} onClick={() => {
    app.act('calendar.addKeyword', { kw }, { optimistic: b => ({ ...b, profile: { ...b.profile, keywords: { list: [...(b.profile.keywords?.list || []), { kw, intent: 'Informational', vol: null, kd: null, src: 'user', priority: false }] } } }) }).catch(() => {});
    toast('Added “' + kw + '” to your keywords');
  }}>Add it</Btn></span></span>;
}
