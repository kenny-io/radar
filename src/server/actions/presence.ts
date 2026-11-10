// OPT-F0 stub, filled by E1 (idle spend): the "a member is using the app" ping. .factory/first-five-optimizations/architecture.md §2.1.
import { z } from 'zod';
import { action, type ActionMap } from './define';

export const actions: ActionMap = {
  /** Declared read: it never changes the shared workspace (no rev bump, no workspace in the response). */
  'app.seen': action({ read: true, role: 'Viewer', input: z.object({}), run: async () => ({ ok: true as const }) }),
};
