import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './index';

async function main() {
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations applied');
  const { backfillEvents } = await import('../events-backfill');
  console.log(`Impact events backfilled: ${await backfillEvents()}`);
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
