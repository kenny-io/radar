// Inferred vs Edited (README §2.5 #3): Re-analyze replaces only fields not listed in `edited`, and never a user-uploaded logo.
import { PROFILE_FIELDS, type ProfileGroupKey } from '@/lib/constants';
import type { Edited, Profile } from '@/lib/types';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export function mergeAnalysis(cur: Profile, fresh: Profile, edited: Edited, keepEdits: boolean): Profile {
  const out = keepEdits ? clone(cur) : clone(fresh);
  if (keepEdits) {
    (Object.keys(PROFILE_FIELDS) as ProfileGroupKey[]).forEach(g => {
      (out as any)[g] ??= {};
      for (const k of PROFILE_FIELDS[g]) if (!edited[`${g}.${k}`]) (out as any)[g][k] = clone((fresh as any)[g][k]);
    });
  }
  if (cur?.brand?.logoUploaded && cur.brand.logo) { out.brand.logo = cur.brand.logo; out.brand.logoUploaded = true; }
  else if (!keepEdits || !edited['brand.logo']) out.brand.logoUploaded = false;
  out.domain = fresh.domain;
  return out;
}

/** Number of edits kept (for "Your {n} edits were kept." / "N edits will be kept"). */
export const editCount = (edited: Edited) => Object.keys(edited || {}).length;
