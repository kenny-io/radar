'use client';
// Tells the server a member is using the app: `app.seen` on mount, business switch and route change (idle spend).
// The workspace GET cannot serve as this signal, because open tabs repeat it in the background.
// .factory/first-five-optimizations/architecture.md §2.1.
import { useEffect } from 'react';
import { actCall } from './api';

/** One ping per business per tab at most this often. The server keeps one write an hour of them. */
export const SEEN_EVERY_MS = 10 * 60e3;
/** This tab's last ping per business (module state: one per page load, so per tab). */
const sent = new Map<string, number>();

/** Is a ping for `bid` due at `now`? Saying yes records it. Keyed by business, so a switch pings the new business at once
 *  and switching back inside ten minutes pings nothing. */
export function claimSeen(last: Map<string, number>, bid: string | null, now: number): bid is string {
  if (!bid) return false;
  const at = last.get(bid);
  if (at !== undefined && now - at < SEEN_EVERY_MS) return false;
  last.set(bid, now);
  return true;
}

/** Send the ping when one is due. Uses the plain action call, not `app.act`: a business that has lost access answers 402,
 *  and `app.act` would redirect to the trial page and toast. Every failure is dropped; the next due ping tries again. */
export function sendSeen(bid: string | null, now: number = Date.now(), call: (bid: string, action: string, input: object) => Promise<unknown> = actCall, last: Map<string, number> = sent): void {
  if (!claimSeen(last, bid, now)) return;
  void Promise.resolve().then(() => call(bid, 'app.seen', {})).catch(() => {});
}

/** At most one ping per 10 minutes per tab for a business, always for the business the shell is showing. */
export function useSeenPing(bid: string | null, pathname: string | null): void {
  useEffect(() => { sendSeen(bid); }, [bid, pathname]);
}
