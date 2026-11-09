import fs from 'node:fs/promises';
import pg from 'pg';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const output = '.data/ai-support';
await fs.mkdir(output, { recursive: true, mode: 0o700 });
const source = JSON.parse(await fs.readFile('.data/signup-security/local-env.json', 'utf8'));
const url = new URL(source.DATABASE_URL);
if (url.hostname !== 'localhost' || url.port !== '54329') throw Error('Local QA database required');
const database = 'radar_support_qa';
const admin = new pg.Pool({ connectionString: source.DATABASE_URL });
const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database]);
if (!exists.rowCount) await admin.query('CREATE DATABASE ' + database);
await admin.end();
url.pathname = '/' + database;
const environment = { ...source, DATABASE_URL: url.href, RADAR_DEV_STUBS: '1', RADAR_BILLING: 'off', NODE_ENV: 'development', APP_URL: 'http://localhost:3820', NEXT_DIST_DIR: '.next-support-qa', SUPPORT_INBOX: 'support@thally.io', RESEND_API_KEY: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', XAI_API_KEY: '', OPENROUTER_API_KEY: '' };
await fs.writeFile(output + '/local-env.json', JSON.stringify(environment), { mode: 0o600 });
const migration = spawnSync(process.execPath, ['--import', 'tsx', 'src/server/db/migrate.ts'], { env: { ...process.env, ...environment }, encoding: 'utf8' });
await fs.writeFile(output + '/migration.log', migration.stdout + migration.stderr);
if (migration.status !== 0) throw Error('Local migration failed; inspect ignored migration log');
const db = new pg.Pool({ connectionString: environment.DATABASE_URL });
const label = 'supportqa-' + Date.now();
const email = label + '@test.local';
const password = 'SupportBrowser123!';
const user = (await db.query('INSERT INTO users(name,email,password_hash,email_verified_at) VALUES($1,$2,$3,now()) RETURNING id', ['Support QA', email, await bcrypt.hash(password, 4)])).rows[0];
const viewer = (await db.query('INSERT INTO users(name,email,password_hash,email_verified_at) VALUES($1,$2,$3,now()) RETURNING id', ['Viewer QA', label + '-viewer@test.local', await bcrypt.hash(password, 4)])).rows[0];
const outsider = (await db.query('INSERT INTO users(name,email,password_hash,email_verified_at) VALUES($1,$2,$3,now()) RETURNING id', ['Outsider QA', label + '-outsider@test.local', await bcrypt.hash(password, 4)])).rows[0];
const profile = name => ({ domain: name.toLowerCase() + '.test', business: { name, description: 'A fixture business for local support QA.', offerings: ['Time tracking'], industry: 'Software', positioning: 'Simple time tracking', differentiators: ['Calendar based'] }, audience: { segments: ['Designers'], buyers: ['Freelancers'], needs: ['Track time'], competitors: [] }, keywords: { list: [] }, brand: { logo: null, primary: '#1F4D3A', secondary: '#F2B544', voice: 'Plain', language: 'English (US)', markets: ['United States'] } });
const businesses = [];
for (const name of ['Support Alpha', 'Support Beta']) {
  const p = profile(name);
  p.domain = name.toLowerCase().replaceAll(' ', '-') + '.test';
  const business = (await db.query("INSERT INTO businesses(owner_id,domain,status,profile) VALUES($1,$2,'active',$3) RETURNING id", [user.id, p.domain, p])).rows[0];
  await db.query("INSERT INTO members(business_id,user_id,email,role,status) VALUES($1,$2,$3,'Owner','active')", [business.id, user.id, email]);
  await db.query("INSERT INTO members(business_id,user_id,email,role,status) VALUES($1,$2,$3,'Viewer','active')", [business.id, viewer.id, label + '-viewer@test.local']);
  businesses.push(business.id);
}
const session = async uid => {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query("INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [crypto.createHash('sha256').update(token).digest('hex'), uid]);
  return token;
};
await fs.writeFile(output + '/fixture.json', JSON.stringify({ email, password, userId: user.id, viewerId: viewer.id, outsiderId: outsider.id, businesses, session: await session(user.id), viewerSession: await session(viewer.id), outsiderSession: await session(outsider.id) }), { mode: 0o600 });
await db.end();
console.log('Isolated local QA database migrated; owner, Viewer, outsider, two businesses and sessions created. No network mail/AI credentials configured.');
