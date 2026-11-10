// The Dashboard's first-week rows (.factory/first-five-optimizations/architecture.md §1). The rows themselves come with
// the workspace (`firstRun`); these change them. Both are writes, so the act route bumps the revision for every member.
//   firstRun.retry   { key }  → { jobId }  — a failed row: enqueue its job again and track the new id. Any other row:
//                                            the job it already shows (null while the commit is still starting them)
//   firstRun.dismiss {}       → {}         — hide the rows for the business
import { z } from 'zod';
import { action, type ActionMap } from './define';
import { dismissFirstRun, retryFirstRun } from '../services/firstRun';

export const actions: ActionMap = {
  'firstRun.retry': action({ role: 'Editor', input: z.object({ key: z.enum(['calendar', 'brief', 'visibility']) }), run: async (ctx, { key }) => ({ jobId: await retryFirstRun(ctx.bid, key) }) }),
  'firstRun.dismiss': action({ role: 'Editor', input: z.object({}).optional(), run: async ctx => { await dismissFirstRun(ctx.bid); return {}; } }),
};
