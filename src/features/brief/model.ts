// Daily Brief — isomorphic helpers shared by the UI (features/brief) and the server (services/brief).
// No React and no server imports here.
import type { BriefAccount, BriefItem, BriefPlatform, BriefSettings } from '@/lib/types';
import { BRIEF_DEFAULT, CO_PLATS, PORDER } from '@/lib/constants';

/** Missing acct = founder (items drafted before company accounts). */
export const acctOf = (it: Pick<BriefItem, 'acct'>): BriefAccount => it.acct || 'founder';
/** Accounts the brief drafts for (at least one; default both). */
export const accountsOf = (s: Pick<BriefSettings, 'accounts'>): BriefAccount[] => {
  const a = (s.accounts || BRIEF_DEFAULT.accounts).filter(x => x === 'founder' || x === 'company');
  return a.length ? a : BRIEF_DEFAULT.accounts;
};
/** Platforms an account drafts on: the company only on X and LinkedIn. */
export const platsFor = (a: BriefAccount, ps: BriefPlatform[]) => (a === 'company' ? ps.filter(p => CO_PLATS.includes(p)) : ps);
/** The variant the user currently sees: founder replies → 'help' | 'mention'; company replies → 'brand'; posts → the selected platform. */
export const variantOf = (it: BriefItem): string => (it.kind === 'reply' ? (acctOf(it) === 'company' ? 'brand' : it.mention ? 'mention' : 'help') : (it.pl || (it.plats || [])[0] || ''));
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
  /** Background runs ("keep partial results", and the automatic 2-hourly rescans): the UI never switches to the scan
   *  view for them on its own. A Scan again click that joins one still shows its progress. */
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
  /** The server already toasted every member "{n} new conversations since {time}" (background rescans and Keep runs),
   *  so a Scan again click that joined this job shows no second toast. */
  notified?: boolean;
  /** A background rescan that did nothing: today's brief is missing, or the day ended before it ran. */
  skipped?: 'no_day' | 'past';
}

export const RANK_SUB = 'By fit with your audience and how recently people replied';
export const DRAFT_SUB = 'From your Business Profile';
export const DRAFT_SUB_BOTH = 'Personal angles for you, company angles for the brand';
export const DRAFT_SUB_CO = 'Company angles for the brand';

/** Platform order for an enabled set. */
export const enabledInOrder = (ps: BriefPlatform[]) => PORDER.filter(p => ps.includes(p));
