// The "a member is using the app" ping (idle spend). .factory/first-five-optimizations/architecture.md §2.1.
import { z } from 'zod';
import { action, type ActionMap } from './define';
import { touchActive } from '../idle';

export const actions: ActionMap = {
  /** Sent by the app shell when a member opens or navigates it (client/seen.ts). The one read action that records use:
   *  the workspace GET and every other read also fire from background refreshes of an open tab, so they never do.
   *  Declared read: it never changes the shared workspace (no rev bump, no workspace in the response). */
  'app.seen': action({ read: true, role: 'Viewer', input: z.object({}), run: async ctx => { await touchActive(ctx.biz, { guest: ctx.actor?.guest ?? false }); return { ok: true as const }; } }),
};
