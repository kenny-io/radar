import type { z } from 'zod';
import type { Role, User } from '@/lib/types';
import type { BizRow } from '../workspace';

export interface ActCtx {
  user: User; bid: string; role: Role; biz: BizRow;
  /** Set by the act route (architecture §4.4). Absent when a test or script calls run() directly. */
  actor?: { guest: boolean; ownAccess: boolean };
  /** Client IP (abuse/ip.ts), for rate limits. */
  ip?: string;
}
export interface ActionDef<I = any, O = any> {
  /** Minimum role. Default 'Editor' for writes, 'Viewer' for reads. */
  role?: Role;
  input?: z.ZodType<I>;
  /** Read-only: no rev bump, no workspace in the response. */
  read?: boolean;
  run: (ctx: ActCtx, input: I) => Promise<O>;
}
export const action = <I, O>(d: ActionDef<I, O>) => d;
export type ActionMap = Record<string, ActionDef>;
