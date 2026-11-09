/** Disposable local-only upgrade/readiness proof; never starts collectors or transports. */
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,readFile,writeFile,copyFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { execFileSync } from 'node:child_process';
const target=new URL(process.env.DATABASE_URL!);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'54329');assert.match(target.pathname,/^\/radar_weekly_report_/);
const folder=await mkdtemp(join(tmpdir(),'radar-report-core-'));
const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));
const core={...journal,entries:journal.entries.filter((e:{idx:number})=>e.idx<17)};
const expected=JSON.parse(execFileSync('git',['show','HEAD:drizzle/meta/_journal.json'],{encoding:'utf8'}));assert.deepEqual(core,expected);
await mkdir(join(folder,'meta'));await writeFile(join(folder,'meta/_journal.json'),JSON.stringify(core));
for(const e of core.entries){const bytes=await readFile(`drizzle/${e.tag}.sql`);assert.deepEqual(bytes,execFileSync('git',['show',`HEAD:drizzle/${e.tag}.sql`]));await copyFile(`drizzle/${e.tag}.sql`,join(folder,`${e.tag}.sql`));}
const {db,pool}=await import('../../../../src/server/db/index');const {waitForWorkerSchema}=await import('../../../../src/server/db/workerReady');
const ledger=async()=>(await pool.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at')).rows;
const tables=['users','businesses','members','education_enrollments','lifecycle_guide_states','lifecycle_emails','outbox_emails','user_email_preferences','ai_prompts','ai_results'];
const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await pool.query(`SELECT * FROM ${t} ORDER BY 1,2`)).rows])));
try{
 await migrate(db,{migrationsFolder:folder});assert.equal((await ledger()).length,17);await assert.rejects(waitForWorkerSchema({timeoutMs:0,log:()=>{}}),/schema is not ready/);
 const uid=randomUUID(),bid=randomUUID(),pid=randomUUID(),mid=randomUUID();
 await pool.query("INSERT INTO users(id,name,email,email_verified_at) VALUES($1,'Upgrade fixture',$2,now())",[uid,`upgrade-${uid}@test.local`]);
 await pool.query("INSERT INTO businesses(id,owner_id,domain,profile,status) VALUES($1,$2,'migration.test','{}','active')",[bid,uid]);
 await pool.query("INSERT INTO members(business_id,user_id,email,role,status) VALUES($1,$2,'upgrade@test.local','Owner','active')",[bid,uid]);
 await pool.query("INSERT INTO education_enrollments(user_id,next_lesson,status,last_accepted_at) VALUES($1,5,'completed',now())",[uid]);
 await pool.query("INSERT INTO lifecycle_emails(id,user_id,event_key,type,payload_enc,expires_at,first_attempt_at,attempts) VALUES($1,$2,$3,'weekly_education','immutable-fixture',now()+interval '1 day',now(),2)",[mid,uid,`education:v1:${uid}:organic_search`]);
 await pool.query("INSERT INTO lifecycle_guide_states(user_id,guide_id,due_at,source_business_id,status) VALUES($1,'autopilot_intro',now(),$2,'waiting')",[uid,bid]);
 await pool.query("INSERT INTO user_email_preferences(user_id,education,onboarding,daily_brief) VALUES($1,false,false,false)",[uid]);
 await pool.query("INSERT INTO ai_prompts(id,business_id,prompt,source) VALUES($1,$2,'Which app is useful?','user')",[pid,bid]);
 await pool.query("INSERT INTO ai_results(business_id,prompt_id,engine,status,date) VALUES($1,$2,'ChatGPT','mentioned','2026-11-09')",[bid,pid]);
 await pool.query("INSERT INTO outbox_emails(id,\"to\",subject,text,status) VALUES($1,'upgrade@test.local','Old message','Immutable old body','failed')",[randomUUID()]);
 const before=await snapshot(),beforeLedger=await ledger();await migrate(db,{migrationsFolder:'./drizzle'});assert.deepEqual(await snapshot(),before);assert.deepEqual((await ledger()).slice(0,17),beforeLedger);assert.equal((await ledger()).length,18);
 for(const t of ['ai_observations','visibility_preferences','ai_miss_topics'])assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n,0);
 await waitForWorkerSchema({timeoutMs:0,log:()=>{}});
 await pool.query('INSERT INTO visibility_preferences(business_id,weekly_email) VALUES($1,false)',[bid]);const after=await snapshot(),allLedger=await ledger();await migrate(db,{migrationsFolder:'./drizzle'});assert.deepEqual(await snapshot(),after);assert.deepEqual(await ledger(),allLedger);assert.equal((await pool.query('SELECT weekly_email FROM visibility_preferences WHERE business_id=$1',[bid])).rows[0].weekly_email,false);
 const oldSnapshot=JSON.parse(await readFile('drizzle/meta/0016_snapshot.json','utf8')),newSnapshot=JSON.parse(await readFile('drizzle/meta/0017_snapshot.json','utf8'));assert.equal(newSnapshot.prevId,oldSnapshot.id);
 const result={base:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),migration:'0017_ai_weekly_report',checks:{core16to17Upgrade:true,oldWorkerRejected:true,newWorkerAccepted:true,allPrior17LedgerRowsUnchanged:true,allPriorSqlAndJournalUnchanged:true,courseGuidesSenderMetadataAndAttemptsPreserved:true,noFakeHistoryFromLatestResults:true,noAutoEnrollmentOrPreferenceBackfill:true,storedFalseSurvivesNoop:true,noOpLedgerStable:true,snapshotAncestry:true},migrationSha256:createHash('sha256').update(await readFile('drizzle/0017_ai_weekly_report.sql')).digest('hex')};await writeFile('.factory/lifecycle-refinement/shipping/weekly-report/migration-results.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await pool.end();await rm(folder,{recursive:true,force:true});}
