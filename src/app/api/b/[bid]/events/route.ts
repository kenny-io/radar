// Server-sent events: workspace revisions, job progress and toasts for one business.
import { gateBusiness, requireActor, requireRole } from '@/server/access';
import { handle } from '@/server/http/handle';
import { workspaceEvents } from '@/server/events/workspace';

export const dynamic = 'force-dynamic';
export const GET = handle(async (req: Request, { params }: { params: Promise<{ bid: string }> }) => {
  const { bid } = await params;
  const u = await requireActor();
  await requireRole(bid, u.id, 'Viewer');
  await gateBusiness(u, bid);
  const enc = new TextEncoder();
  let closed = req.signal.aborted;
  const stream = new ReadableStream({
    async start(ctl) {
      const send = (event: string, data: any) => { if (!closed) ctl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); };
      let rev = -1; let since = Date.now(); const jobSeen = new Map<string, string>(); const sentToasts = new Set<string>();
      const started = Date.now(); let checked = started; let pinged = 0;
      const abort = () => { closed = true; };
      req.signal.addEventListener('abort', abort, { once: true });
      try {
        while (!closed && Date.now() - started < 4 * 60e3) {
          // Long-lived streams must not retain membership/access after it is revoked.
          if (Date.now() - checked >= 60_000) {
            try {
              const actor = await requireActor();
              if (actor.id !== u.id) break;
              await requireRole(bid, actor.id, 'Viewer');
              await gateBusiness(actor, bid);
              checked = Date.now();
            } catch { break; }
          }
          let active = false;
          try {
            const snapshot = await workspaceEvents(bid);
            if (snapshot.rev === undefined) break;
            if (snapshot.rev !== rev) { if (rev !== -1) send('rev', { rev: snapshot.rev }); rev = snapshot.rev; }
            const present = new Set(snapshot.jobs.map(j => j.id));
            for (const id of jobSeen.keys()) if (!present.has(id)) jobSeen.delete(id);
            for (const j of snapshot.jobs) {
              if (j.status === 'queued' || j.status === 'running') active = true;
              const sig = j.status + JSON.stringify(j.progress);
              if (jobSeen.get(j.id) !== sig) {
                jobSeen.set(j.id, sig);
                send('job', { ...j, result: j.status === 'done' || j.status === 'failed' ? j.result : null });
              }
            }
            for (const n of snapshot.notifications) {
              if (n.createdAt.getTime() < since || sentToasts.has(n.id)) continue;
              sentToasts.add(n.id); send('toast', { id: n.id, ...n.payload });
            }
            if (snapshot.notifications.length) since = Math.max(since, snapshot.notifications[snapshot.notifications.length - 1].createdAt.getTime() - 1);
          } catch { /* transient database failure: leave the stream alive and retry */ }
          if (Date.now() - pinged >= 15_000) { send('ping', {}); pinged = Date.now(); }
          await new Promise<void>(resolve => {
            const done = () => { clearTimeout(timer); req.signal.removeEventListener('abort', done); resolve(); };
            const timer = setTimeout(done, active ? 1500 : 5000);
            req.signal.addEventListener('abort', done, { once: true });
            if (req.signal.aborted) done();
          });
        }
      } finally {
        req.signal.removeEventListener('abort', abort);
        try { ctl.close(); } catch { /* client already closed */ }
      }
    },
    cancel() { closed = true; },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' } });
});
