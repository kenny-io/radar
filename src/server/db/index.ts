import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

const g = globalThis as unknown as { __radarPool?: pg.Pool };
export const pool = g.__radarPool ?? new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/radar',
  max: Number(process.env.DB_POOL_MAX || 10),
});
if (process.env.NODE_ENV !== 'production') g.__radarPool = pool;

export const db = drizzle(pool, { schema });
export type DB = typeof db;
export { schema };
