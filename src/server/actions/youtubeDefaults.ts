import { z } from 'zod';
import { action, type ActionMap } from './define';
import { saveYouTubeDefaults } from '../services/social/publish/youtubeAutomation';
export const actions: ActionMap = {
  'social.youtubeDefaults': action({ role: 'Owner', input: z.object({ expectedVersion: z.string().uuid().nullable(), defaults: z.object({ acctId: z.string().uuid(), privacy: z.enum(['private', 'unlisted', 'public']), madeForKids: z.boolean() }).strict().nullable() }).strict(), run: (ctx, i) => saveYouTubeDefaults(ctx.bid, i.expectedVersion, i.defaults) }),
};
