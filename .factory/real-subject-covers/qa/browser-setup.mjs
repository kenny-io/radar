// T4 QA browser checks, step 1: migrate QA's own database and seed synthetic accounts and articles.
//   node .factory/real-subject-covers/qa/browser-setup.mjs
// Database: radar_qa_app on the throwaway Postgres at 127.0.0.1:55442 (created by QA; nothing else is touched).
// Writes .data/real-subject-covers/qa/{local-env.json,fixture.json} (git-ignored, mode 600). Session tokens for the
// synthetic users are generated here and stored only in fixture.json. Every provider key is blank: dev stubs,
// no email, no billing, no image model. The business's site is the dev stub site (no request leaves the machine).
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import pg from 'pg';
import { createCanvas } from '@napi-rs/canvas';

const output = '.data/real-subject-covers/qa';
const PORT = 3231;
await fs.mkdir(output, { recursive: true, mode: 0o700 });
const blank = {};
for (const line of (await fs.readFile('.env.example', 'utf8').catch(() => '')).split('\n')) { const match = /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line); if (match) blank[match[1]] = ''; }
const environment = {
  ...blank, DATABASE_URL: 'postgres://postgres@127.0.0.1:55442/radar_qa_app', NODE_ENV: 'development', RADAR_DEV_STUBS: '1', RADAR_BILLING: 'off',
  RADAR_SECRET_KEY: 'real-covers-local-qa-' + crypto.randomBytes(8).toString('hex'), APP_URL: `http://localhost:${PORT}`, PORT: String(PORT),
  NEXT_DIST_DIR: '.next-qa-realcover', NEXT_TELEMETRY_DISABLED: '1', STORAGE_DIR: `${output}/uploads`, WORKER_CONCURRENCY: '2',
};
await fs.writeFile(`${output}/local-env.json`, JSON.stringify(environment), { mode: 0o600 });
const childEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ...environment };
const migration = spawnSync(process.execPath, ['--import', 'tsx', 'src/server/db/migrate.ts'], { env: childEnv, encoding: 'utf8' });
await fs.writeFile(`${output}/migration.log`, migration.stdout + migration.stderr);
if (migration.status !== 0) throw new Error('migration failed; see the git-ignored migration.log');

const db = new pg.Pool({ connectionString: environment.DATABASE_URL });
if ((await db.query("SELECT 1 FROM users WHERE email LIKE 'rcqa-%' LIMIT 1")).rowCount) { console.log('Already seeded; fixture.json is unchanged.'); await db.end(); process.exit(0); }
const profile = (name, domain) => ({ domain, business: { name, description: 'Synthetic short-let business for a QA check.', offerings: ['Short lets'], industry: 'Hospitality', positioning: 'Synthetic', differentiators: ['Synthetic'] }, audience: { segments: ['Travellers'], buyers: ['Guests'], needs: ['A place to stay'], competitors: [] }, keywords: { list: [] }, brand: { logo: null, primary: '#0B5FFF', secondary: '#FFB000', voice: 'Plain', language: 'English (US)', markets: ['United Kingdom'] } });
const users = {}; const sessions = {};
for (const role of ['Owner', 'Editor', 'Viewer', 'Outsider']) {
  users[role] = (await db.query('INSERT INTO users(name,email,email_verified_at) VALUES($1,$2,now()) RETURNING id,email', [`QA ${role}`, `rcqa-${role.toLowerCase()}@test.local`])).rows[0];
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query("INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '2 days')", [crypto.createHash('sha256').update(token).digest('hex'), users[role].id]);
  sessions[role] = token;
}
const biz = async (owner, name, domain) => (await db.query("INSERT INTO businesses(owner_id,domain,status,profile,timezone) VALUES($1,$2,'active',$3,'UTC') RETURNING id", [owner.id, domain, profile(name, domain)])).rows[0];
const DOMAIN = 'harbour-stays-qa.test';
const business = await biz(users.Owner, 'Harbour Stays QA', DOMAIN);
const otherBusiness = await biz(users.Outsider, 'Elsewhere QA', 'elsewhere-qa.test');
for (const role of ['Owner', 'Editor', 'Viewer']) await db.query("INSERT INTO members(business_id,user_id,email,role,status) VALUES($1,$2,$3,$4,'active')", [business.id, users[role].id, users[role].email, role]);
await db.query("INSERT INTO members(business_id,user_id,email,role,status) VALUES($1,$2,$3,'Owner','active')", [otherBusiness.id, users.Outsider.id, users.Outsider.email]);
for (const b of [business, otherBusiness]) await db.query("INSERT INTO gsc_connections(business_id,status) VALUES($1,'skipped')", [b.id]).catch(() => {});

// A flat PNG stored the way the app stores covers, so a "generated" cover is a real file.
const cover = async (bid, name, colour) => { const c = createCanvas(1200, 628); const g = c.getContext('2d'); g.fillStyle = colour; g.fillRect(0, 0, 1200, 628); g.fillStyle = '#ffffff'; g.fillRect(80, 80, 400, 120); const dir = `${environment.STORAGE_DIR}/${bid}/hero`; await fs.mkdir(dir, { recursive: true }); await fs.writeFile(`${dir}/${name}`, c.toBuffer('image/png')); await fs.writeFile(`${dir}/${name}.type`, 'image/png'); return `/api/files/${bid}/hero/${name}`; };
const entry = (id, title, kw, status, bid = business.id) => db.query("INSERT INTO calendar_entries(id,business_id,title,kw,type,date,status,relevance) VALUES($1,$2,$3,$4,'Guide',current_date + 7,$5,'Synthetic QA entry')", [id, bid, title, kw, status]);
const body = [['p', 'This synthetic article exists for a QA check of cover images.'], ['h2', 'Getting there'], ['p', 'Trains run every ten minutes from the station.'], ['h2', 'What it costs'], ['p', 'Prices change with the season.'], ['h2', 'What to check before you book'], ['p', 'Read the terms and ask about the deposit.']];
const article = (id, slug, img, extra = {}) => ({ entryId: id, generated: true, body, brief: { angle: 'QA fixture', outline: ['Getting there', 'What it costs', 'What to check before you book'], words: 1400 }, seo: { title: 'Synthetic article', meta: 'Synthetic meta', slug }, img, videos: [], videoMeta: [], sources: [], claims: [], draftedAt: '2026-11-01T00:00:00.000Z', ...extra });
const entries = { one: 'e_rcqa_one', two: 'e_rcqa_two', placeholder: 'e_rcqa_placeholder', legacy: 'e_rcqa_legacy', harbour: 'e_rcqa_harbour', mill: 'e_rcqa_mill', typed: 'e_rcqa_typed', other: 'e_rcqa_other' };
// Drafted, in review, a stored generated (template) cover in Branded graphic: the owner action, errors, switch back.
await entry(entries.one, 'A Guide to Booking a Short Let by the Water', 'short let by the water', 'review');
await db.query('INSERT INTO articles(entry_id,business_id,data) VALUES($1,$2,$3)', [entries.one, business.id, article(entries.one, 'short-let-guide', { style: 'branded', seed: 1, prompt: 'A quiet quay at dawn with moored boats.', promptBy: 'radar', alt: 'Illustration of a quiet quay at dawn', url: await cover(business.id, 'one.png', '#1f4d3a'), urlKey: 'branded:1' })]);
// A second drafted article, to move to while a slow fetch runs on the first.
await entry(entries.two, 'What to Pack for a Week on the Coast', 'what to pack coast', 'review');
await db.query('INSERT INTO articles(entry_id,business_id,data) VALUES($1,$2,$3)', [entries.two, business.id, article(entries.two, 'what-to-pack', { style: 'branded', seed: 1, prompt: 'An open suitcase on a bed by a window.', promptBy: 'radar', alt: 'Illustration of an open suitcase', url: await cover(business.id, 'two.png', '#7a3b2e'), urlKey: 'branded:1' })]);
// Illustration chosen, no image model: the stored cover is the template with the placeholder mark (the existing notice).
await entry(entries.placeholder, 'How Quiet Is the Old Town at Night', 'old town at night', 'review');
await db.query('INSERT INTO articles(entry_id,business_id,data) VALUES($1,$2,$3)', [entries.placeholder, business.id, article(entries.placeholder, 'old-town-night', { style: 'illustration', seed: 1, prompt: 'A lamplit lane in the old town at night.', promptBy: 'radar', alt: 'Illustration of a lamplit lane', url: await cover(business.id, 'placeholder.png', '#2b2d42'), urlKey: 'illustration:1', placeholder: { reason: 'unavailable', at: '2026-11-12T00:00:00.000Z' } })]);
// Saved before this change and before contextual directions: none of the newer fields.
await entry(entries.legacy, 'Five Walks From the Harbour', 'walks from the harbour', 'review');
await db.query('INSERT INTO articles(entry_id,business_id,data) VALUES($1,$2,$3)', [entries.legacy, business.id, article(entries.legacy, 'five-walks', { style: 'branded', seed: 1, prompt: 'Calm, editorial image about walks from the harbour', alt: 'Legacy cover alt', url: null, urlKey: null })]);
// Not drafted: the automatic path. The stubbed direction step names a subject when the title names a stub place.
await entry(entries.harbour, 'Living at Harbour House: what to expect', 'harbour house', 'approved');
await entry(entries.mill, 'A Weekend at Mill Lane Studios', 'mill lane studios', 'approved');
await entry(entries.typed, 'Harbour House in Winter: what changes', 'harbour house winter', 'approved');
// Another business's article, for the tenant boundary.
await entry(entries.other, 'Elsewhere Tower Reviews', 'elsewhere tower reviews', 'review', otherBusiness.id);
await db.query('INSERT INTO articles(entry_id,business_id,data) VALUES($1,$2,$3)', [entries.other, otherBusiness.id, article(entries.other, 'elsewhere', { style: 'branded', seed: 1, prompt: 'OTHER-TENANT-DIRECTION', promptBy: 'radar', alt: 'Other tenant alt', url: null, urlKey: null })]);
await fs.writeFile(`${output}/fixture.json`, JSON.stringify({ base: environment.APP_URL, domain: DOMAIN, businessId: business.id, otherBusinessId: otherBusiness.id, users, sessions, entries }), { mode: 0o600 });
await db.end();
console.log(`Seeded radar_qa_app: business ${business.id} (owner, editor, viewer) on ${DOMAIN}, other business ${otherBusiness.id}, entries ${Object.values(entries).join(', ')}.`);
