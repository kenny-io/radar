// Light fixture businesses for the wipe: a deleted business with one published article (cover kept), one draft (cover deleted) and a logo.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { db } from './lib.mjs'; import { ROOT } from './wipe-lib.mjs';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const put = key => { const f = path.join(ROOT, key); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, PNG); fs.writeFileSync(f + '.type', 'image/png'); return '/api/files/' + key; };
/** `purgeIn`: SQL interval from now to purge_at (negative = already due). `files:false` skips storage. */
export async function mkbiz(pool, ownerEmail, tag, purgeIn = "-1 hour", o = {}) {
  const id = crypto.randomUUID(); const owner = (await pool.query('select id from users where email=$1', [ownerEmail])).rows[0].id;
  await pool.query(`insert into businesses (id, owner_id, domain, status, deleted_at, purge_at, profile) values ($1, $2, $3, 'deleted', now() + $4::interval - interval '168 hours', now() + $4::interval, $5)`, [id, owner, `${tag}.test`, purgeIn, JSON.stringify({ domain: `${tag}.test`, business: { name: tag }, brand: {} })]);
  await pool.query("insert into members (business_id, user_id, email, role, status) values ($1, $2, $3, 'Owner', 'active')", [id, owner, ownerEmail]);
  const e1 = 'e_' + crypto.randomBytes(5).toString('hex'), e2 = 'e_' + crypto.randomBytes(5).toString('hex');
  await pool.query("insert into calendar_entries (id, business_id, title, kw, type, date, status, published_url) values ($1, $3, 'Published', 'kw', 'Guide', current_date - 20, 'published', 'https://x.test/p'), ($2, $3, 'Draft', 'kw', 'Guide', current_date + 5, 'review', null)", [e1, e2, id]);
  const kept = o.files === false ? `/api/files/${id}/hero/kept.png` : put(`${id}/hero/kept.png`), gone = o.files === false ? `/api/files/${id}/hero/draft.png` : put(`${id}/hero/draft.png`);
  if (o.files !== false) put(`${id}/logo/logo.png`);
  await pool.query("insert into articles (entry_id, business_id, data) values ($1, $3, $4), ($2, $3, $5)", [e1, e2, id, JSON.stringify({ generated: true, img: { url: kept }, bodyImages: o.broken ? 'not-a-list' : [] }), JSON.stringify({ generated: true, img: { url: gone }, bodyImages: [] })]);
  return id;
}
/** What is left of a fixture business: 'active' | 'deleted' | 'gone', the rows keyed to it, and its files. */
export async function state(pool, id) {
  const b = (await pool.query('select status from businesses where id=$1', [id])).rows[0];
  const rows = Number((await pool.query('select (select count(*) from members where business_id=$1) + (select count(*) from calendar_entries where business_id=$1) + (select count(*) from articles where business_id=$1) n', [id])).rows[0].n);
  const dir = path.join(ROOT, id); const fl = fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter(f => /\.png$/.test(f)).sort() : [];
  return { status: b?.status || 'gone', rows, files: fl.join(',') };
}
if (import.meta.url === 'file://' + process.argv[1]) {
  const pool = db(); const [owner, tag, n, purgeIn, broken] = process.argv.slice(2); const ids = [];
  for (let i = 0; i < Number(n); i++) ids.push(await mkbiz(pool, owner, `${tag}-${i}`, purgeIn || '-1 hour', { files: process.env.NOFILES ? false : true, broken: broken === 'broken' && i === 0 }));
  console.log(ids.join('\n')); await pool.end();
}
