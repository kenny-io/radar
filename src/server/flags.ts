// Feature flags evaluated per business. RADAR_SOCIAL_PUBLISHING (architecture.md §8): empty/unset/'off' → off everywhere;
// 'all' → on everywhere; otherwise a comma-separated list of business ids and/or owner emails (case-insensitive).
// Read at call time (not frozen in env) so a deploy-time change and tests both see the current value.
import { eq } from 'drizzle-orm';
import { db, schema } from './db';

const list = () => (process.env.RADAR_SOCIAL_PUBLISHING || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

/** Posting from Radar (connected X / LinkedIn accounts) for this business. */
export function socialPublishing(b: { id: string; ownerEmail?: string | null }): boolean {
  const l = list();
  if (!l.length || (l.length === 1 && l[0] === 'off')) return false;
  if (l.includes('all')) return true;
  return l.includes(b.id.toLowerCase()) || (!!b.ownerEmail && l.includes(b.ownerEmail.toLowerCase()));
}
/** Same, for a business row: looks up the owner's email only when the list names emails. */
export async function socialOn(b: { id: string; ownerId: string }): Promise<boolean> {
  const l = list();
  if (!l.some(x => x.includes('@'))) return socialPublishing({ id: b.id });
  const u = (await db.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, b.ownerId)).limit(1))[0];
  return socialPublishing({ id: b.id, ownerEmail: u?.email || null });
}
