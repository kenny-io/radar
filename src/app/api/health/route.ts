import { pool } from '@/server/db';
import { coalescedReads } from '@/server/events/cache';

export const dynamic = 'force-dynamic';
const ready = coalescedReads(async () => {
  try {
    const probe = { text: 'SELECT 1', query_timeout: 2000 };
    await pool.query(probe);
    return true;
  } catch { return false; }
}, 1000, 1);

/** Deployment readiness only. No configuration, credentials or database errors leave this endpoint. */
export async function GET() {
  const ok = await ready('database');
  return Response.json({ ok }, { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
