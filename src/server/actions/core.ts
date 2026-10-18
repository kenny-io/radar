// Core actions shared by every screen.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { action, type ActionMap } from './define';
import { db, schema } from '../db';
import { getJob } from '../jobs/queue';

export const actions: ActionMap = {
  /** Read a job's current state (progress UIs that missed SSE). */
  'job.get': action({ read: true, role: 'Viewer', input: z.object({ id: z.string().uuid() }), run: async (ctx, { id }) => {
    const j = await getJob(id);
    if (!j || j.businessId !== ctx.bid) return null;
    return { id: j.id, kind: j.kind, status: j.status, progress: j.progress, result: j.result, error: j.error };
  } }),
};
export { and, eq, db, schema };
