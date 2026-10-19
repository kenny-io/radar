// Server-sent events: workspace revisions, job progress and toasts for one business.
import { and, eq, gt, inArray, or, gte } from 'drizzle-orm';
import { db, schema } from '@/server/db';
import { requireRole, requireUser } from '@/server/access';
import { handle } from '@/server/http/handle';

export const dynamic = 'force-dynamic';
export const GET = handle(async (req: Request, { params }: { params: Promise<{ bid: string }> }) => {
  const { bid } = await params;
  const u = await requireUser();
  await requireRole(bid, u.id, 'Viewer');
  const enc = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(ctl) {
      const send = (event: string, data: any) => { if (!closed) ctl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); };
      let rev = -1; let since = new Date(); const jobSeen = new Map<string, string>(); const sentToasts = new Set<string>();
      const started = Date.now();
      req.signal.addEventListener('abort', () => { closed = true; });
      while (!closed && Date.now() - started < 4 * 60e3) {
        try {
          const b = (await db.select({ rev: schema.businesses.rev }).from(schema.businesses).where(eq(schema.businesses.id, bid)).limit(1))[0];
          if (b && b.rev !== rev) { if (rev !== -1) send('rev', { rev: b.rev }); rev = b.rev; }
          const js = await db.select({ id: schema.jobs.id, kind: schema.jobs.kind, status: schema.jobs.status, progress: schema.jobs.progress, error: schema.jobs.error, ref: schema.jobs.ref, result: schema.jobs.result, createdAt: schema.jobs.createdAt })
            .from(schema.jobs).where(and(eq(schema.jobs.businessId, bid), or(inArray(schema.jobs.status, ['queued', 'running']), gte(schema.jobs.finishedAt, new Date(Date.now() - 15000)))));
          for (const j of js) { const sig = j.status + JSON.stringify(j.progress); if (jobSeen.get(j.id) !== sig) { jobSeen.set(j.id, sig); send('job', { ...j, result: j.status === 'done' || j.status === 'failed' ? j.result : null }); } }
          const ns = await db.select().from(schema.notifications).where(and(eq(schema.notifications.businessId, bid), gt(schema.notifications.createdAt, since))).orderBy(schema.notifications.createdAt);
          for (const n of ns) { if (sentToasts.has(n.id)) continue; sentToasts.add(n.id); send('toast', { id: n.id, ...n.payload }); }
          if (ns.length) since = new Date(Math.max(since.getTime(), ns[ns.length - 1].createdAt.getTime() - 1));
          send('ping', {});
        } catch { /* transient */ }
        await new Promise(r => setTimeout(r, 600));
      }
      try { ctl.close(); } catch { /* */ }
    },
    cancel() { closed = true; },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' } });
});
