import fs from 'node:fs/promises';
import pg from 'pg';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const output = '.data/autopilot';
await fs.mkdir(output, { recursive: true, mode: 0o700 });
const database = 'radar_autopilot_release_qa';
const local = 'postgres://postgres:radar@localhost:54329/postgres';
const admin = new pg.Pool({ connectionString: local });
if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount) await admin.query('CREATE DATABASE ' + database);
await admin.end();
// Blank every local .env key, then supply only local QA configuration. Never print local environment contents.
const blank = {};
for (const filename of ['.env.example', '.env', '.env.local']) {
  const source = await fs.readFile(filename, 'utf8').catch(() => '');
  for (const line of source.split('\n')) { const match = /^([A-Z][A-Z0-9_]*)=/.exec(line); if (match) blank[match[1]] = ''; }
}
const qaUrl = new URL(local); qaUrl.pathname = '/' + database;
const environment = { ...blank, DATABASE_URL: qaUrl.href, NODE_ENV: 'development', RADAR_DEV_STUBS: '1', RADAR_SOCIAL_PUBLISHING: 'all', RADAR_BILLING: 'off', RADAR_REAL_CONNECTORS: '', RADAR_SECRET_KEY: 'autopilot-local-qa-only', APP_URL: 'http://localhost:3831', NEXT_DIST_DIR: '.next-autopilot-qa', NEXT_TELEMETRY_DISABLED: '1', STORAGE_DIR: '.data/autopilot/uploads', RESEND_API_KEY: '', S3_BUCKET: '', OPENROUTER_API_KEY: '', OPEN_ROUTER_API_KEY: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', XAI_API_KEY: '' };
await fs.writeFile(output + '/local-env.json', JSON.stringify(environment), { mode: 0o600 });
const childEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ...environment };
const migration = spawnSync(process.execPath, ['--import', 'tsx', 'src/server/db/migrate.ts'], { env: childEnv, encoding: 'utf8' });
await fs.writeFile(output + '/migration.log', migration.stdout + migration.stderr);
if (migration.status !== 0) throw Error('QA migration failed; inspect ignored migration log.');
const db = new pg.Pool({ connectionString: environment.DATABASE_URL });
const profile = { domain: 'autopilot-qa.test', business: { name: 'Autopilot QA', description: 'Calendar based time tracking for designers.', offerings: ['Time tracking'], industry: 'Software', positioning: 'Simple billable time tracking', differentiators: ['Calendar based'] }, audience: { segments: ['Designers'], buyers: ['Freelancers'], needs: ['Track billable time'], competitors: [] }, keywords: { list: [] }, brand: { logo: null, primary: '#1F4D3A', secondary: '#F2B544', voice: 'Plain', language: 'English (US)', markets: ['United States'] } };
const label = 'autopilotqa-' + Date.now();
const users = {};
for (const role of ['Owner', 'Admin', 'Editor', 'Viewer', 'Outsider']) users[role] = (await db.query('INSERT INTO users(name,email,email_verified_at) VALUES($1,$2,now()) RETURNING id,email', ['Autopilot ' + role, label + '-' + role.toLowerCase() + '@test.local'])).rows[0];
const business = (await db.query("INSERT INTO businesses(owner_id,domain,status,profile,timezone,social_auto) VALUES($1,$2,'active',$3,'UTC',$4) RETURNING id", [users.Owner.id, profile.domain, profile, { platforms: ['x'], style: 'branded', time: '08:00' }])).rows[0];
for (const role of ['Owner','Admin','Editor','Viewer']) await db.query("INSERT INTO members(business_id,user_id,email,role,status) VALUES($1,$2,$3,$4,'active')", [business.id, users[role].id, users[role].email, role]);
const sessions = {};
for (const [role, user] of Object.entries(users)) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query("INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [crypto.createHash('sha256').update(token).digest('hex'), user.id]);
  sessions[role] = token;
}
await fs.writeFile(output + '/fixture.json', JSON.stringify({ businessId: business.id, users, sessions }), { mode: 0o600 });
await db.end();
console.log('Local isolated Autopilot QA database migrated; owner/member/outsider sessions created. All providers stubbed, external email disabled.');
