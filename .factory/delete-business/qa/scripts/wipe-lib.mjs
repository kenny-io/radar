import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { snapshot } from './snap.mjs';
export const ROOT = '/Users/ekene/Downloads/design_handoff_radar/radar-push/.claude/worktrees/radar-delete-business-36eee1/.data/qa-uploads';
/** Every file under local storage: key → sha1 (symbolic links are listed as links, never followed). */
export function files(root = ROOT) {
  const out = {}; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); const k = path.relative(root, f); if (e.isSymbolicLink()) out[k] = 'symlink→' + fs.readlinkSync(f).replace(root + '/', ''); else if (e.isDirectory()) walk(f); else out[k] = crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 10); } };
  if (fs.existsSync(root)) walk(root); return out;
}
/** Every table in `public` with the number of rows whose text mentions `needle`. */
export async function mentions(pool, needle) {
  const tabs = (await pool.query("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1")).rows.map(r => r.table_name);
  const out = {};
  for (const t of tabs) { const n = Number((await pool.query(`select count(*) n from "${t}" t where t::text ilike $1`, ['%' + needle + '%'])).rows[0].n); if (n) out[t] = n; }
  return out;
}
export async function world(pool, ids) {
  const w = { biz: {} };
  for (const [name, id] of Object.entries(ids)) w.biz[name] = await snapshot(pool, id);
  for (const t of ['users', 'billing_accounts', 'billing_events', 'sessions', 'user_email_preferences', 'trial_fingerprints', 'outbox_emails']) w[t] = (await pool.query(`select count(*) n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) h from "${t}" x`).catch(() => ({ rows: [{ n: 'n/a', h: '' }] }))).rows[0];
  return w;
}
export const diffWorld = (a, b) => { const d = []; for (const n of Object.keys(a.biz)) for (const t of Object.keys(a.biz[n])) if (JSON.stringify(a.biz[n][t]) !== JSON.stringify(b.biz[n][t])) d.push(`${n}.${t} ${JSON.stringify(a.biz[n][t])}→${JSON.stringify(b.biz[n][t])}`); for (const t of Object.keys(a)) if (t !== 'biz' && JSON.stringify(a[t]) !== JSON.stringify(b[t])) d.push(`${t} ${JSON.stringify(a[t])}→${JSON.stringify(b[t])}`); return d; };
