import fs from 'node:fs/promises';
import pg from 'pg';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';

const output = '.data/multiplatform-release-qa';
await fs.mkdir(output, { recursive: true, mode: 0o700 });
const database = 'radar_multiplatform_release_qa';
const admin = new pg.Pool({ connectionString: 'postgres://postgres:radar@localhost:54329/postgres' });
if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount) await admin.query('CREATE DATABASE ' + database);
await admin.end();
const blank = {};
for (const filename of ['.env.example', '.env', '.env.local']) {
  const source = await fs.readFile(filename, 'utf8').catch(() => '');
  for (const line of source.split('\n')) { const match = /^([A-Z][A-Z0-9_]*)=/.exec(line); if (match) blank[match[1]] = ''; }
}
const environment = { ...blank, DATABASE_URL: 'postgres://postgres:radar@localhost:54329/' + database, NODE_ENV: 'development', RADAR_DEV_STUBS: '1', RADAR_SOCIAL_PUBLISHING: 'all', RADAR_BILLING: 'off', RADAR_REAL_CONNECTORS: '', RADAR_SECRET_KEY: 'multiplatform-local-qa-only', APP_URL: 'http://localhost:3841', NEXT_DIST_DIR: '.next', NEXT_TELEMETRY_DISABLED: '1', STORAGE_DIR: output + '/uploads', RESEND_API_KEY: '', S3_BUCKET: '', OPENROUTER_API_KEY: '', OPEN_ROUTER_API_KEY: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', XAI_API_KEY: '', RADAR_FAILURE_ALERTS:'off' };
await fs.writeFile(output + '/local-env.json', JSON.stringify(environment), { mode: 0o600 });
const childEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ...environment };
const migration = spawnSync(process.execPath, ['--import', 'tsx', 'src/server/db/migrate.ts'], { env: childEnv, encoding: 'utf8' });
await fs.writeFile(output + '/migration.log', migration.stdout + migration.stderr);
if (migration.status !== 0) throw Error('QA migration failed; inspect ignored migration log.');
const db = new pg.Pool({ connectionString: environment.DATABASE_URL });
const profile = { domain: 'multiplatform-qa.test', business: { name: 'Multiplatform QA', description: 'Calendar based time tracking for designers.', offerings: ['Time tracking'], industry: 'Software', positioning: 'Simple billable time tracking', differentiators: ['Calendar based'] }, audience: { segments: ['Designers'], buyers: ['Freelancers'], needs: ['Track billable time'], competitors: [] }, keywords: { list: [] }, brand: { logo: null, primary: '#1F4D3A', secondary: '#F2B544', voice: 'Plain', language: 'English (US)', markets: ['United States'] } };
const label = 'multiplatformqa-' + Date.now();
const users = {};
for (const role of ['Owner', 'Editor', 'Viewer', 'Outsider']) users[role] = (await db.query('INSERT INTO users(name,email,email_verified_at) VALUES($1,$2,now()) RETURNING id,email', ['Publishing QA ' + role, label + '-' + role.toLowerCase() + '@test.local'])).rows[0];
const business = (await db.query("INSERT INTO businesses(owner_id,domain,status,profile,timezone,social_auto) VALUES($1,$2,'active',$3,'UTC',$4) RETURNING id", [users.Owner.id, profile.domain, profile, { on:false, platforms: ['x','instagram','tiktok','youtube'], style: 'branded', time: '08:00' }])).rows[0];
const otherBusiness = (await db.query("INSERT INTO businesses(owner_id,domain,status,profile,timezone) VALUES($1,$2,'active',$3,'UTC') RETURNING id", [users.Outsider.id, 'other-publishing-qa.test', profile])).rows[0];
for (const role of ['Owner','Editor','Viewer']) await db.query("INSERT INTO members(business_id,user_id,email,role,status) VALUES($1,$2,$3,$4,'active')", [business.id, users[role].id, users[role].email, role]);
await db.query("INSERT INTO members(business_id,user_id,email,role,status) VALUES($1,$2,$3,'Owner','active')", [otherBusiness.id,users.Outsider.id,users.Outsider.email]);
const sessions = {};
for (const [role, user] of Object.entries(users)) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query("INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [crypto.createHash('sha256').update(token).digest('hex'), user.id]); sessions[role] = token;
}
const imageKey = business.id + '/social/qa-still.jpg';
const imagePath = environment.STORAGE_DIR + '/' + imageKey;
await fs.mkdir(environment.STORAGE_DIR + '/' + business.id + '/social', { recursive:true });
const canvas = createCanvas(1080,1080); const context=canvas.getContext('2d');context.fillStyle='#1F4D3A';context.fillRect(0,0,1080,1080);context.fillStyle='#ffffff';context.font='bold 64px sans-serif';context.fillText('Publishing QA',90,520);
const bytes=canvas.toBuffer('image/jpeg');await fs.writeFile(imagePath,bytes);await fs.writeFile(imagePath+'.type','image/jpeg');
const platforms=['linkedin','x','instagram','tiktok','youtube','facebook','reddit','quora'];
const packId='qa-multiplatform-'+Date.now();const posts=Object.fromEntries(platforms.map(platform=>[platform,{text:'Track your time alongside your calendar. A useful workflow for freelance designers.',style:'branded',seed:1,imageUrl:'/api/files/'+imageKey,imageMeta:{bytes:bytes.length,type:'image/jpeg'},copiedAt:null,v:0}]));
const pack={id:packId,name:'Multiplatform publishing QA',source:{kind:'idea',label:'Calendar time tracking tips'},created:new Date().toISOString().slice(0,10),style:'branded',auto:false,posts,order:platforms,headline:'Calendar time tracking'};
await db.query('INSERT INTO social_packs(id,business_id,data) VALUES($1,$2,$3)',[packId,business.id,pack]);
const foreignPackId='qa-foreign-'+Date.now();await db.query('INSERT INTO social_packs(id,business_id,data) VALUES($1,$2,$3)',[foreignPackId,otherBusiness.id,{...pack,id:foreignPackId}]);
await fs.writeFile(output + '/fixture.json', JSON.stringify({ businessId: business.id, otherBusinessId:otherBusiness.id, packId, foreignPackId, users, sessions }), { mode: 0o600 });
await db.end();
console.log('Isolated multiplatform QA database migrated; synthetic accounts and eight-platform draft ready. All providers stubbed.');
