// Grandfathering existing accounts (architecture §21.2, §16.14): the custom data migration 0008, and the optional lazy
// cutoff in ownAccess. The migration runs inside a transaction that is rolled back, so other rows are untouched.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { process.env.RADAR_DEV_STUBS = '1'; });

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db';
import { Fixtures } from '../testing/fixtures';
import { ownAccess } from './access';

const ON = !!process.env.DATABASE_URL;
const F = new Fixtures();
const MIGRATION = readFileSync(path.resolve(__dirname, '../../../drizzle/0008_grandfather.sql'), 'utf8');
const day = 864e5;
class Rollback extends Error {}
afterEach(() => { delete process.env.RADAR_BILLING; delete process.env.RADAR_BILLING_GRANDFATHER_BEFORE; });

describe.skipIf(!ON)('grandfather (database)', () => {
  afterAll(() => F.cleanup());

  it('0008 comps every owner of an active business at migration time, and only them; re-running is a no-op', async () => {
    const owner = await F.user(); await F.biz(owner);
    const lapsed = await F.user(); await F.biz(lapsed); await F.account(lapsed.id, { status: 'canceled', everSubscribed: true });
    const drafter = await F.user(); await F.biz(drafter, { status: 'onboarding' });
    const nobody = await F.user();
    const g = await F.user({ guest: true }); await F.biz(g);           // never happens in practice; excluded anyway
    const ids = [owner.id, lapsed.id, drafter.id, nobody.id, g.id];
    const seen: any[][] = [];
    await db.transaction(async tx => {
      for (let i = 0; i < 2; i++) {
        await tx.execute(sql.raw(MIGRATION));
        seen.push(await tx.select({ id: schema.billingAccounts.userId, comp: schema.billingAccounts.comp, reason: schema.billingAccounts.compReason, status: schema.billingAccounts.status })
          .from(schema.billingAccounts).where(inArray(schema.billingAccounts.userId, ids)));
      }
      throw new Rollback();
    }).catch(e => { if (!(e instanceof Rollback)) throw e; });
    const byId = (rows: any[]) => Object.fromEntries(rows.map(r => [r.id, r]));
    for (const rows of seen) {
      const m = byId(rows);
      expect(m[owner.id]).toMatchObject({ comp: true, reason: 'grandfather', status: 'none' });
      expect(m[lapsed.id]).toMatchObject({ comp: true, reason: 'grandfather', status: 'canceled' });
      expect(m[drafter.id]).toBeUndefined(); expect(m[nobody.id]).toBeUndefined(); expect(m[g.id]).toBeUndefined();
      expect(rows).toHaveLength(2);
    }
    // Rolled back: nothing persisted.
    expect((await db.select().from(schema.billingAccounts).where(eq(schema.billingAccounts.userId, owner.id)))).toHaveLength(0);
  });

  it('the lazy cutoff comps owners of businesses created before it, not after; a later cutoff re-applies; idempotent', async () => {
    process.env.RADAR_BILLING = 'on';
    const early = await F.user(); await F.biz(early, { createdAt: new Date(Date.now() - 10 * day) });
    const late = await F.user(); await F.biz(late, { createdAt: new Date(Date.now() - day) });
    expect(await ownAccess(early)).toBe(false);                            // unset: only migration rows count
    process.env.RADAR_BILLING_GRANDFATHER_BEFORE = new Date(Date.now() - 5 * day).toISOString();
    expect(await ownAccess(early)).toBe(true);
    expect(await ownAccess(early)).toBe(true);
    expect(await ownAccess(late)).toBe(false);
    const rows = await db.select().from(schema.billingAccounts).where(inArray(schema.billingAccounts.userId, [early.id, late.id]));
    expect(rows.map(r => [r.userId, r.comp, r.compReason])).toEqual([[early.id, true, 'grandfather']]);
    process.env.RADAR_BILLING_GRANDFATHER_BEFORE = new Date().toISOString();  // moved later: now applies to `late` too
    expect(await ownAccess(late)).toBe(true);
    delete process.env.RADAR_BILLING_GRANDFATHER_BEFORE;
    expect(await ownAccess(late)).toBe(true);                               // the comp row stays once written
  });
});
