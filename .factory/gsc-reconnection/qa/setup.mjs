import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';
import { spawnSync } from 'node:child_process';

const dir='.factory/gsc-reconnection/qa';
const database='radar_gsc_reconnection_release_qa';
const local='postgres://postgres@127.0.0.1:55470/postgres';
const admin=new pg.Client({connectionString:local});await admin.connect();
if(!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount)await admin.query('CREATE DATABASE '+database);
await admin.end();
const databaseUrl=new URL(local);databaseUrl.pathname='/'+database;
export const environment={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NODE_ENV:'development',DATABASE_URL:databaseUrl.href,RADAR_DEV_STUBS:'1',RADAR_BILLING:'off',RADAR_FAILURE_ALERTS:'off',RADAR_SECRET_KEY:'gsc-isolated-local-qa-only',APP_URL:'http://localhost:3846',NEXT_DIST_DIR:'.next-gsc-reconnection-release-qa',NEXT_TELEMETRY_DISABLED:'1'};
const migrated=spawnSync(process.execPath,['--import','tsx','src/server/db/migrate.ts'],{env:environment,encoding:'utf8'});
await fs.writeFile(dir+'/migration.log',migrated.stdout+migrated.stderr);if(migrated.status!==0)throw Error('Isolated migration failed; inspect migration.log');
const db=new pg.Client({connectionString:databaseUrl.href});await db.connect();
const label='gscqa-'+Date.now();
const users={},sessions={};
for(const role of ['Owner','Editor','Viewer','Outsider']){
 users[role]=(await db.query('INSERT INTO users(name,email,email_verified_at) VALUES($1,$2,now()) RETURNING id,email',['Search QA '+role,label+'-'+role.toLowerCase()+'@test.local'])).rows[0];
 const token=crypto.randomBytes(32).toString('base64url');sessions[role]=token;
 await db.query("INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",[crypto.createHash('sha256').update(token).digest('hex'),users[role].id]);
}
const profile={domain:'gsc-banner-qa.test',business:{name:'Search Banner QA',description:'Synthetic local workspace for reconnection verification.',offerings:[],industry:'Software',positioning:'',differentiators:[]},audience:{segments:[],buyers:[],needs:[],competitors:[]},keywords:{list:[]},brand:{logo:null,primary:'#17181C',secondary:'#EF6A2E',voice:'Plain',language:'English (US)',markets:['United States']}};
const businesses=[];
for(const domain of ['gsc-banner-qa.test','other-search-qa.test']){
 const b=(await db.query("INSERT INTO businesses(owner_id,domain,status,profile,timezone) VALUES($1,$2,'active',$3,'UTC') RETURNING id",[users.Owner.id,domain,{...profile,domain,business:{...profile.business,name:domain==='gsc-banner-qa.test'?'Search Banner QA':'Other Search QA'}}])).rows[0];businesses.push(b.id);
 for(const role of ['Owner','Editor','Viewer'])await db.query("INSERT INTO members(business_id,user_id,email,role,status) VALUES($1,$2,$3,$4,'active')",[b.id,users[role].id,users[role].email,role]);
}
await fs.writeFile(dir+'/fixture.json',JSON.stringify({databaseUrl:databaseUrl.href,users,sessions,businesses,environment}),{mode:0o600});
await db.end();console.log('Migrated isolated local database and seeded synthetic users/businesses. No external services or production writes.');
