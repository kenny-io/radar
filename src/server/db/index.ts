import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

const g = globalThis as unknown as { __radarPool?: pg.Pool };
const configuredMax = Number(process.env.DB_POOL_MAX || 10);
export const pool = g.__radarPool ?? new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/radar',
  max: Number.isInteger(configuredMax) && configuredMax > 0 && configuredMax <= 100 ? configuredMax : 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30_000,
});
// An idle connection can fail during database maintenance. Without a listener pg emits an uncaught error.
if (!pool.listenerCount('error')) pool.on('error', () => console.error('[db] idle connection failed; the pool will reconnect'));
// Next can load database code from several route bundles; the connection budget is per process.
g.__radarPool = pool;

export const db = drizzle(pool, { schema });
export type DB = typeof db;
export { schema };
