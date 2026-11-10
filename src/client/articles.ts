'use client';
// The one open article. The workspace carries only a summary per article (`B.articles[id]`: generated, outline, v); the
// body is fetched with `article.get` when the article opens and held here, in the hook, with no cache: a cached copy shown
// before it is revalidated is how edits get overwritten. The rules live in articleSync.ts
// (.factory/first-five-optimizations/architecture.md §3.3, §12).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './app';
import { actCall, isSubscriptionRequired } from './api';
import { ArticleSync, type ArticleState, type LoadedArticle, type SaveReply } from './articleSync';
import type { Article } from '@/lib/types';

export interface OpenArticle extends ArticleState {
  /** Apply a local edit at once. Saving stays with `app.actLater` / `app.act`, as before. */
  patch: (fn: (a: Article) => Article) => void;
  /** Fetch the server's copy again: after a job or an action changed it server-side, and for Retry. Never replaces unsaved typing. */
  reload: () => void;
  /** Hand over the `{ v, prev }` an `article.save` / `article.source` returned, so a teammate's save in between is noticed. */
  saved: (r: SaveReply) => void;
}
const LOADING: ArticleState = { status: 'loading', article: null, error: null };

/** `entryId` null (no such entry) loads nothing. State is per (business, entry): switching either starts over. */
export function useArticle(entryId: string | null): OpenArticle {
  const app = useApp(); const appRef = useRef(app); appRef.current = app;
  const bid = app.bid; const key = bid && entryId ? `${bid}/${entryId}` : null;
  const [held, setHeld] = useState<{ key: string; sync: ArticleSync; st: ArticleState } | null>(null);
  const v = app.B && entryId ? app.B.articles[entryId]?.v ?? 0 : undefined; const rev = app.B?.rev;
  const vRef = useRef(v); vRef.current = v;

  useEffect(() => {
    if (!bid || !entryId || !key) return;
    const sync = new ArticleSync({
      // Not through `app.act`: a read of the article must not count as the app being busy, or it could never be applied.
      load: async () => {
        try { return (await actCall<LoadedArticle>(bid, 'article.get', { entryId })).data!; }
        catch (e) { if (isSubscriptionRequired(e)) window.location.assign('/start-trial'); throw e; }
      },
      busy: () => appRef.current.busy(), flush: () => appRef.current.flushLater(),
    });
    const show = () => setHeld({ key, sync, st: sync.state });
    const off = sync.subscribe(show); show();
    sync.sync(vRef.current); sync.open();
    return () => { off(); sync.dispose(); };
  }, [bid, entryId, key]);

  const cur = held && held.key === key ? held : null; const sync = cur?.sync;
  // A teammate's (or another tab's, or a job's) change arrives as a new `v` in the workspace; every revision change is
  // also the moment to look again at a reload that was held back while the user was typing.
  useEffect(() => { if (sync && v !== undefined) sync.sync(v); }, [sync, v, rev]);

  return useMemo(() => ({
    ...(cur?.st || LOADING),
    patch: fn => { sync?.patch(fn); }, reload: () => { sync?.reload(); }, saved: r => { sync?.saved(r); },
  }), [cur?.st, sync]); // eslint-disable-line react-hooks/exhaustive-deps
}
