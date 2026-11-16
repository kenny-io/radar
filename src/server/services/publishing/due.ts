// When a calendar entry is due to publish. Pure, so the publishing scheduler and the restore of a deleted business
// (src/server/deletion) apply one rule.
import { addDays, nowHMIn, todayIn } from '@/lib/format';

export interface PublishClock { tz?: string | null; /** blog.time, HH:MM in the business time zone */ time?: string | null }

/** An entry dated `date` is due once its day has come and the blog's publish time has passed, in the business time zone. */
export function entryDue(date: string, clock: PublishClock, now: Date): boolean {
  const tz = clock.tz || 'America/New_York';
  const today = todayIn(tz, now);
  return date < today || (date === today && nowHMIn(tz, now) >= (clock.time || '09:00'));
}

/** The latest date that is due at `now`: every entry dated on or before it is due, every later one is not. */
export function lastDueDate(clock: PublishClock, now: Date): string {
  const today = todayIn(clock.tz || 'America/New_York', now);
  return entryDue(today, clock, now) ? today : addDays(today, -1);
}
