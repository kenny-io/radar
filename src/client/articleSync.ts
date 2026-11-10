// Decision logic for "lighter saves" (.factory/first-five-optimizations/architecture.md §3.1, §3.3, §12): which revisions
// this tab has accounted for, and when the one open article may be fetched and replaced. No React and no DOM, so it can
// be tested on its own (as laterQueue.ts is). `app.tsx` owns a RevSync; `articles.ts` wraps an ArticleSync in a hook.
import type { Article } from '@/lib/types';

/** What `act` does with local state after a reply: replace the workspace, or only move its revision; `stale` asks for
 *  the refresh that runs once the tab is idle. */
export interface ReplyPlan<W> { apply?: W; rev?: number; stale: boolean }

/** Revisions of one business as this tab knows them, and the newest workspace a write returned that could not be shown
 *  yet. A debounced save is answered with only the new revision, so the tab must tell "that was my write" from "someone
 *  else wrote too": `base` is the revision up to which everything is accounted for; `own` holds the tab's own replies
 *  above a hole. Replies can arrive out of order, and a held or dropped workspace reply still counts as the tab's own,
 *  so a hole only means something once the tab is idle. */
export class RevSync<W extends { rev: number } = { rev: number }> {
  private base = 0; private own = new Set<number>(); private held: W | null = null;
  /** A whole workspace at `rev` is what the tab shows now (first load, refresh, or an applied write reply). */
  reset(rev: number) { this.base = rev; this.own.clear(); if (this.held && this.held.rev <= rev) this.held = null; }
  /** Highest revision this tab knows of. A workspace older than this must not replace local state. */
  get top() { let t = this.base; for (const r of this.own) if (r > t) t = r; return t; }
  /** A revision below `top` came from a teammate, another tab or a job (or from a reply this tab never received). */
  get gap() { return this.own.size > 0; }
  private note(rev: number) { if (rev <= this.base) return; this.own.add(rev); while (this.own.delete(this.base + 1)) this.base++; }

  /** One call was answered. `idle`: it was the last call in flight and no save is waiting for its debounce.
   *  `keepLocal`: the caller keeps its optimistic state (debounced saves), so only the revision may move.
   *  Only the last write in flight replaces local state, and only with a workspace nothing of this tab's came after. */
  reply(r: { rev?: number; workspace?: W }, idle: boolean, keepLocal: boolean): ReplyPlan<W> {
    const rev = r.workspace?.rev ?? r.rev;
    if (rev == null) return { stale: false }; // a read
    this.note(rev);
    if (r.workspace && (!this.held || r.workspace.rev >= this.held.rev)) this.held = r.workspace;
    if (!idle) return r.workspace ? { stale: false } : { rev, stale: false };
    const ws = this.held; this.held = null; const top = this.top;
    if (ws && ws.rev === top && !keepLocal) { this.reset(top); return { apply: ws, stale: false }; }
    // The held workspace is dropped (its revision is counted, so that is not mistaken for someone else's write). When the
    // reply that just arrived was itself that outdated workspace, nothing newer will bring the server's state: refresh.
    return { rev: top, stale: this.gap || (!!r.workspace && r.workspace.rev < top) };
  }
}

/** What `useApp().busy()` answers from: a save waiting for its debounce, a call in flight, or a flush under way.
 *  A flushed save leaves the queue one tick before its request starts (laterQueue.ts), so "queue empty and nothing in
 *  flight" is briefly true in the middle of a flush; `flushing` covers that, or an article opened right then would be
 *  fetched before the save it was waiting for. */
export class Pending {
  private flushing = 0;
  constructor(private later: { readonly size: number; flush: () => Promise<void> }, private inflight: () => number) {}
  get busy() { return this.later.size > 0 || this.inflight() > 0 || this.flushing > 0; }
  /** Send waiting saves now; resolves when they, and saves already in flight, have finished. Never rejects. */
  flush(): Promise<void> { this.flushing++; return this.later.flush().finally(() => { this.flushing--; }); }
}

type DoneJob = { status: string; createdAt?: string; result?: any } | null | undefined;
/** A draft job finished and the article on screen is not that draft yet: keep the stream up and reload the article. */
export const draftLanded = (job: DoneJob, a: Pick<Article, 'draftedAt'> | null): boolean =>
  !!a && !!job && job.status === 'done' && !!job.result?.draftedAt && job.result.draftedAt !== a.draftedAt;
/** A body-image job finished after the images on screen were made: reload the article to show the new set. */
export const bodyImagesLanded = (job: DoneJob, a: Pick<Article, 'bodyImagesGeneratedAt'> | null): boolean =>
  !!a && !!job && job.status === 'done' && !!job.result?.bodyImagesGeneratedAt && new Date(job.result.bodyImagesGeneratedAt).getTime() > new Date(a.bodyImagesGeneratedAt || 0).getTime();

export interface LoadedArticle { article: Article; /** articles.updated_at in epoch ms; 0 when the row does not exist yet */ v: number }
export interface ArticleState { status: 'loading' | 'error' | 'ready'; article: Article | null; error: string | null }
export type SaveReply = { v?: number; prev?: number } | null | undefined | void;
type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (t: unknown) => void };
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: t => clearTimeout(t as any) };
export interface ArticleSyncDeps {
  /** `article.get` for the open entry. */
  load: () => Promise<LoadedArticle>;
  /** `useApp().busy()`: a save is waiting for its debounce or a call is in flight. */
  busy: () => boolean;
  /** `useApp().flushLater()`: send waiting saves now; resolves when they are done. */
  flush: () => Promise<void>;
  timers?: Timers;
}
/** How soon a held-back load is looked at again (it is also looked at on every workspace revision change). */
export const RECHECK_MS = 400;
export const RELOAD_RETRIES = 3; export const RELOAD_RETRY_MS = 3000;
export const LOAD_ERROR = 'Radar couldn’t load this article. Try again.';
const LOADING: ArticleState = { status: 'loading', article: null, error: null };

/** Holds the one open article. Local edits go in through `patch`; the server's copy comes in only when that cannot
 *  overwrite something the user typed: never while the app is busy, and never if an edit happened while the request was
 *  out. A load that is held back or dropped is tried again on a short timer and on the next revision change. */
export class ArticleSync {
  private st: ArticleState = LOADING;
  private listeners = new Set<() => void>(); private timers: Timers;
  /** `v` of what is on screen: as loaded, then moved along by this tab's own saves. null until the first load. */
  private loadedV: number | null = null;
  /** The last `v` the workspace showed for this entry. */
  private seenV: number | undefined = undefined;
  /** Own saves whose `prev` is not (yet) what is on screen: prev → v. */
  private links = new Map<number, number>();
  private seq = 0; private life = 0; private live = false; private fetching = false;
  private wantV = false; private wantX = false; private timer: unknown = null; private fails = 0;
  constructor(private deps: ArticleSyncDeps) { this.timers = deps.timers || realTimers; }

  get state() { return this.st; }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private set(st: ArticleState) { this.st = st; this.listeners.forEach(f => f()); }
  private wait(ms: number) { this.stopTimer(); this.timer = this.timers.set(() => { this.timer = null; this.tryLoad(); }, ms); }
  private stopTimer() { if (this.timer != null) { this.timers.clear(this.timer); this.timer = null; } }

  /** Start loading. Saves still waiting from a moment ago (leave and come straight back) are sent first, and the fetch
   *  waits for every call in flight, so the first thing shown is never older than what the user last typed. */
  open() {
    this.life++; this.live = true; this.fetching = false; this.wantX = true; this.fails = 0;
    if (this.deps.busy()) void this.deps.flush().then(() => this.tryLoad(), () => this.tryLoad());
    this.tryLoad();
  }
  dispose() { this.life++; this.live = false; this.fetching = false; this.stopTimer(); this.listeners.clear(); }

  /** A local edit: applied at once, and any load that is out is dropped when it comes back. */
  patch(fn: (a: Article) => Article) {
    if (!this.live || this.st.status !== 'ready' || !this.st.article) return;
    this.seq++; this.set({ ...this.st, article: fn(this.st.article) });
  }

  /** The workspace's `v` for this entry, passed on every change of it or of the workspace revision. A reload is wanted
   *  when `v` CHANGES to something other than what is on screen. Plain inequality would loop (fetched 100 while a
   *  workspace that has not refreshed yet still says 50) and would fire on this tab's own revision-only saves. */
  sync(remoteV: number | undefined) {
    const v = remoteV ?? 0;
    if (v !== this.seenV) { this.seenV = v; if (v !== this.loadedV) this.wantV = true; }
    this.tryLoad();
  }

  /** The article changed on the server in a way this tab cannot derive: a draft or body-image job finished, a cover was
   *  rendered, video suggestions were stored, or a save failed and the optimistic edit must go. Also the Retry button. */
  reload() {
    if (!this.live) return;
    this.wantX = true; this.fails = 0;
    if (this.st.status === 'error') this.set(LOADING);
    this.tryLoad();
  }

  /** `article.save` / `article.source` answered `{ v, prev }`: the row's new version and the one it replaced. If `prev` is
   *  what is on screen, nobody wrote in between and the screen is now at `v`. Replies can arrive out of order, so a link
   *  that does not join yet is kept; one that never joins means a teammate's save landed in between: reload when idle. */
  saved(r: SaveReply) {
    if (!this.live || this.loadedV === null || !r || typeof r.v !== 'number' || typeof r.prev !== 'number' || r.v === r.prev) return;
    this.links.set(r.prev, r.v);
    for (let next = this.links.get(this.loadedV); next !== undefined; next = this.links.get(this.loadedV)) { this.links.delete(this.loadedV); this.loadedV = next; }
    if (this.links.size) this.wait(RECHECK_MS);
  }

  private tryLoad() {
    if (!this.live || this.fetching) return;
    if (this.wantV && this.seenV === this.loadedV) this.wantV = false; // an own save caught up with the workspace meanwhile
    if (!(this.wantV || this.wantX || this.links.size)) return;
    if (this.deps.busy()) { this.wait(RECHECK_MS); return; }
    this.stopTimer();
    const life = this.life; const seq = this.seq;
    this.fetching = true; this.wantV = false; this.wantX = false; this.links.clear();
    this.deps.load().then(r => {
      if (life !== this.life) return;
      this.fetching = false;
      // Typed, or a save started, while the request was out: this copy may predate that edit. Drop it and ask again later.
      if (seq !== this.seq || this.deps.busy()) { this.wantX = true; this.wait(RECHECK_MS); return; }
      this.fails = 0; this.loadedV = r.v; this.links.clear();
      this.set({ status: 'ready', article: r.article, error: null });
      this.tryLoad(); // the workspace moved on again while this was out
    }, (e: any) => {
      if (life !== this.life) return;
      this.fetching = false;
      if (this.st.status !== 'ready') { this.wantV = false; this.wantX = false; this.set({ status: 'error', article: null, error: e?.message || LOAD_ERROR }); return; }
      // A background reload failed: keep what is on screen. Try a few more times, then leave it for the next revision change.
      this.wantX = true; if (++this.fails <= RELOAD_RETRIES) this.wait(RELOAD_RETRY_MS);
    });
  }
}
