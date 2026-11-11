import fs from 'node:fs/promises';
import pg from 'pg';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const output = '.data/publishing-planner-recovery';
await fs.mkdir(output, { recursive: true, mode: 0o700 });
const database = 'radar_planner_recovery_qa';
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
const environment = { ...blank, DATABASE_URL: qaUrl.href, NODE_ENV: 'development', RADAR_DEV_STUBS: '1', RADAR_SOCIAL_PUBLISHING: 'all', RADAR_BILLING: 'off', RADAR_REAL_CONNECTORS: '', RADAR_SECRET_KEY: 'planner-local-qa-only', APP_URL: 'http://localhost:3847', NEXT_DIST_DIR: '.next-planner-recovery-qa', NEXT_TELEMETRY_DISABLED: '1', STORAGE_DIR: '.data/publishing-planner-recovery/uploads', RESEND_API_KEY: '', S3_BUCKET: '', OPENROUTER_API_KEY: '', OPEN_ROUTER_API_KEY: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', XAI_API_KEY: '' };
await fs.writeFile(output + '/local-env.json', JSON.stringify(environment), { mode: 0o600 });
const childEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, ...environment };
const migration = spawnSync(process.execPath, ['--import', 'tsx', 'src/server/db/migrate.ts'], { env: childEnv, encoding: 'utf8' });
await fs.writeFile(output + '/migration.log', migration.stdout + migration.stderr);
if (migration.status !== 0) throw Error('QA migration failed; inspect ignored migration log.');
const db = new pg.Pool({ connectionString: environment.DATABASE_URL });
const profile = { domain: 'planner-qa.test', business: { name: 'Planner QA', description: 'Calendar based time tracking for designers.', offerings: ['Time tracking'], industry: 'Software', positioning: 'Simple billable time tracking', differentiators: ['Calendar based'] }, audience: { segments: ['Designers'], buyers: ['Freelancers'], needs: ['Track billable time'], competitors: [] }, keywords: { list: [] }, brand: { logo: null, primary: '#1F4D3A', secondary: '#F2B544', voice: 'Plain', language: 'English (US)', markets: ['United States'] } };
const label = 'plannerqa-' + Date.now();
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
const conn = (await db.query("INSERT INTO connections(business_id,type,url,target,fields,status) VALUES($1,'nextjs','https://github.com/qa/site','qa/site',$2,'ok') RETURNING id", [business.id, {repo:'qa/site',path:'content/posts'}])).rows[0];
const localError = {http:422,message:'422 Unprocessable Entity',platform:'GitHub',source:'radar',hint:'Radar could not safely integrate this article: the plan is empty (0 changed files). No publishing changes were applied.',diagnostic:{code:'plan-empty',stage:'plan',actual:0}};
const entries = {local:'e_planner_qa_local',remote:'e_planner_qa_remote'};
for (const [kind,id] of Object.entries(entries)) {
 const err=kind==='local'?localError:{http:403,message:'403 Forbidden',platform:'GitHub'};
 await db.query("INSERT INTO calendar_entries(id,business_id,title,kw,type,date,dest,status,publish_error) VALUES($1,$2,$3,'planner qa','How-to',current_date,$4,'failed',$5)",[id,business.id,kind==='local'?'Synthetic local planner article':'Synthetic remote rejected article',conn.id,err]);
 const article={entryId:id,generated:true,body:[['p','This complete synthetic article stays available after publishing fails.']],brief:{angle:'QA fixture',outline:[],words:900},seo:{title:'Synthetic article',meta:'QA',slug:kind+'-qa'},img:{style:'branded',seed:1,prompt:'',alt:'',url:null},videos:[],videoMeta:[],sources:[],claims:[]};
 await db.query('INSERT INTO articles(entry_id,business_id,data) VALUES($1,$2,$3)',[id,business.id,article]);
}
await db.query('UPDATE businesses SET blog=$2 WHERE id=$1',[business.id,{defaultId:conn.id}]);
await fs.writeFile(output + '/fixture.json' , JSON.stringify({ businessId: business.id, users, sessions, entries, connId:conn.id }), { mode: 0o600 });
await db.end();
console.log('Local isolated Planner QA database migrated; owner/member/outsider sessions created. All providers stubbed, external email disabled.');
