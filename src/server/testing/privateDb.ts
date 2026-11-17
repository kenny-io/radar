// Test-only: a database of its own for a test file that must run database-wide code (every cron hook, as the scheduler
// runs them) without touching the rows of other test files that share DATABASE_URL. No app code imports this, and it must
// not import '../db': the caller points DATABASE_URL at the new database before the app's pool is created.
//   const H = await vi.hoisted(async () => { const p = await (await import('@/server/testing/privateDb')).privateDatabase(); return { p }; });
//   afterAll(async () => { await pool.end(); await H.p.drop(); });
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

export interface PrivateDatabase { /** false: the role may not create databases, so the shared one is used as it is */ isolated: boolean; drop: () => Promise<void> }

/** Create and migrate `<current>_t_<random>` and make it DATABASE_URL. Without DATABASE_URL it does nothing. */
export async function privateDatabase(): Promise<PrivateDatabase> {
  const shared = process.env.DATABASE_URL;
  if (!shared) return { isolated: false, drop: async () => {} };
  const name = `radar_t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const admin = new pg.Client({ connectionString: shared });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
  } catch (e: any) {
    console.warn(`[test] no private database (${String(e?.message || e).slice(0, 120)}); running on the shared one`);
    await admin.end().catch(() => {});
    return { isolated: false, drop: async () => {} };
  }
  await admin.end();
  const url = new URL(shared); url.pathname = '/' + name;
  const pool = new pg.Pool({ connectionString: url.href, max: 1 });
  try { await migrate(drizzle(pool), { migrationsFolder: './drizzle' }); } finally { await pool.end(); }
  process.env.DATABASE_URL = url.href;
  return {
    isolated: true,
    drop: async () => {
      const c = new pg.Client({ connectionString: shared });
      await c.connect();
      try { await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); } finally { await c.end(); }
    },
  };
}
