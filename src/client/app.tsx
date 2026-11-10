'use client';
// The client "app" object — the real-data equivalent of the prototype's `app` ({B, go, route, toast, ...}).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, actCall, ApiError, isSubscriptionRequired } from './api';
import { LaterQueue } from './laterQueue';
import { Pending, RevSync } from './articleSync';
import { useSeenPing } from './seen';
import { liveUnread } from './liveUnread';
import { articleUrl } from '@/features/article/review';
import { useToast, type ToastOpts } from '@/components/ui';
import type { JobSummary, Me, Workspace } from '@/lib/types';

export type Page = 'dashboard' | 'brief' | 'calendar' | 'article' | 'social' | 'performance' | 'backlinks' | 'profile' | 'settings';
export interface Route { page: Page; params: any }

export interface ActOpts {
  /** Apply immediately to local state (optimistic). The server's workspace replaces it when the call returns. */
  optimistic?: (B: Workspace) => Workspace;
  /** Don't toast on error. */
  silent?: boolean;
  /** Keep local optimistic state rather than replacing with the server's workspace (for rapid typing). */
  keepLocal?: boolean;
  /** 'rev': the server answers a write with the new revision only and builds no workspace. `actLater` always sends it. */
  reply?: 'rev';
}
export interface AppCtx {
  me: Me; user: Me['user']; B: Workspace | null; bid: string | null;
  /** `go('article', id)` or `go('article', { id, back })`: `back` is where the article's Back button returns (review.ts).
   *  `replace`: replace the history entry instead of adding one. `scroll: false`: keep the scroll position; when only the
   *  query changes this also skips the server round trip (the calendar's view, filter and open entry). */
  route: Route; go: (page: Page, params?: any, opts?: { replace?: boolean; scroll?: boolean }) => void;
  toast: (msg: React.ReactNode, opt?: ToastOpts) => void;
  act: <T = any>(action: string, input?: any, opts?: ActOpts) => Promise<T>;
  /** Debounced act for text fields: last call per key wins after `ms`. The reply carries no workspace; `done` gets the action's data when the save succeeds. */
  actLater: (key: string, action: string, input: any, opts?: ActOpts & { ms?: number; done?: (data: any) => void }) => void;
  /** Send pending `actLater` saves now; resolves when they have finished (never rejects). Call before social.postNow / schedule / scheduleAll. */
  flushLater: () => Promise<void>;
  /** A save is waiting for its debounce or a call is in flight: not the moment to replace what the user is editing. */
  busy: () => boolean;
  setB: (fn: (B: Workspace) => Workspace) => void;
  refresh: () => Promise<void>;
  refreshMe: () => Promise<Me>;
  switchBusiness: (id: string) => Promise<void>;
  jobs: Record<string, JobSummary & { result?: any }>;
  /** Latest job for kind (+ optional ref) from live SSE state, falling back to the workspace snapshot. */
  jobFor: (kind: string, ref?: string | null) => (JobSummary & { result?: any }) | null;
  onboarding: { open: boolean; start: () => void; close: () => void };
}
const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => { const c = useContext(Ctx); if (!c) throw new Error('useApp outside AppProvider'); return c; };

export function routeToUrl(page: Page, params?: any): string {
  const q = new URLSearchParams();
  if (page === 'article') return params && typeof params === 'object' ? articleUrl(String(params.id), params.back) : articleUrl(String(params));
  if (params && typeof params === 'object') for (const [k, v] of Object.entries(params)) if (v != null && v !== false) q.set(k, v === true ? '1' : String(v));
  const s = q.toString();
  return `/${page}${s ? '?' + s : ''}`;
}
function urlToRoute(path: string, sp: URLSearchParams): Route {
  const seg = path.split('/').filter(Boolean);
  const page = (seg[0] || 'dashboard') as Page;
  if (page === 'article') return { page, params: decodeURIComponent(seg[1] || '') };
  const params: any = {};
  sp.forEach((v, k) => { params[k] = v === '1' ? true : v; });
  return { page, params: Object.keys(params).length ? params : null };
}

export function AppProvider({ me: initialMe, children }: { me: Me; children: React.ReactNode }) {
  const router = useRouter(); const pathname = usePathname(); const sp = useSearchParams();
  const toast = useToast();
  const [me, setMe] = useState<Me>(initialMe);
  const [B, setBState] = useState<Workspace | null>(null);
  const [jobs, setJobs] = useState<Record<string, any>>({});
  // Opens only from "Add a business": the server guard guarantees a current business (no auto-open without one).
  const [onb, setOnb] = useState(false);
  const bid = me.currentId;
  const bidRef = useRef(bid); bidRef.current = bid;
  useSeenPing(bid, pathname);
  const route = useMemo(() => urlToRoute(pathname || '/dashboard', new URLSearchParams(sp?.toString() || '')), [pathname, sp]);

  const go = useCallback((page: Page, params?: any, opts: { replace?: boolean; scroll?: boolean } = {}) => {
    const url = routeToUrl(page, params);
    if (opts.scroll === false) {
      // Only the query changes: Next keeps usePathname/useSearchParams in step with the History API, so the screen
      // re-renders from the new URL at once, with no request to the server and no scrolling.
      if (url.split('?')[0] === window.location.pathname) { window.history[opts.replace ? 'replaceState' : 'pushState'](null, '', url); return; }
      if (opts.replace) router.replace(url, { scroll: false }); else router.push(url, { scroll: false });
      return;
    }
    if (opts.replace) router.replace(url); else router.push(url);
    window.scrollTo(0, 0);
  }, [router]);

  const later = useRef(new LaterQueue());
  const revRef = useRef(0); revRef.current = B?.rev || 0;
  const inflight = useRef(0); const staleRef = useRef(false);
  // Which revisions this tab has accounted for (its own write replies) and the workspace reply it is holding back.
  const revs = useRef(new RevSync<Workspace>());
  const pending = useRef<Pending>(null as any); if (!pending.current) pending.current = new Pending(later.current, () => inflight.current);
  const busy = useCallback(() => pending.current.busy, []);

  const refresh = useCallback(async () => {
    const id = bidRef.current; if (!id) { setBState(null); return; }
    try {
      for (let tries = 0; ; tries++) {
        const w = await api<Workspace>(`/api/b/${id}/workspace`); if (bidRef.current !== id) return;
        // Never go back: a snapshot older than a reply this tab already has raced one of its own writes. Ask again.
        if (w.rev < revs.current.top && tries < 2) continue;
        revs.current.reset(w.rev); setBState(w); return;
      }
    }
    catch (e) { if (e instanceof ApiError && e.status === 401) window.location.href = '/signup'; else if (isSubscriptionRequired(e)) window.location.assign('/start-trial'); }
  }, []);
  const refreshMe = useCallback(async () => { const m = await api<Me>('/api/me'); setMe(m); return m; }, []);
  useEffect(() => { setBState(null); setJobs({}); revs.current = new RevSync<Workspace>(); refresh(); }, [bid, refresh]);

  // Live updates: revisions, job progress, toasts.
  useEffect(() => {
    if (!bid) return;
    let es: EventSource | null = null; let stopped = false; let retry: any;
    const open = () => {
      es = new EventSource(`/api/b/${bid}/events`);
      es.addEventListener('rev', (ev: MessageEvent) => {
        const { rev } = JSON.parse(ev.data);
        if (revRef.current >= rev) return; // already have it (e.g. our own write)
        if (later.current.size || inflight.current > 0) { staleRef.current = true; return; } // don't clobber typing
        refresh();
      });
      es.addEventListener('job', (ev: MessageEvent) => { const j = JSON.parse(ev.data); setJobs(m => ({ ...m, [j.id]: j })); });
      es.addEventListener('toast', (ev: MessageEvent) => {
        const t = JSON.parse(ev.data);
        liveUnread.add(bid, t.id); // the bell's unread count, until the next workspace brings the server's number
        toast(t.msg, { tone: t.tone || null, action: t.action ? { label: t.action.label, fn: () => router.push(t.action.href) } : null });
      });
      es.onerror = () => {
        es?.close(); if (stopped) return;
        // EventSource can't read the status, so a business that lost access (402) or a lost session (401) would retry
        // forever: ask the workspace once (leave on 401/402, ignore anything else; state is not touched), then reconnect.
        api(`/api/b/${bid}/workspace`).catch(e => { if (e instanceof ApiError && e.status === 401) window.location.href = '/signup'; else if (isSubscriptionRequired(e)) window.location.assign('/start-trial'); });
        retry = setTimeout(open, 3000);
      };
    };
    open();
    return () => { stopped = true; clearTimeout(retry); es?.close(); };
  }, [bid, refresh, toast, router]);

  // One-shot toasts after a full navigation to the dashboard (architecture §5.3), then the query is dropped.
  // Read from window.location and cleaned synchronously, so StrictMode's second effect run finds nothing to show.
  useEffect(() => {
    const u = new URL(window.location.href); const msgs: string[] = [];
    if (u.searchParams.get('started') === 'trial') { msgs.push('Your free trial has started.'); u.searchParams.delete('started'); }
    if (u.searchParams.get('saved') === 'profile') { msgs.push('Business Profile saved'); u.searchParams.delete('saved'); }
    if (!msgs.length) return;
    window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash);
    msgs.forEach(m => toast(m, { tone: 'ok' }));
  }, [toast]);

  const setB = useCallback((fn: (B: Workspace) => Workspace) => setBState(b => (b ? fn(b) : b)), []);

  const act = useCallback(async <T,>(action: string, input?: any, opts: ActOpts = {}): Promise<T> => {
    const id = bidRef.current; if (!id) throw new Error('No business');
    if (opts.optimistic) setBState(b => (b ? opts.optimistic!(b) : b));
    inflight.current++;
    try {
      const r = await actCall<T>(id, action, input, opts.reply);
      if (bidRef.current === id) {
        // Only the last in-flight write replaces local state; earlier responses must not clobber newer optimistic edits.
        // A revision-only reply (debounced saves) moves just the revision; a revision somebody else wrote in between
        // marks the workspace stale, and the refresh below runs once nothing is pending (articleSync.ts, RevSync).
        const plan = revs.current.reply(r, inflight.current === 1 && !later.current.size, !!opts.keepLocal);
        if (plan.apply) setBState(plan.apply); else if (plan.rev != null) { const rev = plan.rev; setBState(b => (b && b.rev < rev ? { ...b, rev } : b)); }
        if (plan.stale) staleRef.current = true;
      }
      return r.data as T;
    } catch (e: any) {
      // The business is locked (no trialing/active subscription): the trial page is the only way forward.
      if (isSubscriptionRequired(e)) { window.location.assign('/start-trial'); throw e; }
      if (opts.optimistic) refresh();
      if (!opts.silent) toast(e?.message || 'Radar couldn’t finish this. Try again.', { tone: 'bad' });
      throw e;
    } finally {
      inflight.current--;
      if (inflight.current === 0 && !later.current.size && staleRef.current) { staleRef.current = false; refresh(); }
    }
  }, [refresh, toast]);

  const actLater = useCallback((key: string, action: string, input: any, { ms, done, ...opts }: ActOpts & { ms?: number; done?: (data: any) => void } = {}) => {
    if (opts.optimistic) setBState(b => (b ? opts.optimistic!(b) : b));
    later.current.schedule(key, ms ?? 600, () => act(action, input, { ...opts, optimistic: undefined, keepLocal: true, reply: 'rev' }).then(done));
  }, [act]);
  const flushLater = useCallback(() => pending.current.flush(), []);

  const switchBusiness = useCallback(async (id: string) => {
    await api('/api/b/current', { body: { id } });
    await refreshMe();
    router.push('/dashboard');
  }, [refreshMe, router]);

  const jobFor = useCallback((kind: string, ref?: string | null) => {
    const all: any[] = [...Object.values(jobs), ...((B?.jobs || []).filter(j => !jobs[j.id]))];
    const m = all.filter(j => j.kind === kind && (ref === undefined || j.ref === ref)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return m[0] || null;
  }, [jobs, B]);

  const value: AppCtx = {
    me, user: me.user, B, bid, route, go, toast, act, actLater, flushLater, busy, setB, refresh, refreshMe, switchBusiness, jobs, jobFor,
    onboarding: { open: onb, start: () => setOnb(true), close: () => setOnb(false) },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
