// QA helper: read the newest dev-stub capture of an auth mail for one address (the app's own decrypt, local database only).
import pg from 'pg';
import { decrypt } from '../../../../src/server/crypto';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(`select text from outbox_emails where "to"=$1 and text like 'encrypted-auth:%' order by created_at desc limit 1`, [process.argv[2]]);
if (rows[0]) console.log((decrypt<{ text: string }>(rows[0].text.slice('encrypted-auth:'.length)) as any).text);
await pool.end();
