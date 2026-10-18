// Daily Brief — isomorphic helpers shared by the UI (features/brief) and the server (services/brief).
// No React and no server imports here.
import type { BriefItem, BriefPlatform } from '@/lib/types';
import { PORDER } from '@/lib/constants';

/** The variant the user currently sees: replies → 'help' | 'mention'; posts → the selected platform. */
export const variantOf = (it: BriefItem): string => (it.kind === 'reply' ? (it.mention ? 'mention' : 'help') : (it.pl || (it.plats || [])[0] || ''));
export const textOf = (it: BriefItem): string => {
  const v = variantOf(it);
  return (it.edits && it.edits[v]) ?? it.drafts[v] ?? Object.values(it.drafts)[0] ?? '';
};
export const isLive = (it: BriefItem) => it.st === 'open' || it.st === 'copied';

/** Steps of the scan, in the order the job runs them. */
export type ScanStepKey = BriefPlatform | 'rank' | 'draft' | 'done';
export interface ScanStep { k: ScanStepKey; sub: string }
/** `brief.scan` job progress (CONTRACTS: { step, threadsRead, failed? }). */
export interface BriefScanProgress {
  step: ScanStepKey;
  threadsRead: number;
  failed?: BriefPlatform | 'source';
  /** One entry per enabled platform (with the sources actually being read), then rank and draft. */
  steps?: ScanStep[];
  mode?: ScanMode;
  /** Background "keep partial results" runs — the UI never shows the scan view for them. */
  quiet?: boolean;
}
export type ScanMode = 'first' | 'again' | 'keep';
/** `brief.scan` job result. */
export interface BriefScanResult {
  mode: ScanMode;
  failed?: BriefPlatform | 'source';
  /** Replies (and posts on a first scan) added to the day. */
  added?: number;
  addedIds?: string[];
  /** scannedAt before this run ("since {time}") */
  since?: string | null;
  /** The user dismissed this failure ("Keep this morning’s brief" or "Try again"). */
  dismissed?: boolean;
  /** Candidates collected before the failing platform (kept only if the user chooses). */
  partial?: number;
}

export const RANK_SUB = 'By fit with your audience and how recently people replied';
export const DRAFT_SUB = 'From your Business Profile';

/** Platform order for an enabled set. */
export const enabledInOrder = (ps: BriefPlatform[]) => PORDER.filter(p => ps.includes(p));
