import { reportFailure, type FailureContext } from '@/server/observability/failures';
import type { Profile } from '@/lib/types';
import type { ScanMode } from '@/features/brief/model';
import type { Candidate, Plan } from '../plan';

export interface SourceCtx {
  plan: Plan; profile: Profile; bid: string; mode: ScanMode;
  /** Scan round of the day (0 = the first scan): sources pick their queries with `queriesFor(plan.queries, n, round)`. */
  round?: number;
  /** Only collect threads posted after this (epoch ms) — about 48h back. */
  sinceMs: number;
  /** Background rescans: only threads posted after the previous scan (real-time sources). Only the X API source uses it:
   *  web search indexes posts late, and threads already seen today are dropped anyway. */
  newSinceMs?: number;
  /** Report threads/comments read (live counter). */
  onRead: (n: number) => void;
  /** Replace this platform's step sub line with the sources actually being read. */
  setSub: (s: string) => void;
}
export type Source = (ctx: SourceCtx) => Promise<Candidate[]>;

/** A platform source failed; the scan shows "{Platform} didn’t respond". */
export class SourceError extends Error { constructor(msg: string, cause?: unknown) { super(msg, { cause }); } }

export async function withRetry<T>(fn: () => Promise<T>, tries = 2, context?: FailureContext): Promise<T> {
  let last: any;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e: any) {
      last = e;
      const permanent = e?.permanent && e?.status !== 429;
      if (context) await reportFailure(e, { ...context, attempt: i + 1, maxAttempts: tries, retrying: !permanent && i + 1 < tries });
      if (permanent) break;
      await new Promise(r => setTimeout(r, 700 * (i + 1)));
    }
  }
  throw last;
}
