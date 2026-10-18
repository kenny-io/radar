'use client';
// Primitives — a faithful port of prototype/radar-ui.jsx. Do not restyle.
import React, { useState, useEffect, useRef, useCallback, createContext, useContext, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { STATUS_MAP } from '@/lib/constants';
import { HEX_RE } from '@/lib/format';
import type { Brand, EntryStatus } from '@/lib/types';

export const IC = { brief: 'M21 12a9 9 0 1 1-9-9M16.5 12a4.5 4.5 0 1 1-4.5-4.5M12 12l6.5-6.5', home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4', social: 'M4 10v4h3l7 4V6L7 10H4zM18 9a4 4 0 0 1 0 6', chart: 'M4 20V4M4 20h16M8 15l4-5 3 3 5-6', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1', gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1', profile: 'M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16M9 21v-4h6v4M8 7h2M14 7h2M8 11h2M14 11h2', chevD: 'M6 9l6 6 6-6', chevR: 'M9 6l6 6-6 6', chevL: 'M15 6l-6 6 6 6', chevUD: 'M8 9l4-4 4 4M8 15l4 4 4-4', plus: 'M12 5v14M5 12h14', check: 'M5 12.5l4.5 4.5L19 7', x: 'M6 6l12 12M18 6 6 18', copy: 'M9 9h11v11H9zM5 15H4V4h11v1', download: 'M12 4v11M7 10l5 5 5-5M5 20h14', upload: 'M12 16V5M7 10l5-5 5 5M5 20h14', refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4', search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4', arrow: 'M5 12h14M13 6l6 6-6 6', ext: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6', pause: 'M8 5v14M16 5v14', play: 'M7 5l12 7-12 7z', list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01', grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01', alert: 'M12 9v4M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4', globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2', dots: 'M5 12h.01M12 12h.01M19 12h.01', menu: 'M4 7h16M4 12h16M4 17h16', doc: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5', lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4', wand: 'M15 4V2M15 10V8M11 6h2M17 6h2M4 20 14 10', back: 'M19 12H5M11 6l-6 6 6 6', undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', send: 'M4 12 20 4l-6 16-3-7z' } as const;
export type IconName = keyof typeof IC;

export function Icon({ n, s = 18, w = 1.6, style }: { n: IconName; s?: number; w?: number; style?: React.CSSProperties }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', ...style }} aria-hidden="true"><path d={IC[n]} /></svg>;
}
export function Mark({ s = 22, night }: { s?: number; night?: boolean }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" aria-label="Radar"><circle cx="12" cy="12" r="10" fill="none" stroke={night ? '#fff' : 'currentColor'} strokeWidth="1.8" /><path d="M12 12 L12 2 A10 10 0 0 1 20.66 7 Z" fill="var(--signal)" /><circle cx="12" cy="12" r="2.2" fill={night ? '#fff' : 'currentColor'} /></svg>;
}

type BtnProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { kind?: 'primary' | 'secondary' | 'ghost' | 'link' | 'danger'; size?: 'sm' | 'lg' | null; icon?: IconName; iconR?: IconName | null; loading?: boolean; children?: React.ReactNode };
export function Btn({ kind = 'secondary', size, icon, iconR, children, loading, disabled, className = '', type = 'button', ...p }: BtnProps) {
  return <button type={type} className={`btn btn-${kind} ${size ? 'btn-' + size : ''} ${children == null || children === false ? 'btn-icon' : ''} ${className}`} disabled={disabled || loading} {...p}>
    {loading ? <span className="spin" /> : icon && <Icon n={icon} s={16} />}{children != null && children !== false && <span>{children}</span>}{iconR && !loading && <Icon n={iconR} s={16} />}
  </button>;
}

export const TONE: Record<string, string> = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', signal: 'var(--signal)', mute: 'var(--faint)', ink: 'var(--ink)' };
export type Tone = 'ok' | 'warn' | 'bad' | 'signal' | 'mute' | 'ink';
/** Status: 7px dot + plain colored text. Never a pill background. */
export function Status({ tone = 'mute', children, pulse, style }: { tone?: Tone | string; children?: React.ReactNode; pulse?: boolean; style?: React.CSSProperties }) {
  return <span className="status" style={{ color: tone === 'mute' ? 'var(--mute)' : tone === 'signal' ? 'var(--signal-ink)' : tone === 'ink' ? 'var(--ink)' : TONE[tone], ...style }}><i className={'dot' + (pulse ? ' pulse' : '')} style={{ background: TONE[tone] }} />{children}</span>;
}
export function EntryStatus({ s }: { s: EntryStatus }) {
  const [t, l] = STATUS_MAP[s] || STATUS_MAP.proposed;
  return <Status tone={t} pulse={s === 'publishing'}>{l}</Status>;
}
export function Inferred({ edited }: { edited?: boolean }) {
  return edited ? <span className="edited"><i />Edited</span> : <span className="inf" title="Radar inferred this from your website"><i />Inferred</span>;
}
export function Field({ label, hint, mark, children, style }: { label?: React.ReactNode; hint?: React.ReactNode; mark?: React.ReactNode; children?: React.ReactNode; style?: React.CSSProperties }) {
  return <label className="field" style={style} onClick={e => { if ((e.target as HTMLElement).tagName === 'LABEL') e.preventDefault(); }}>
    <span className="field-head"><span className="label">{label}</span>{mark}</span>{children}{hint && <span className="xs sub">{hint}</span>}
  </label>;
}
export function Seg<T extends string | number>({ value, options, onChange, style }: { value: T; options: (T | { v: T; l: React.ReactNode })[]; onChange: (v: T) => void; style?: React.CSSProperties }) {
  return <div className="seg" role="tablist" style={style}>{options.map(o => {
    const v = (typeof o === 'object' ? (o as any).v : o) as T; const l = typeof o === 'object' ? (o as any).l : o;
    return <button type="button" key={String(v)} role="tab" aria-selected={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>;
  })}</div>;
}
export function Tabs<T extends string>({ value, items, onChange, style }: { value: T; items: { v: T; l: React.ReactNode; ct?: number | null }[]; onChange: (v: T) => void; style?: React.CSSProperties }) {
  return <div className="tabs" style={style}>{items.map(i => <button type="button" key={i.v} className={value === i.v ? 'on' : ''} onClick={() => onChange(i.v)}>{i.l}{i.ct != null && <span className="sub" style={{ marginLeft: 6, fontWeight: 400 }}>{i.ct}</span>}</button>)}</div>;
}
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={'toggle' + (on ? ' on' : '')} onClick={() => onChange(!on)} />;
}
export function Skel({ w = '100%', h = 14, style }: { w?: number | string; h?: number; style?: React.CSSProperties }) {
  return <div className="skel" style={{ width: w, height: h, ...style }} />;
}

function useMounted() { const [m, setM] = useState(false); useEffect(() => setM(true), []); return m; }

export function Modal({ open, onClose, width = 720, children, dismissable = true, label }: { open: boolean; onClose?: (() => void) | null; width?: number; children?: React.ReactNode; dismissable?: boolean; label?: string }) {
  const mounted = useMounted();
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && dismissable) onClose && onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [open, dismissable, onClose]);
  if (!open || !mounted) return null;
  return createPortal(<div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget && dismissable) onClose && onClose(); }}><div className="modal" role="dialog" aria-modal="true" aria-label={label} style={{ maxWidth: width }}>{children}</div></div>, document.body);
}
export function Sheet({ open, onClose, width = 520, title, eyebrow, children, footer }: { open: boolean; onClose: () => void; width?: number; title?: React.ReactNode; eyebrow?: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode }) {
  const mounted = useMounted();
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open || !mounted) return null;
  return createPortal(<><div className="sheet-wrap" onClick={onClose} /><aside className="sheet" role="dialog" style={{ width }}>
    <div className="row" style={{ padding: '20px 22px 0', alignItems: 'flex-start' }}><div className="grow col" style={{ gap: 6 }}>{eyebrow && <span className="eyebrow">{eyebrow}</span>}{title && <h2 className="h2">{title}</h2>}</div><Btn kind="ghost" icon="x" onClick={onClose} aria-label="Close" /></div>
    <div className="grow scroll-y" style={{ padding: '18px 22px 24px' }}>{children}</div>
    {footer && <div className="row" style={{ padding: '14px 22px', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>{footer}</div>}
  </aside></>, document.body);
}

/* ── Toasts ── */
export interface ToastOpts { tone?: Tone | null; action?: { label: string; fn: () => void } | null; ms?: number }
type ToastFn = (msg: React.ReactNode, opt?: ToastOpts) => void;
const ToastCtx = createContext<ToastFn>(() => {});
export function ToastHost({ children }: { children?: React.ReactNode }) {
  const [list, setList] = useState<({ id: number; msg: React.ReactNode } & ToastOpts)[]>([]);
  const mounted = useMounted();
  const push = useCallback<ToastFn>((msg, opt = {}) => {
    const id = Math.random();
    setList(l => [...l.slice(-2), { id, msg, ...opt }]);
    setTimeout(() => setList(l => l.filter(t => t.id !== id)), opt.ms || 4200);
  }, []);
  return <ToastCtx.Provider value={push}>{children}{mounted && createPortal(<div className="toast-wrap" role="status">{list.map(t => <div key={t.id} className="toast">{t.tone && <i className="dot" style={{ background: TONE[t.tone] }} />}<span>{t.msg}</span>{t.action && <button type="button" onClick={() => { t.action!.fn(); setList(l => l.filter(x => x.id !== t.id)); }}>{t.action.label}</button>}</div>)}</div>, document.body)}</ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

export function Popover({ anchor, open, onClose, children, align = 'left', style }: { anchor: React.RefObject<HTMLElement | null>; open: boolean; onClose: () => void; children?: React.ReactNode; align?: 'left' | 'right'; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(anchor.current && anchor.current.contains(e.target as Node))) onClose(); };
    const t = setTimeout(() => document.addEventListener('mousedown', h));
    return () => { clearTimeout(t); document.removeEventListener('mousedown', h); };
  }, [open, anchor, onClose]);
  if (!open) return null;
  return <div ref={ref} className="pop" style={{ [align]: 0, top: 'calc(100% + 6px)', ...style }}>{children}</div>;
}

export function ListEditor({ items, onChange, placeholder = 'Add item', onEdit }: { items: string[]; onChange: (a: string[]) => void; placeholder?: string; onEdit?: () => void }) {
  const [draft, setDraft] = useState('');
  const set = (a: string[]) => { onChange(a); onEdit && onEdit(); };
  return <div className="col" style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface)' }}>
    {items.map((it, i) => <div key={i} className="row" style={{ padding: '0 6px 0 13px', minHeight: 42, borderBottom: '1px solid var(--line2)' }}>
      <input className="input-bare grow" value={it} onChange={e => { const a = [...items]; a[i] = e.target.value; set(a); }} aria-label={placeholder} />
      <Btn kind="ghost" size="sm" icon="x" aria-label="Remove" onClick={() => set(items.filter((_, j) => j !== i))} />
    </div>)}
    <form className="row" style={{ padding: '0 6px 0 13px', minHeight: 42 }} onSubmit={e => { e.preventDefault(); if (draft.trim()) { set([...items, draft.trim()]); setDraft(''); } }}>
      <Icon n="plus" s={15} style={{ color: 'var(--faint)' }} /><input className="input-bare grow" placeholder={placeholder} value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft.trim()) { set([...items, draft.trim()]); setDraft(''); } }} />
    </form>
  </div>;
}

export function ColorField({ label, value, onChange, mark }: { label: string; value: string; onChange: (v: string) => void; mark?: React.ReactNode }) {
  const [txt, setTxt] = useState(value); useEffect(() => setTxt(value), [value]);
  const bad = !HEX_RE.test(txt);
  return <Field label={label} mark={mark}><div className="row" style={{ gap: 10 }}>
    <span style={{ position: 'relative', width: 42, height: 42, borderRadius: 12, background: value, boxShadow: 'inset 0 0 0 1px oklch(0 0 0 / .1)', flex: 'none', overflow: 'hidden' }}><input type="color" value={value} onChange={e => onChange(e.target.value.toUpperCase())} style={{ position: 'absolute', inset: -8, width: 60, height: 60, opacity: 0, cursor: 'pointer' }} aria-label={label + ' picker'} /></span>
    <input className={'input mono' + (bad ? ' err' : '')} style={{ fontSize: 14, textTransform: 'uppercase' }} value={txt} maxLength={7} onChange={e => { let v = e.target.value; if (v && v[0] !== '#') v = '#' + v; setTxt(v); if (HEX_RE.test(v)) onChange(v.toUpperCase()); }} aria-label={label + ' hex'} />
  </div>{bad && <span className="xs" style={{ color: 'var(--bad)' }}>Use a 6-digit hex, like #1F4D3A</span>}</Field>;
}

export function AutoText({ value, style, minRows = 3, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => { const t = ref.current; if (!t) return; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
  useLayoutEffect(fit, [value]);
  useEffect(() => { if (!ref.current) return; const ro = new ResizeObserver(fit); ro.observe(ref.current); return () => ro.disconnect(); }, []);
  return <textarea ref={ref} rows={minRows} value={value} style={{ ...style, resize: 'none', overflow: 'hidden' }} {...p} />;
}

export function Spark({ data, w = 120, h = 32, color = 'var(--ink)', fill }: { data: number[]; w?: number; h?: number; color?: string; fill?: string }) {
  if (!data || data.length < 2) return null;
  const mn = Math.min(...data), mx = Math.max(...data);
  const pts = data.map((v, i) => [i / (data.length - 1) * w, h - 2 - (v - mn) / (mx - mn || 1) * (h - 4)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible', maxWidth: w }}>{fill && <path d={d + ` L${w} ${h} L0 ${h}Z`} fill={fill} />}<path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></svg>;
}
export function Empty({ title, body, children, icon, style }: { title: React.ReactNode; body?: React.ReactNode; children?: React.ReactNode; icon?: IconName; style?: React.CSSProperties }) {
  return <div className="col" style={{ alignItems: 'center', textAlign: 'center', padding: '56px 24px', gap: 10, ...style }}>{icon && <span style={{ color: 'var(--faint)', marginBottom: 6 }}><Icon n={icon} s={26} w={1.4} /></span>}<h3 className="h2">{title}</h3>{body && <p className="sub" style={{ maxWidth: 420 }}>{body}</p>}{children && <div className="row" style={{ marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>{children}</div>}</div>;
}
export function PageHead({ title, sub, children, eyebrow }: { title: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return <header className="row" style={{ alignItems: 'flex-end', gap: 20, marginBottom: 32, flexWrap: 'wrap' }}><div className="grow col" style={{ gap: 8, minWidth: 240 }}>{eyebrow}<h1 className="h1">{title}</h1>{sub && <p className="sub" style={{ maxWidth: 620 }}>{sub}</p>}</div>{children && <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>{children}</div>}</header>;
}
export function Section({ title, action, children, style, sub }: { title: React.ReactNode; action?: React.ReactNode; children?: React.ReactNode; style?: React.CSSProperties; sub?: React.ReactNode }) {
  return <section style={{ marginTop: 44, ...style }}><div className="row" style={{ marginBottom: 12, alignItems: 'baseline' }}><h2 className="h3 grow">{title}{sub && <span className="sub" style={{ fontWeight: 400, marginLeft: 10, fontSize: 13 }}>{sub}</span>}</h2>{action}</div>{children}</section>;
}
export function Metric({ l, v, d }: { l: React.ReactNode; v: React.ReactNode; d?: number | null }) {
  return <div className="col" style={{ gap: 2 }}><span className="xs sub" style={{ whiteSpace: 'nowrap' }}>{l}</span><span className="row" style={{ gap: 8, alignItems: 'baseline' }}><span style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.03em' }} className="num">{v}</span>{d != null && <span className="small num" style={{ color: d >= 0 ? 'var(--ok)' : 'var(--bad)' }}>{d >= 0 ? '+' : ''}{d}%</span>}</span></div>;
}

export function LogoTile({ brand, s = 44 }: { brand: Pick<Brand, 'logo' | 'primary' | 'secondary'>; s?: number }) {
  if (brand.logo && brand.logo !== 'detected') return <img src={brand.logo} alt="Logo" style={{ width: s, height: s, borderRadius: s * .27, objectFit: 'contain', background: '#fff', boxShadow: 'inset 0 0 0 1px var(--line)', flex: 'none' }} />;
  if (brand.logo === 'detected') return <span style={{ width: s, height: s, borderRadius: s * .27, background: brand.primary, display: 'grid', placeItems: 'center', flex: 'none' }}><svg width={s * .5} height={s * .5} viewBox="0 0 24 24"><path d="M5 4h12M5 4v16M5 12h9" stroke={brand.secondary} strokeWidth="3" fill="none" strokeLinecap="round" /></svg></span>;
  return <span style={{ width: s, height: s, borderRadius: s * .27, background: 'var(--fill)', display: 'grid', placeItems: 'center', color: 'var(--faint)', flex: 'none' }}><Icon n="image" s={s * .42} /></span>;
}

/* ── browser helpers ── */
export function copyText(t: string) {
  try { navigator.clipboard.writeText(t); } catch { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); }
}
export function downloadBlob(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1500);
}
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export function usePrefersReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => { const m = matchMedia('(prefers-reduced-motion: reduce)'); setR(m.matches); const h = () => setR(m.matches); m.addEventListener('change', h); return () => m.removeEventListener('change', h); }, []);
  return r;
}
