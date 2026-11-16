// QA helper: after a wipe, look inside the encrypted columns a plain text search cannot read (local database only).
import pg from 'pg';
import { decrypt } from '../../../../src/server/crypto';
const needles = process.argv.slice(2);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query('select id, type, status, business_id, payload_enc from lifecycle_emails');
let hits = 0;
for (const r of rows) { let t = ''; try { t = JSON.stringify(decrypt(r.payload_enc)); } catch { t = '(unreadable)'; } for (const n of needles) if (t.includes(n)) { hits++; console.log('lifecycle_emails', r.type, r.status, 'business_id column:', r.business_id, 'mentions', n); } }
console.log(`${rows.length} lifecycle mail payloads read, ${hits} mention(s)`);
await pool.end();
