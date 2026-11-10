// "Lighter saves" client rules (.factory/first-five-optimizations/architecture.md §3.1, §3.3, §12): what the tab does with a
// write reply that carries only a revision, and when the open article may be replaced by the server's copy.
import { describe, expect, it } from 'vitest';
import { ArticleSync, Pending, RECHECK_MS, RELOAD_RETRIES, RevSync, bodyImagesLanded, draftLanded, type LoadedArticle } from './articleSync';
import { LaterQueue } from './laterQueue';
import type { Article } from '@/lib/types';

type WS = { rev: number; name: string };
const ws = (rev: number): WS => ({ rev, name: 'workspace@' + rev });
/** A tab whose workspace is at revision `rev`. */
const tabAt = (rev: number) => { const r = new RevSync<WS>(); r.reset(rev); return r; };
const IDLE = true; const PENDING = false; const KEEP = true;

describe('RevSync: revision-only replies', () => {
  it('my own save moves the revision by one and asks for nothing more', () => {
    const r = tabAt(10);
    expect(r.reply({ rev: 11 }, IDLE, KEEP)).toEqual({ rev: 11, stale: false });
    expect(r.reply({ rev: 12 }, IDLE, KEEP)).toEqual({ rev: 12, stale: false });
  });

  it('a revision somebody else wrote between two of my saves marks the workspace stale, until a refresh lands', () => {
    const r = tabAt(10);
    expect(r.reply({ rev: 12 }, IDLE, KEEP)).toEqual({ rev: 12, stale: true }); // 11 was not mine
    expect(r.reply({ rev: 13 }, IDLE, KEEP)).toEqual({ rev: 13, stale: true }); // still unexplained while no refresh has landed
    r.reset(13);
    expect(r.reply({ rev: 14 }, IDLE, KEEP)).toEqual({ rev: 14, stale: false });
  });

  it('while more is pending the revision still moves, and the verdict waits for the last reply', () => {
    const r = tabAt(10);
    expect(r.reply({ rev: 12 }, PENDING, KEEP)).toEqual({ rev: 12, stale: false }); // answered out of order: 11 is still in flight
    expect(r.reply({ rev: 11 }, IDLE, KEEP)).toEqual({ rev: 12, stale: false });   // both mine: no gap, and the revision never goes back
  });

  it('a workspace reply that is held back and then dropped is not mistaken for someone else’s write', () => {
    const r = tabAt(10);
    // "Approve" answers with the workspace at 11 while a debounced save is still waiting: held, nothing applied.
    expect(r.reply({ rev: 11, workspace: ws(11) }, PENDING, false)).toEqual({ stale: false });
    // The save answers with revision 12 only. The held workspace predates it, so it is dropped; 11 and 12 are both mine.
    expect(r.reply({ rev: 12 }, IDLE, KEEP)).toEqual({ rev: 12, stale: false });
  });

  it('…but a teammate’s write next to a held workspace is still noticed', () => {
    const r = tabAt(10);
    r.reply({ rev: 12, workspace: ws(12) }, PENDING, false);                      // 11 was a teammate
    expect(r.reply({ rev: 13 }, IDLE, KEEP)).toEqual({ rev: 13, stale: true });
  });

  it('the last write in flight applies the newest workspace; a keepLocal caller only moves the revision', () => {
    const r = tabAt(10);
    expect(r.reply({ rev: 11, workspace: ws(11) }, IDLE, false)).toEqual({ apply: ws(11), stale: false });
    expect(r.reply({ rev: 12, workspace: ws(12) }, IDLE, KEEP)).toEqual({ rev: 12, stale: false });
    // Two writes in flight: the earlier reply waits, the later one applies the newer of the two workspaces.
    expect(r.reply({ rev: 14, workspace: ws(14) }, PENDING, false)).toEqual({ stale: false });
    expect(r.reply({ rev: 13, workspace: ws(13) }, IDLE, false)).toEqual({ apply: ws(14), stale: false });
  });

  it('a workspace older than a save this tab already had answered is never applied; a refresh fetches the current one', () => {
    const r = tabAt(10);
    r.reply({ rev: 12 }, PENDING, KEEP);                                          // the save (12) is answered first
    expect(r.reply({ rev: 11, workspace: ws(11) }, IDLE, false)).toEqual({ rev: 12, stale: true }); // would undo the save's optimistic state
    expect(r.top).toBe(12); // what `refresh` compares a fetched workspace against before applying it
  });

  it('a read reply and a legacy write reply (workspace, no rev) are handled: nothing, and as a write at the workspace’s revision', () => {
    const r = tabAt(10);
    expect(r.reply({}, IDLE, false)).toEqual({ stale: false });
    expect(r.reply({ workspace: ws(11) }, IDLE, false)).toEqual({ apply: ws(11), stale: false });
  });
});

/** Manual timers: nothing fires until the test says so. */
function fakeTimers() {
  let id = 0; const live = new Map<number, { fn: () => void; ms: number }>();
  return { t: { set: (fn: () => void, ms: number) => { live.set(++id, { fn, ms }); return id; }, clear: (x: unknown) => { live.delete(x as number); } }, fire: () => { const fs = [...live.values()]; live.clear(); fs.forEach(f => f.fn()); }, pending: () => [...live.values()].map(x => x.ms) };
}
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const art = (angle: string, extra: Partial<Article> = {}): Article => ({ entryId: 'e1', generated: true, body: [['p', 'Body']], brief: { angle, outline: [], words: 1400 }, seo: { title: 't', meta: '', slug: 's' }, img: { style: 'branded', seed: 1, prompt: '', alt: '', url: null }, videos: [], videoMeta: [], sources: [], claims: [], ...extra });
const angle = (s: ArticleSync) => s.state.article?.brief.angle;
const type = (s: ArticleSync, text: string) => s.patch(a => ({ ...a, brief: { ...a.brief, angle: text } }));

/** One open article with a controllable server: `answer` resolves the oldest unanswered `article.get`. */
function harness() {
  const ft = fakeTimers(); const app = { busy: false, flushes: 0, endFlush: () => {} };
  const calls: { resolve: (r: LoadedArticle) => void; reject: (e: any) => void }[] = []; let answered = 0;
  const s = new ArticleSync({
    load: () => new Promise<LoadedArticle>((resolve, reject) => { calls.push({ resolve, reject }); }),
    busy: () => app.busy, flush: () => { app.flushes++; return new Promise<void>(done => { app.endFlush = done; }); }, timers: ft.t,
  });
  return {
    s, ft, app, loads: () => calls.length, waiting: () => calls.length - answered,
    answer: async (article: Article, v: number) => { calls[answered++].resolve({ article, v }); await tick(); },
    fail: async (message = 'offline') => { calls[answered++].reject(new Error(message)); await tick(); },
    /** Open with the workspace saying `v`, and load that version. */
    ready: async (v: number, a = art('server')) => { s.sync(v); s.open(); calls[answered++].resolve({ article: a, v }); await tick(); },
  };
}

describe('ArticleSync: loading the open article', () => {
  it('opens with a skeleton, then shows the article', async () => {
    const h = harness(); h.s.sync(100); h.s.open();
    expect(h.s.state).toEqual({ status: 'loading', article: null, error: null });
    await h.answer(art('server'), 100);
    expect(h.s.state.status).toBe('ready'); expect(angle(h.s)).toBe('server');
    expect(h.loads()).toBe(1); // the workspace saying the same v again asks for nothing
    h.s.sync(100); expect(h.loads()).toBe(1);
  });

  it('leaving and coming straight back: pending saves are flushed and finished before the article is fetched', async () => {
    const h = harness(); h.app.busy = true; // a save typed a moment ago is still waiting for its debounce
    h.s.sync(100); h.s.open();
    expect(h.app.flushes).toBe(1); expect(h.loads()).toBe(0);
    h.ft.fire(); expect(h.loads()).toBe(0);     // the short timer does not jump ahead of the save
    h.app.busy = false; h.app.endFlush(); await tick();
    expect(h.loads()).toBe(1);                   // only now: the fetched copy includes the save
    await h.answer(art('typed before leaving'), 110);
    expect(angle(h.s)).toBe('typed before leaving');
  });

  it('a failed first load shows the error; Retry loads it', async () => {
    const h = harness(); h.s.sync(100); h.s.open();
    await h.fail('Radar couldn’t finish this. Try again.');
    expect(h.s.state).toEqual({ status: 'error', article: null, error: 'Radar couldn’t finish this. Try again.' });
    h.s.reload(); expect(h.s.state.status).toBe('loading');
    await h.answer(art('server'), 100);
    expect(h.s.state.status).toBe('ready');
  });

  it('a failed background reload keeps the article on screen and retries a few times, then waits for the next change', async () => {
    const h = harness(); await h.ready(100); type(h.s, 'mine');
    h.s.reload(); await h.fail();
    expect(h.s.state.status).toBe('ready'); expect(angle(h.s)).toBe('mine');
    for (let i = 0; i < RELOAD_RETRIES; i++) { h.ft.fire(); await h.fail(); }
    expect(h.ft.pending()).toEqual([]); expect(h.s.state.status).toBe('ready');
    h.s.sync(100); expect(h.waiting()).toBe(1); // the next revision change tries again
  });

  it('a response that arrives after the article was closed is ignored', async () => {
    const h = harness(); h.s.sync(100); h.s.open(); let told = 0; h.s.subscribe(() => { told++; });
    h.s.dispose(); await h.answer(art('late'), 100);
    expect(h.s.state.status).toBe('loading'); expect(told).toBe(0);
  });
});

describe('Pending (useApp().busy) with the real debounce queue', () => {
  const deferred = () => { let resolve!: () => void; const p = new Promise<void>(r => { resolve = r; }); return { p, resolve }; };
  /** `act` as app.tsx counts it: in flight from the moment the request starts until it settles. */
  function app() {
    const ft = fakeTimers(); const q = new LaterQueue(ft.t); let inflight = 0; const pending = new Pending(q, () => inflight);
    const save = (d: { p: Promise<void> }) => async () => { inflight++; try { await d.p; } finally { inflight--; } };
    return { ft, q, pending, save, inflight: () => inflight };
  }

  it('is busy while a save waits for its debounce, while it is in flight, and idle after', async () => {
    const a = app(); const d = deferred();
    expect(a.pending.busy).toBe(false);
    a.q.schedule('angle', 600, a.save(d)); expect(a.pending.busy).toBe(true);
    a.ft.fire(); await tick(); expect(a.inflight()).toBe(1); expect(a.pending.busy).toBe(true);
    d.resolve(); await tick(); expect(a.pending.busy).toBe(false);
  });

  it('stays busy through a flush: there is no idle moment between the save leaving the queue and its request starting', async () => {
    const a = app(); const d = deferred();
    a.q.schedule('angle', 600, a.save(d));
    const flushed = a.pending.flush();
    expect(a.q.size).toBe(0); expect(a.inflight()).toBe(0); // out of the queue, request not started yet
    expect(a.pending.busy).toBe(true);
    await tick(); expect(a.inflight()).toBe(1);
    d.resolve(); await flushed; expect(a.pending.busy).toBe(false);
  });

  it('an article opened in that moment (leave and come straight back) is fetched only after the flushed save has finished', async () => {
    const a = app(); const d = deferred(); const order: string[] = [];
    a.q.schedule('angle', 600, async () => { await a.save(d)(); order.push('save done'); });
    const open = () => { const s = new ArticleSync({ load: () => { order.push('article.get'); return new Promise<LoadedArticle>(() => {}); }, busy: () => a.pending.busy, flush: () => a.pending.flush(), timers: a.ft.t }); s.sync(100); s.open(); return s; };
    open().dispose(); open(); // twice, as React's development double-mount does
    await tick(); a.ft.fire(); await tick();
    expect(order).toEqual([]); // still saving: nothing fetched, not even by the recheck timer
    d.resolve(); for (let i = 0; i < 6; i++) await tick();
    expect(order).toEqual(['save done', 'article.get']); // straight after the flush, without waiting for the recheck timer
  });
});

describe('ArticleSync: no lost or clobbered edits (LS-4)', () => {
  it('a teammate’s save reaches an open article that has no unsaved changes', async () => {
    const h = harness(); await h.ready(100);
    h.s.sync(200);                               // the workspace refreshed after the teammate's save: v changed
    expect(h.waiting()).toBe(1);
    await h.answer(art('teammate'), 200);
    expect(angle(h.s)).toBe('teammate');
  });

  it('typing while a reload is in flight is not overwritten; the reload is taken again once the save is done', async () => {
    const h = harness(); await h.ready(100);
    h.s.sync(200); expect(h.waiting()).toBe(1);  // reload for the teammate's save is out
    type(h.s, 'mine'); h.app.busy = true;        // the user types: the save is now waiting for its debounce
    await h.answer(art('teammate'), 200);        // the stale copy arrives
    expect(angle(h.s)).toBe('mine');
    h.ft.fire(); expect(h.waiting()).toBe(0);    // still saving: nothing is fetched
    h.app.busy = false; h.s.saved({ prev: 200, v: 210 }); // my save merged onto the teammate's version server-side
    h.ft.fire(); expect(h.waiting()).toBe(1);
    await h.answer(art('mine', { seo: { title: 'teammate title', meta: '', slug: 's' } }), 210);
    expect(angle(h.s)).toBe('mine'); expect(h.s.state.article!.seo.title).toBe('teammate title');
  });

  it('typing that was already saved by the time the reload arrives still wins over that older copy', async () => {
    const h = harness(); await h.ready(100);
    h.s.sync(200);
    type(h.s, 'mine');                           // typed and saved (not busy any more) while the request was out
    await h.answer(art('teammate'), 200);
    expect(angle(h.s)).toBe('mine');
    h.ft.fire(); await h.answer(art('mine'), 210);
    expect(angle(h.s)).toBe('mine');
  });

  it('a write without a local edit (a new cover style) that starts while a reload is out also drops that copy', async () => {
    const h = harness(); await h.ready(100);
    h.s.sync(200); expect(h.waiting()).toBe(1);
    h.app.busy = true;                           // the style save is in flight; the copy on its way may predate it
    await h.answer(art('before the style change'), 200);
    expect(angle(h.s)).toBe('server');
    h.app.busy = false; h.ft.fire(); await h.answer(art('after the style change'), 210);
    expect(angle(h.s)).toBe('after the style change');
  });

  it('a teammate’s save does not touch an article with unsaved changes, and arrives after the save completes', async () => {
    const h = harness(); await h.ready(100);
    type(h.s, 'mine'); h.app.busy = true;
    h.s.sync(200);                               // teammate saved; this tab is dirty
    expect(h.loads()).toBe(1); expect(h.ft.pending()).toEqual([RECHECK_MS]); // held back, to be looked at again shortly
    h.ft.fire(); h.s.sync(200); expect(h.loads()).toBe(1);   // neither the timer nor a revision change fetches while dirty
    h.app.busy = false;
    h.s.sync(200);                               // the next revision change (it could equally be the timer) looks again
    expect(h.waiting()).toBe(1);
    await h.answer(art('mine + teammate'), 210);
    expect(angle(h.s)).toBe('mine + teammate');
  });

  it('a held-back reload is picked up by the short timer alone, without any further revision change', async () => {
    const h = harness(); await h.ready(100);
    h.app.busy = true; h.s.sync(200); expect(h.loads()).toBe(1);
    h.app.busy = false; h.ft.fire();
    expect(h.waiting()).toBe(1);
  });

  it('my own saves never trigger a reload: revision changes with the same v, and a v my save produced', async () => {
    const h = harness(); await h.ready(100);
    type(h.s, 'mine');
    h.s.sync(100); h.s.sync(100);                // revision-only replies: the workspace's v does not move
    h.s.saved({ prev: 100, v: 110 });            // the save replaced exactly the version on screen
    h.s.sync(110);                               // a later full workspace shows my v
    h.ft.fire();
    expect(h.loads()).toBe(1); expect(angle(h.s)).toBe('mine');
  });

  it('adopts a save’s v only when it replaced the version on screen: a teammate’s save in between schedules a reload', async () => {
    const h = harness(); await h.ready(100);
    type(h.s, 'mine');
    h.s.saved({ prev: 105, v: 110 });            // 105 was a teammate's save between my load and my save
    expect(h.loads()).toBe(1); expect(h.ft.pending()).toEqual([RECHECK_MS]);
    h.ft.fire(); expect(h.waiting()).toBe(1);
    await h.answer(art('mine + teammate'), 110);
    expect(angle(h.s)).toBe('mine + teammate');
    h.s.sync(110); h.ft.fire(); expect(h.loads()).toBe(2); // and that is the end of it
  });

  it('two of my saves answered out of order are both mine: no reload', async () => {
    const h = harness(); await h.ready(100);
    h.s.saved({ prev: 110, v: 120 });            // the second save's reply first
    h.s.saved({ prev: 100, v: 110 });
    h.ft.fire(); h.s.sync(120); h.ft.fire();
    expect(h.loads()).toBe(1);
  });

  it('a fetched copy newer than a workspace that has not refreshed yet does not loop', async () => {
    const h = harness(); h.s.sync(50); h.s.open();
    await h.answer(art('server'), 100);          // the article moved on; the workspace still says 50
    h.s.sync(50); h.ft.fire(); expect(h.loads()).toBe(1);
    h.s.sync(100); expect(h.loads()).toBe(1);    // the workspace catches up to what is on screen
  });

  it('a change that lands while a load is out is fetched afterwards', async () => {
    const h = harness(); h.s.sync(100); h.s.open();
    h.s.sync(200);                               // the workspace moved while the first request was out
    await h.answer(art('older'), 100);
    expect(h.waiting()).toBe(1);
    await h.answer(art('newer'), 200);
    expect(angle(h.s)).toBe('newer'); expect(h.loads()).toBe(2);
  });
});

describe('ArticleSync: server-side changes this tab cannot derive', () => {
  it('reload() fetches again although the workspace’s v has not changed, and waits for typing to be saved', async () => {
    const h = harness(); await h.ready(100, art('server', { generated: false }));
    h.s.reload(); await h.answer(art('server', { draftedAt: '2026-11-10T10:00:00.000Z' }), 150);
    expect(h.s.state.article!.draftedAt).toBe('2026-11-10T10:00:00.000Z');
    h.app.busy = true; h.s.reload(); expect(h.loads()).toBe(2);
    h.app.busy = false; h.ft.fire(); expect(h.loads()).toBe(3);
  });

  it('a finished draft job asks for a reload until the article on screen is that draft', () => {
    const done = { status: 'done', result: { draftedAt: '2026-11-10T10:00:00.000Z' } };
    expect(draftLanded(done, art('a', { draftedAt: null }))).toBe(true);
    expect(draftLanded(done, art('a', { draftedAt: '2026-11-09T08:00:00.000Z' }))).toBe(true);   // Rewrite from brief
    expect(draftLanded(done, art('a', { draftedAt: '2026-11-10T10:00:00.000Z' }))).toBe(false);  // landed
    expect(draftLanded({ status: 'running', result: null }, art('a'))).toBe(false);
    expect(draftLanded({ status: 'done' }, art('a'))).toBe(false);   // a snapshot job without its result
    expect(draftLanded(done, null)).toBe(false);                     // nothing loaded yet: the first load brings it
  });

  it('a finished body-image job asks for a reload until the article on screen has that image set', () => {
    const done = { status: 'done', result: { bodyImagesGeneratedAt: '2026-11-10T10:00:00.000Z' } };
    expect(bodyImagesLanded(done, art('a'))).toBe(true);
    expect(bodyImagesLanded(done, art('a', { bodyImagesGeneratedAt: '2026-11-01T00:00:00.000Z' }))).toBe(true);
    expect(bodyImagesLanded(done, art('a', { bodyImagesGeneratedAt: '2026-11-10T10:00:00.000Z' }))).toBe(false);
    expect(bodyImagesLanded({ status: 'failed', result: { error: 'x' } }, art('a'))).toBe(false);
    expect(bodyImagesLanded(done, null)).toBe(false);
  });
});
