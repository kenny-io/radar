// Pure policy, shared by worker admission, generation commits and publication boundaries.
import type { AutopilotState, SocialAuto } from '@/lib/types';
import { addDays, nowHMIn, todayIn } from '@/lib/format';
import { localParts } from '@/lib/socialPublish';

export interface AutopilotSettings extends AutopilotState { activationId: string | null; enabledBy: string | null }
type Business = { status?: string; autopilot?: unknown };
const str = (v: unknown): string | null => typeof v === 'string' && v.length ? v : null;
export function autopilotOf(b: Business): AutopilotSettings {
  const a = (b.autopilot && typeof b.autopilot === 'object' ? b.autopilot : {}) as Record<string, unknown>;
  return { enabled: a.enabled === true, activationId: str(a.activationId), enabledBy: str(a.enabledBy), enabledAt: str(a.enabledAt), lastRunAt: str(a.lastRunAt), lastError: str(a.lastError), ...(str(a.summary) ? { summary: str(a.summary)! } : {}) };
}
export function autopilotPublic(b: Business): AutopilotState {
  const { activationId: _id, enabledBy: _by, ...state } = autopilotOf(b); return state;
}
export function authorized(b: Business, activationId: string | null | undefined): boolean {
  const a = autopilotOf(b); return b.status === 'active' && a.enabled && !!activationId && a.activationId === activationId;
}
/** Null provenance belongs to the existing manual/legacy workflows. */
export const publicationAllowed = (b: Business, activationId: string | null | undefined) => !activationId || authorized(b, activationId);
export const effectiveSocial = (a: SocialAuto): SocialAuto => ({ ...a, on: true, post: 'library' });
/** Use the saved local time. Catch up immediately during 08:00–20:00; evenings wait until tomorrow. */
export function socialSlot(tz: string, time: string, now = new Date()): { date: string; time: string } {
  const today = todayIn(tz, now); const hm = nowHMIn(tz, now);
  if (hm < time) return { date: today, time };
  if (hm >= '08:00' && hm < '20:00') return localParts(now.getTime() + 60_000, tz);
  return { date: addDays(today, 1), time };
}
