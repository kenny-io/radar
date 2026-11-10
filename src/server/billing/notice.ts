// OPT-F0 stub, filled by E3 (billing + first session): one source for the grace banner and the trial chip. .factory/first-five-optimizations/architecture.md §5.
import type { BizRow } from '../workspace';
import type { Workspace } from '@/lib/types';

/** Undefined when billing is not enforced for the owner or the owner is comp. */
export async function billingNoticeOf(biz: Pick<BizRow, 'ownerId'>, userId: string): Promise<Workspace['billing']> {
  return undefined;
}
