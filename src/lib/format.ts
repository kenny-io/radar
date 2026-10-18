// Formatters — ported verbatim from prototype/radar-ui.jsx (02-system.md §15)
export const fmtN = (n: number | null | undefined): string =>
  n == null ? '—' : n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'k' : n.toLocaleString('en-US');

export const fmtD = (s: string | null | undefined, o: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string =>
  s ? new Date(s.slice(0, 10) + 'T12:00').toLocaleDateString('en-US', o) : '—';

export const fmtDW = (s: string | null | undefined) => fmtD(s, { weekday: 'short', month: 'short', day: 'numeric' });

export const fmtTime = (t: string | null | undefined): string => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM');
};

/** "3h ago" / "20m ago" for Brief threads */
export const ageL = (hours: number): string => (hours < 1 ? Math.max(1, Math.round(hours * 60)) + 'm ago' : Math.round(hours) + 'h ago');
export const ageFromIso = (iso?: string | null, now = Date.now()): number | null => (iso ? Math.max(0, (now - new Date(iso).getTime()) / 3600000) : null);

export function ago(ts: number | null | undefined): string {
  if (!ts) return '';
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : Math.round(m / 60) + 'h ago';
}

export const pct = (x: number) => (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%';
export const lcf = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);
export const listL = (a: string[]) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

/** ISO date helpers (YYYY-MM-DD, calendar dates, no timezone drift) */
export const iso = (d: Date | string | number): string => {
  const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
};
export const addDays = (d: string, n: number): string => {
  const x = new Date(d.slice(0, 10) + 'T12:00');
  x.setDate(x.getDate() + n);
  return iso(x);
};
export const weekday = (d: string) => new Date(d.slice(0, 10) + 'T12:00').getDay(); // 0=Sun

/** "today" in a given IANA timezone */
export function todayIn(tz: string, at: Date = new Date()): string {
  try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
    return p; // en-CA formats as YYYY-MM-DD
  } catch { return iso(at); }
}
/** "HH:MM" now in a timezone */
export function nowHMIn(tz: string, at: Date = new Date()): string {
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
    return p;
  } catch { return String(at.getHours()).padStart(2, '0') + ':' + String(at.getMinutes()).padStart(2, '0'); }
}

export function shortHead(s: string, max = 64): string {
  s = s.replace(/^https?:\/\/[^/]+\/?/, '').replace(/[-_/]+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 2).replace(/\s\S*$/, '') + '…' : s.charAt(0).toUpperCase() + s.slice(1);
}

export const cleanDomain = (v: string) => v.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase();
export const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const HEX_RE = /^#([0-9a-f]{6})$/i;
export const slugify = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '');
