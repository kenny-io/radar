// QA helper: print what a queued/logged lifecycle mail holds (the app's own decrypt and renderer; local database only).
import pg from 'pg';
import { decrypt } from '../../../../src/server/crypto';
import { renderLifecycle } from '../../../../src/server/services/lifecycle/templates';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(`select id, type, status, payload_enc from lifecycle_emails where type = $1 order by created_at desc limit 5`, [process.argv[2] || 'business_deleted']);
for (const r of rows) {
  const p: any = decrypt(r.payload_enc);
  console.log('──', r.id, r.type, r.status);
  console.log('payload keys:', Object.keys(p), '| envelope keys:', p.envelope && Object.keys(p.envelope));
  console.log('to:', p.envelope?.to, '| subject:', p.envelope?.subject);
  console.log('data:', JSON.stringify(p.data));
  console.log('TEXT:\n' + (p.envelope?.text ?? '(rendered at send time)'));
  const links = [...String(p.envelope?.html || '').matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  console.log('html links:', [...new Set(links)].join(' , '));
  if (!p.envelope?.text) { const out = renderLifecycle(r.type, p.data, { appUrl: process.env.APP_URL! }); console.log('RENDERED SUBJECT:', out.subject, '\nPREHEADER:', out.preheader, '\n' + out.text); }
}
await pool.end();
