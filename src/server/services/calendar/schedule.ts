// Calendar scheduling: 30 slots by cadence (02-system.md §6 step 7).
import { addDays, weekday } from '@/lib/format';
import type { CalendarSettings } from '@/lib/types';

/** Publish dates for `count` articles from settings.start. Daily = every day · Weekdays = Mon–Fri · Custom = N per week, spread evenly. */
export function slotDates(s: Pick<CalendarSettings, 'start' | 'cadence' | 'perWeek'>, count = 30): string[] {
  const out: string[] = [];
  if (s.cadence === 'daily') { for (let i = 0; i < count; i++) out.push(addDays(s.start, i)); return out; }
  if (s.cadence === 'weekdays') {
    let d = s.start;
    while (out.length < count) { const w = weekday(d); if (w !== 0 && w !== 6) out.push(d); d = addDays(d, 1); }
    return out;
  }
  const n = Math.min(7, Math.max(1, Math.round(s.perWeek || 3)));
  // Offsets within each 7-day block, evenly spaced: 3/week → days 0, 2, 5.
  const offs = [...new Set(Array.from({ length: n }, (_, i) => Math.round((i * 7) / n)))].sort((a, b) => a - b);
  for (let wk = 0; out.length < count; wk++) for (const o of offs) { if (out.length < count) out.push(addDays(s.start, wk * 7 + o)); }
  return out;
}
