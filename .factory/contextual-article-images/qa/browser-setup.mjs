// T4 QA browser checks, step 1: migrate QA's own database and seed synthetic accounts and articles.
//   node .factory/contextual-article-images/qa/browser-setup.mjs
// Database: radar_qa_app on the throwaway Postgres at 127.0.0.1:55432 (created by QA; nothing else is touched).
// Writes .data/contextual-article-images/qa/{local-env.json,fixture.json} (git-ignored, mode 600). Session tokens for the
// three synthetic users are generated here and stored only in fixture.json. Every provider key is blank: dev stubs,
// no email, no billing, no image model.
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import pg from 'pg';
import { createCanvas } from '@napi-rs/canvas';

const output = '.data/contextual-article-images/qa';
const PORT = 3217;
await fs.mkdir(output, { recursive: true, mode: 0o700 });
const blank = {};
for (const filename of ['.env.example']) {
  const source = await fs.readFile(filename, 'utf8').catch(() => '');
  for (const line of source.split('\n')) { const match = /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line); if (match) blank[match[1]] = ''; }
}
const environment = {
  ...blank, DATABASE_URL: 'postgres://postgres@127.0.0.1:55432/' + (process.env.QA_APP_DB || 'radar_qa_app'), NODE_ENV: 'development', RADAR_DEV_STUBS: '1', RADAR_BILLING: 'off',
  RADAR_SECRET_KEY: 'contextual-images-local-qa-' + crypto.randomBytes(8).toString('hex'), APP_URL: `http://localhost:${PORT}`, PORT: String(PORT),
  NEXT_DIST_DIR: '.next-qa-images', NEXT_TELEMETRY_DISABLED: '1', STORAGE_DIR: `${output}/uploads`, WORKER_CONCURRENCY: '2',
};
await fs.writeFile(`${output}/local-env.json`, JSON.stringify(environment), { mode: 0o600 });
const childEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ...environment };
const migration = spawnSync(process.execPath, ['--import', 'tsx', 'src/server/db/migrate.ts'], { env: childEnv, encoding: 'utf8' });
await fs.writeFile(`${output}/migration.log`, migration.stdout + migration.stderr);
if (migration.status !== 0) throw new Error('migration failed; see the git-ignored migration.log');

const db = new pg.Pool({ connectionString: environment.DATABASE_URL });
if ((await db.query("SELECT 1 FROM users WHERE email LIKE 'ctxqa-%' LIMIT 1")).rowCount) { console.log('Already seeded; fixture.json is unchanged.'); await db.end(); process.exit(0); }
const profile = (name, domain) => ({ domain, business: { name, description: 'Synthetic tenant-review business for a QA check.', offerings: ['Building reviews'], industry: 'Property reviews', positioning: 'Synthetic', differentiators: ['Synthetic'] }, audience: { segments: ['Tenants'], buyers: ['Tenants'], needs: ['Honest reviews'], competitors: [] }, keywords: { list: [] }, brand: { logo: null, primary: '#0B5FFF', secondary: '#FFB000', voice: 'Plain', language: 'English (US)', markets: ['United Arab Emirates'] } });
const users = {}; const sessions = {};
for (const role of ['Owner', 'Viewer', 'Outsider']) {
  users[role] = (await db.query('INSERT INTO users(name,email,email_verified_at) VALUES($1,$2,now()) RETURNING id,email', [`QA ${role}`, `ctxqa-${role.toLowerCase()}@test.local`])).rows[0];
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query("INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '2 days')", [crypto.createHash('sha256').update(token).digest('hex'), users[role].id]);
  sessions[role] = token;
}
const biz = async (owner, name, domain) => (await db.query("INSERT INTO businesses(owner_id,domain,status,profile,timezone) VALUES($1,$2,'active',$3,'UTC') RETURNING id", [owner.id, domain, profile(name, domain)])).rows[0];
const business = await biz(users.Owner, 'Lived QA', 'lived-qa.test');
const otherBusiness = await biz(users.Outsider, 'Elsewhere QA', 'elsewhere-qa.test');
for (const role of ['Owner', 'Viewer']) await db.query("INSERT INTO members(business_id,user_id,email,role,status) VALUES($1,$2,$3,$4,'active')", [business.id, users[role].id, users[role].email, role]);
await db.query("INSERT INTO members(business_id,user_id,email,role,status) VALUES($1,$2,$3,'Owner','active')", [otherBusiness.id, users.Outsider.id, users.Outsider.email]);
for (const b of [business, otherBusiness]) await db.query("INSERT INTO gsc_connections(business_id,status) VALUES($1,'skipped')", [b.id]).catch(() => {});

// Two flat PNGs stored the way the app stores body images, so the legacy article renders real files.
const picture = async (bid, name, colour) => { const c = createCanvas(1200, 675); const g = c.getContext('2d'); g.fillStyle = colour; g.fillRect(0, 0, 1200, 675); const dir = `${environment.STORAGE_DIR}/${bid}/article-body`; await fs.mkdir(dir, { recursive: true }); await fs.writeFile(`${dir}/${name}`, c.toBuffer('image/png')); await fs.writeFile(`${dir}/${name}.type`, 'image/png'); return `/api/files/${bid}/article-body/${name}`; };
const entry = (id, title, kw, status, bid = business.id) => db.query("INSERT INTO calendar_entries(id,business_id,title,kw,type,date,status,relevance) VALUES($1,$2,$3,$4,'Guide',current_date + 7,$5,'Synthetic QA entry')", [id, bid, title, kw, status]);
const entries = { wasl: 'e_ctxqa_wasl', general: 'e_ctxqa_general', stale: 'e_ctxqa_stale', legacyImages: 'e_ctxqa_legacy_images', legacyPlain: 'e_ctxqa_legacy_plain', other: 'e_ctxqa_other' };
// Not drafted, no article row: the app builds the default article (direction "Calm, editorial image about <keyword>").
await entry(entries.wasl, 'Wasl 611 Reviews: Tenant Ratings and What to Check First', 'wasl 611 reviews', 'approved');
await entry(entries.general, 'How to Read a Tenancy Contract Before You Sign', 'tenancy contract checklist', 'approved');
await entry(entries.stale, 'Princess Tower Reviews: What Tenants Say About Living There', 'princess tower reviews', 'approved');
// Saved before this change: none of the new fields anywhere.
const legacyBody = [['p', 'Marina Gate is a residential community beside the water. This synthetic article was stored before contextual images existed.'], ['h2', 'What tenants say about the flats'], ['p', 'Flats are bright and furnished. Tenants mention the balcony and the kitchen.'], ['h2', 'Getting around'], ['p', 'A tram stop is a short walk from the entrance.'], ['h2', 'What to check before you sign'], ['p', 'Read the deposit terms and visit the flat in person.']];
const legacy = (id, slug, extra) => ({ entryId: id, generated: true, body: legacyBody, brief: { angle: 'QA fixture', outline: ['What tenants say about the flats', 'Getting around', 'What to check before you sign'], words: 1400 }, seo: { title: 'Legacy synthetic article', meta: 'Legacy meta', slug }, img: { style: 'branded', seed: 1, prompt: 'Calm, editorial image about marina gate reviews', alt: 'Legacy cover alt', url: null, urlKey: null }, videos: [], videoMeta: [], sources: [], claims: [], draftedAt: '2026-11-01T00:00:00.000Z', ...extra });
await entry(entries.legacyImages, 'Marina Gate Reviews: A Legacy Article With Body Images', 'marina gate reviews', 'review');
const one = await picture(business.id, 'legacy-one.png', '#2E7D6B'); const two = await picture(business.id, 'legacy-two.png', '#B5651D');
await db.query('INSERT INTO articles(entry_id,business_id,data) VALUES($1,$2,$3)', [entries.legacyImages, business.id, legacy(entries.legacyImages, 'legacy-with-images', { bodyImages: [{ id: 'abi_legacy1', after: { heading: 'what tenants say about the flats', occurrence: 0, block: 1 }, url: one, alt: 'Legacy body picture one', prompt: 'Create a useful editorial visual', seed: 2 }, { id: 'abi_legacy2', after: { heading: 'getting around', occurrence: 0, block: 3 }, url: two, alt: 'Legacy body picture two', prompt: 'Create a useful editorial visual', seed: 3 }], bodyImagesGeneratedAt: '2026-11-01T00:00:00.000Z' })]);
await entry(entries.legacyPlain, 'Marina Gate Reviews: A Legacy Article Without Body Images', 'marina gate reviews', 'review');
await db.query('INSERT INTO articles(entry_id,business_id,data) VALUES($1,$2,$3)', [entries.legacyPlain, business.id, legacy(entries.legacyPlain, 'legacy-plain', {})]);
// Another business's article, for the tenant boundary.
await entry(entries.other, 'Elsewhere Tower Reviews', 'elsewhere tower reviews', 'review', otherBusiness.id);
await db.query('INSERT INTO articles(entry_id,business_id,data) VALUES($1,$2,$3)', [entries.other, otherBusiness.id, { ...legacy(entries.other, 'elsewhere', {}), img: { style: 'illustration', seed: 1, prompt: 'OTHER-TENANT-DIRECTION the lobby of Elsewhere Tower', promptBy: 'radar', alt: 'Other tenant alt', url: null, urlKey: null, placeholder: { reason: 'unavailable', at: '2026-11-12T00:00:00.000Z' } }, bodyImagesIssue: { reason: 'unavailable', at: '2026-11-12T00:00:00.000Z' } }]);
await fs.writeFile(`${output}/fixture.json`, JSON.stringify({ base: environment.APP_URL, businessId: business.id, otherBusinessId: otherBusiness.id, users, sessions, entries }), { mode: 0o600 });
await db.end();
console.log(`Seeded ${new URL(environment.DATABASE_URL).pathname.slice(1)}: business ${business.id} (owner, viewer), other business ${otherBusiness.id}, entries ${Object.values(entries).join(', ')}.`);
