import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import pg from 'pg';
import {drizzle} from 'drizzle-orm/node-postgres';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
const OUT='.factory/lifecycle-refinement/qa/main-integration',MAIN='b38b67a4d48c51f39bd5fc68e1fc4143a9633060';
const adminUrl='postgres://postgres@127.0.0.1:54329/postgres';const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
const fromMain=file=>execFileSync('git',['show',`${MAIN}:${file}`]);
const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));assert.equal(journal.entries.at(-1).idx,14);assert.equal(journal.entries[10].tag,'0010_autopilot');
const deployed=JSON.parse(fromMain('drizzle/meta/_journal.json'));assert.deepEqual(journal.entries.slice(0,11),deployed.entries);
for(const e of deployed.entries)assert.deepEqual(await readFile(`drizzle/${e.tag}.sql`),fromMain(`drizzle/${e.tag}.sql`));
async function partial(entries,original=false){const dir=await mkdtemp(path.join(tmpdir(),'radar-merged-qa-'));await mkdir(path.join(dir,'meta'));await writeFile(path.join(dir,'meta/_journal.json'),JSON.stringify({...journal,entries}));for(const e of entries)await writeFile(path.join(dir,`${e.tag}.sql`),original?fromMain(`drizzle/${e.tag}.sql`):await readFile(`drizzle/${e.tag}.sql`));return dir;}
const mainDir=await partial(deployed.entries,true),preGuideDir=await partial(journal.entries.filter(e=>e.idx<=13));const results=[];
try{for(const mode of ['clean','deployed-main-0010','pre-guide-0013']){
 const name='radar_lc2_merge_'+mode.replaceAll('-','_')+'_'+Date.now();await admin.query(`CREATE DATABASE "${name}"`);const url=new URL(adminUrl);url.pathname='/'+name;const pool=new pg.Pool({connectionString:url.href});
 try{const db=drizzle(pool);let uid,bid,jid,mail,before,oldCourse;
 if(mode!=='clean'){
  await migrate(db,{migrationsFolder:mode==='deployed-main-0010'?mainDir:preGuideDir});
  uid=(await pool.query("insert into users(name,email,email_verified_at) values('Synthetic old owner','migration@test.local',now()) returning id")).rows[0].id;
  const autopilot={enabled:true,activationId:'preserved-activation',enabledBy:uid,enabledAt:'2026-01-01T00:00:00.000Z'};
  bid=(await pool.query("insert into businesses(owner_id,domain,status,profile,autopilot) values($1,'qa.test','active','{}',$2) returning id",[uid,autopilot])).rows[0].id;
  jid=(await pool.query("insert into jobs(business_id,kind,payload,status,attempts) values($1,'autopilot.handoff',$2,'failed',2) returning id",[bid,{activationId:autopilot.activationId,ownerId:uid,name:'Frozen business',items:[{key:'old',text:'Frozen prepared draft'}]}])).rows[0].id;
  mail=(await pool.query("insert into outbox_emails(\"to\",subject,text,status) values('migration@test.local','Frozen subject','Frozen handoff','failed') returning id")).rows[0].id;
  await pool.query("insert into calendar_entries(id,business_id,title,kw,type,date,status,autopilot_activation_id) values('marked',$1,'Old article','old','article','2026-11-10','scheduled','preserved-activation')",[bid]);
  before={business:(await pool.query('select autopilot from businesses where id=$1',[bid])).rows[0],job:(await pool.query('select payload,attempts,status from jobs where id=$1',[jid])).rows[0],mail:(await pool.query('select * from outbox_emails where id=$1',[mail])).rows[0]};
  if(mode==='pre-guide-0013'){
   await pool.query('insert into user_email_preferences(user_id,education,onboarding,daily_brief) values($1,false,false,false)',[uid]);
   const mid=(await pool.query("insert into lifecycle_emails(user_id,event_key,type,payload_enc,status,attempts,first_attempt_at,expires_at) values($1,$2,'weekly_education','frozen-attempted','queued',1,now(),now()+interval'1 day') returning id",[uid,`education:v1:${uid}:organic_search`])).rows[0].id;
   await pool.query('insert into education_enrollments(user_id,next_lesson,pending_email_id,last_accepted_at) values($1,3,$2,now())',[uid,mid]);
   oldCourse=(await pool.query('select * from lifecycle_emails where id=$1',[mid])).rows[0];
  }
 }
 await migrate(db,{migrationsFolder:'drizzle'});assert.equal(Number((await pool.query('select count(*) from drizzle.__drizzle_migrations')).rows[0].count),15);
 assert.equal((await pool.query('select * from lifecycle_guide_states')).rowCount,0);
 if(mode!=='clean'){
  assert.deepEqual((await pool.query('select autopilot from businesses where id=$1',[bid])).rows[0],before.business);assert.deepEqual((await pool.query('select payload,attempts,status from jobs where id=$1',[jid])).rows[0],before.job);assert.deepEqual((await pool.query('select * from outbox_emails where id=$1',[mail])).rows[0],before.mail);assert.equal((await pool.query("select autopilot_activation_id from calendar_entries where id='marked'")).rows[0].autopilot_activation_id,'preserved-activation');
  if(oldCourse){assert.deepEqual((await pool.query('select * from lifecycle_emails where id=$1',[oldCourse.id])).rows[0],oldCourse);assert.equal((await pool.query('select next_lesson from education_enrollments where user_id=$1',[uid])).rows[0].next_lesson,3);assert.equal((await pool.query('select education from user_email_preferences where user_id=$1',[uid])).rows[0].education,false);}
 }
 results.push({mode,database:name,pass:true,migrations:15,deployedSqlAndJournalUnchanged:true,noGuideEnrollment:true,autopilotAndMailPreserved:mode!=='clean',attemptedCourseAndExplicitOptoutPreserved:!!oldCourse});
 }finally{await pool.end();}
}
const name='radar_lc2_main_integration_qa_20261110';const exists=(await admin.query('select 1 from pg_database where datname=$1',[name])).rowCount;if(!exists)await admin.query(`CREATE DATABASE "${name}"`);const url=new URL(adminUrl);url.pathname='/'+name;const pool=new pg.Pool({connectionString:url.href});try{await migrate(drizzle(pool),{migrationsFolder:'drizzle'});}finally{await pool.end();}
}finally{await admin.end();}
await writeFile(OUT+'/migration-proof.json',JSON.stringify({main:MAIN,results},null,2)+'\n');console.log(JSON.stringify({results},null,2));
