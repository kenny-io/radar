// A content snapshot of one business: every row keyed to it, as text, hashed per table. Used to compare before a delete and after a restore.
import crypto from 'node:crypto';
export async function snapshot(pool, bid) {
  const tabs = (await pool.query("select table_name from information_schema.columns where table_schema='public' and column_name='business_id' order by 1")).rows.map(r => r.table_name);
  const out = {};
  for (const t of tabs) {
    const { rows } = await pool.query(`select t::text as r from "${t}" t where business_id = $1 order by 1`, [bid]);
    out[t] = { n: rows.length, h: crypto.createHash('sha1').update(rows.map(r => r.r).join('\n')).digest('hex').slice(0, 12) };
  }
  const b = (await pool.query("select (to_jsonb(b) - 'status' - 'rev' - 'updated_at' - 'deleted_at' - 'purge_at' - 'last_active_at')::text r, status, rev, deleted_at, purge_at from businesses b where id=$1", [bid])).rows[0];
  out.businesses = b ? { n: 1, h: crypto.createHash('sha1').update(b.r).digest('hex').slice(0, 12), status: b.status, rev: b.rev } : { n: 0 };
  return out;
}
