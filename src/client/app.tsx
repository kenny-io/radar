'use client';
// The client "app" object — the real-data equivalent of the prototype's `app` ({B, go, route, toast, ...}).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, actCall, ApiError } from './api';
import { LaterQueue } from './laterQueue';
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
}
export interface AppCtx {
  me: Me; user: Me['user']; B: Workspace | null; bid: string | null;
  route: Route; go: (page: Page, params?: any) => void;
  toast: (msg: React.ReactNode, opt?: ToastOpts) => void;
  act: <T = any>(action: string, input?: any, opts?: ActOpts) => Promise<T>;
  /** Debounced act for text fields: last call per key wins after `ms`. */
  actLater: (key: string, action: string, input: any, opts?: ActOpts & { ms?: number }) => void;
  /** Send pending `actLater` saves now; resolves when they have finished (never rejects). Call before social.postNow / schedule / scheduleAll. */
  flushLater: () => Promise<void>;
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
  if (page === 'article') return `/article/${encodeURIComponent(String(params))}`;
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
  const [onb, setOnb] = useState<boolean>(!initialMe.currentId);
  const bid = me.currentId;
  const bidRef = useRef(bid); bidRef.current = bid;
  const route = useMemo(() => urlToRoute(pathname || '/dashboard', new URLSearchParams(sp?.toString() || '')), [pathname, sp]);

  const go = useCallback((page: Page, params?: any) => { router.push(routeToUrl(page, params)); window.scrollTo(0, 0); }, [router]);

  const refresh = useCallback(async () => {
    const id = bidRef.current; if (!id) { setBState(null); return; }
    try { const w = await api<Workspace>(`/api/b/${id}/workspace`); if (bidRef.current === id) setBState(w); }
    catch (e) { if (e instanceof ApiError && e.status === 401) window.location.href = '/signup'; }
  }, []);
  const refreshMe = useCallback(async () => { const m = await api<Me>('/api/me'); setMe(m); return m; }, []);
  useEffect(() => { setBState(null); setJobs({}); refresh(); }, [bid, refresh]);

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
        toast(t.msg, { tone: t.tone || null, action: t.action ? { label: t.action.label, fn: () => router.push(t.action.href) } : null });
      });
      es.onerror = () => { es?.close(); if (!stopped) retry = setTimeout(open, 3000); };
    };
    open();
    return () => { stopped = true; clearTimeout(retry); es?.close(); };
  }, [bid, refresh, toast, router]);

  const later = useRef(new LaterQueue());
  const revRef = useRef(0); revRef.current = B?.rev || 0;
  const inflight = useRef(0); const latestWs = useRef<Workspace | null>(null); const staleRef = useRef(false);
  const setB = useCallback((fn: (B: Workspace) => Workspace) => setBState(b => (b ? fn(b) : b)), []);

  const act = useCallback(async <T,>(action: string, input?: any, opts: ActOpts = {}): Promise<T> => {
    const id = bidRef.current; if (!id) throw new Error('No business');
    if (opts.optimistic) setBState(b => (b ? opts.optimistic!(b) : b));
    inflight.current++;
    try {
      const r = await actCall<T>(id, action, input);
      if (r.workspace && bidRef.current === id) {
        // Only the last in-flight write replaces local state; earlier responses must not clobber newer optimistic edits.
        if (!latestWs.current || r.workspace.rev >= latestWs.current.rev) latestWs.current = r.workspace;
        if (inflight.current === 1 && !later.current.size) {
          const ws = latestWs.current; latestWs.current = null;
          if (!opts.keepLocal) setBState(ws); else setBState(b => (b ? { ...b, rev: ws.rev } : b));
        }
      }
      return r.data as T;
    } catch (e: any) {
      if (opts.optimistic) refresh();
      if (!opts.silent) toast(e?.message || 'Radar couldn’t finish this. Try again.', { tone: 'bad' });
      throw e;
    } finally {
      inflight.current--;
      if (inflight.current === 0 && !later.current.size && staleRef.current) { staleRef.current = false; refresh(); }
    }
  }, [refresh, toast]);

  const actLater = useCallback((key: string, action: string, input: any, opts: ActOpts & { ms?: number } = {}) => {
    if (opts.optimistic) setBState(b => (b ? opts.optimistic!(b) : b));
    later.current.schedule(key, opts.ms ?? 600, () => act(action, input, { ...opts, optimistic: undefined, keepLocal: true }));
  }, [act]);
  const flushLater = useCallback(() => later.current.flush(), []);

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
    me, user: me.user, B, bid, route, go, toast, act, actLater, flushLater, setB, refresh, refreshMe, switchBusiness, jobs, jobFor,
    onboarding: { open: onb || !me.currentId, start: () => setOnb(true), close: () => setOnb(false) },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
