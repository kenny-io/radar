// Unread Activity between workspace refetches (first-five RL-4). The workspace carries the member's unread count; each
// `toast` event the tab receives after that is one more, counted once per notification id. A workspace from the server
// (or reading the list) settles it back to zero. React-free; the bell subscribes with useSyncExternalStore.
export class LiveUnread {
  private seen = new Map<string, Set<string>>();
  private fresh = new Map<string, number>();
  private subs = new Set<() => void>();

  /** A toast event for business `bid`. The same id again (a reconnect, a second listener) is not counted twice. */
  add(bid: string | null | undefined, id: unknown): void {
    if (!bid || typeof id !== 'string' || !id) return;
    let ids = this.seen.get(bid); if (!ids) this.seen.set(bid, ids = new Set());
    if (ids.has(id)) return;
    ids.add(id); this.fresh.set(bid, (this.fresh.get(bid) || 0) + 1); this.emit();
  }
  /** The count from the server replaced the number, or the member read the list. Ids stay known, so a repeat of an
   *  event already counted does not come back. */
  settle(bid: string | null | undefined): void {
    if (!bid || !this.fresh.get(bid)) return;
    this.fresh.set(bid, 0); this.emit();
  }
  count(bid: string | null | undefined): number { return (bid && this.fresh.get(bid)) || 0; }
  subscribe = (fn: () => void): (() => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };
  private emit() { for (const fn of [...this.subs]) fn(); }
}
/** One per tab. */
export const liveUnread = new LiveUnread();
