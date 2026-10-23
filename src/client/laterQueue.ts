// Debounced saves for `useApp().actLater`, with `flush()` for `useApp().flushLater()` (social channels: pending autosaves
// must reach the server before Post now / Schedule, so the post that goes out is the text the user last typed).
// Pure (no React) so it can be tested on its own.

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (t: unknown) => void };
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: t => clearTimeout(t as any) };

export class LaterQueue {
  private waiting: Record<string, { timer: unknown; fire: () => Promise<void> }> = {};
  private flying = new Set<Promise<void>>();
  constructor(private timers: Timers = realTimers) {}

  /** Run `run` after `ms`; a later call with the same key replaces the waiting one (last call wins). */
  schedule(key: string, ms: number, run: () => Promise<unknown>) {
    this.cancel(key);
    const fire = () => {
      delete this.waiting[key];
      const p: Promise<void> = Promise.resolve().then(run).then(() => {}, () => {}).finally(() => { this.flying.delete(p); });
      this.flying.add(p);
      return p;
    };
    this.waiting[key] = { timer: this.timers.set(fire, ms), fire };
  }
  cancel(key: string) {
    const w = this.waiting[key]; if (!w) return;
    this.timers.clear(w.timer); delete this.waiting[key];
  }
  /** Saves still waiting for their timer (typing in progress). */
  get size() { return Object.keys(this.waiting).length; }
  /** Fire every waiting save now and resolve when they, and any save already in flight, have finished. Never rejects. */
  async flush(): Promise<void> {
    for (const key of Object.keys(this.waiting)) { const w = this.waiting[key]; this.timers.clear(w.timer); w.fire(); }
    await Promise.all([...this.flying]);
  }
}
