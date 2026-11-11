// Fresh local databases only. Proves canonical deployed main history and all four appended PR25 migrations.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
const main='b38b67a4d48c51f39bd5fc68e1fc4143a9633060', prior='96b3d730c0becd9066a28e2829728f0e84fd462f';
const fromGit=(ref,file)=>execFileSync('git',['show',`${ref}:${file}`]);
const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')), canonical=JSON.parse(fromGit(main,'drizzle/meta/_journal.json'));
assert.deepEqual(journal.entries.slice(0,11),canonical.entries);
for(const e of canonical.entries)assert.deepEqual(await readFile(`drizzle/${e.tag}.sql`),fromGit(main,`drizzle/${e.tag}.sql`));
assert.deepEqual(await readFile('drizzle/meta/0010_snapshot.json'),fromGit(main,'drizzle/meta/0010_snapshot.json'));
const tags=['lifecycle_emails','engagement_updates','weekly_education','lifecycle_guides'];
for(let i=0;i<4;i++) {
 const old=`${String(10+i).padStart(4,'0')}_${tags[i]}`, next=`${String(11+i).padStart(4,'0')}_${tags[i]}`;
 assert.equal(journal.entries[11+i].tag,next);assert.equal(journal.entries[11+i].idx,11+i);assert.equal(journal.entries[11+i].when,canonical.entries[10].when+i+1);
 assert.deepEqual(await readFile(`drizzle/${next}.sql`),fromGit(prior,`drizzle/${old}.sql`),'Unpublished SQL semantics must survive renumbering');
}
let before=JSON.parse(await readFile('drizzle/meta/0010_snapshot.json','utf8'));
for(let i=11;i<=14;i++) {const snap=JSON.parse(await readFile(`drizzle/meta/${String(i).padStart(4,'0')}_snapshot.json`,'utf8'));assert.equal(snap.prevId,before.id);for(const [t,c]of[['public.businesses','autopilot'],['public.calendar_entries','autopilot_activation_id'],['public.social_pubs','autopilot_activation_id']])assert(snap.tables[t].columns[c]);before=snap;}
const adminUrl=process.env.LC2_LOCAL_ADMIN_URL||'postgres://postgres@127.0.0.1:54329/postgres';const parsed=new URL(adminUrl);assert(['127.0.0.1','localhost'].includes(parsed.hostname));assert.equal(parsed.pathname,'/postgres');
const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
async function folder(last) {const dir=await mkdtemp(path.join(tmpdir(),'radar-main-lineage-'));await mkdir(path.join(dir,'meta'));const entries=journal.entries.filter(e=>e.idx<=last);await writeFile(path.join(dir,'meta/_journal.json'),JSON.stringify({...journal,entries}));for(const e of entries)await copyFile(`drizzle/${e.tag}.sql`,path.join(dir,`${e.tag}.sql`));return dir;}
const results=[];
try {for(const mode of ['clean','deployed-main10','pre-guide13']) {
 const name=`radar_integrated_${mode.replaceAll('-','_')}_${Date.now()}`;assert(/^radar_integrated_\w+$/.test(name));await admin.query(`CREATE DATABASE "${name}"`);const url=new URL(adminUrl);url.pathname='/'+name;const pool=new pg.Pool({connectionString:url.href});
 try {
 const db=drizzle(pool);let ledger=[],uid,bid,autopilot,mail,progress;
 if(mode!=='clean') {
  await migrate(db,{migrationsFolder:await folder(mode==='deployed-main10'?10:13)});ledger=(await pool.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id')).rows;
  uid=(await pool.query("INSERT INTO users(name,email,email_verified_at) VALUES('Owner','owner@test.local',now()) RETURNING id")).rows[0].id;
  bid=(await pool.query("INSERT INTO businesses(owner_id,domain,status,profile,autopilot) VALUES($1,'integration.test','active','{}'::jsonb,$2) RETURNING id",[uid,JSON.stringify({enabled:true,activationId:'preserved-main-activation',enabledBy:uid,enabledAt:'2026-11-10T00:00:00Z'})])).rows[0].id;
  await pool.query("INSERT INTO calendar_entries(id,business_id,title,kw,type,date,status,autopilot_activation_id) VALUES('main-topic',$1,'Preserved topic','topic','Guide','2026-11-11','proposed','preserved-main-activation')",[bid]);
  autopilot=(await pool.query('SELECT autopilot FROM businesses WHERE id=$1',[bid])).rows[0].autopilot;
  if(mode==='pre-guide13') {
   await pool.query('INSERT INTO user_email_preferences(user_id,education,daily_brief) VALUES($1,false,false)',[uid]);
   mail=(await pool.query("INSERT INTO lifecycle_emails(user_id,event_key,type,payload_enc,attempts,first_attempt_at,expires_at) VALUES($1,$2,'weekly_education','frozen-attempt-before-guide',1,now(),now()+interval'1 day') RETURNING *",[uid,`education:v1:${uid}:organic_search`])).rows[0];
   await pool.query('INSERT INTO education_enrollments(user_id,next_lesson,pending_email_id) VALUES($1,3,$2)',[uid,mail.id]);
   progress=(await pool.query('SELECT next_lesson,pending_email_id FROM education_enrollments WHERE user_id=$1',[uid])).rows[0];
  }
  await assert.rejects(pool.query('SELECT guide_id FROM lifecycle_guide_states LIMIT 0'));
 }
 await migrate(db,{migrationsFolder:'drizzle'});const all=(await pool.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id')).rows;
 assert.equal(all.length,15);assert.deepEqual(all.slice(0,ledger.length),ledger);
 const expected=await Promise.all(journal.entries.map(async e=>({hash:createHash('sha256').update(await readFile(`drizzle/${e.tag}.sql`)).digest('hex'),created_at:String(e.when)})));
 assert.deepEqual(all.map(r=>({hash:r.hash,created_at:String(r.created_at)})),expected);
 await pool.query('SELECT b.autopilot,c.autopilot_activation_id,s.autopilot_activation_id,p.education,e.next_lesson,m.payload_enc,g.guide_id FROM businesses b CROSS JOIN calendar_entries c CROSS JOIN social_pubs s CROSS JOIN user_email_preferences p CROSS JOIN education_enrollments e CROSS JOIN lifecycle_emails m CROSS JOIN lifecycle_guide_states g LIMIT 0');
 assert.equal((await pool.query('SELECT * FROM lifecycle_guide_states')).rowCount,0);
 if(bid){assert.deepEqual((await pool.query('SELECT autopilot FROM businesses WHERE id=$1',[bid])).rows[0].autopilot,autopilot);assert.equal((await pool.query("SELECT autopilot_activation_id FROM calendar_entries WHERE id='main-topic'")).rows[0].autopilot_activation_id,'preserved-main-activation');}
 if(mail){assert.deepEqual((await pool.query('SELECT next_lesson,pending_email_id FROM education_enrollments WHERE user_id=$1',[uid])).rows[0],progress);assert.equal((await pool.query('SELECT payload_enc FROM lifecycle_emails WHERE id=$1',[mail.id])).rows[0].payload_enc,mail.payload_enc);assert.equal((await pool.query('SELECT education FROM user_email_preferences WHERE user_id=$1',[uid])).rows[0].education,false);}
 await migrate(db,{migrationsFolder:'drizzle'});assert.deepEqual((await pool.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id')).rows,all);
 results.push({mode,database:name,migrationCount:15,addedEntries:15-ledger.length,priorLedger:'unchanged',autopilotAndProvenance:'preserved',courseAndAttemptedBody:mail?'preserved':'not-applicable',readiness:'passed',secondMigrate:'no-op',migrationGuideEnrollmentCount:0});
 }finally{await pool.end();}
}}finally{await admin.end();}
const report={canonicalMain:main,canonicalAutopilotSha256:createHash('sha256').update(await readFile('drizzle/0010_autopilot.sql')).digest('hex'),appended:journal.entries.slice(11).map(({tag,idx,when})=>({tag,idx,when})),snapshotChain:'canonical10→11→12→13→14; all retain Autopilot columns',results};
await writeFile('.factory/lifecycle-refinement/main-integration-migrations.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
