// Disposable local databases only. Sender metadata adds no backfill, replay or lifecycle mutation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp,mkdir,readFile,writeFile,copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
const base='5f7c56ab56cdd60099b032e8003dc178c05d4708';
const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')),canonical=JSON.parse(execFileSync('git',['show',`${base}:drizzle/meta/_journal.json`]));
assert.deepEqual(journal.entries.slice(0,15),canonical.entries);assert.equal(journal.entries[15].tag,'0015_mail_sender_identity');assert(journal.entries[15].when>journal.entries[14].when);
for(const e of canonical.entries)assert.deepEqual(await readFile(`drizzle/${e.tag}.sql`),execFileSync('git',['show',`${base}:drizzle/${e.tag}.sql`]));
const snap14=JSON.parse(await readFile('drizzle/meta/0014_snapshot.json','utf8')),snap15=JSON.parse(await readFile('drizzle/meta/0015_snapshot.json','utf8'));assert.equal(snap15.prevId,snap14.id);assert.equal(snap15.tables['public.outbox_emails'].columns.sender_meta.notNull,false);
const adminUrl=process.env.FOUNDER_LOCAL_ADMIN_URL||'postgres://postgres@127.0.0.1:54329/postgres',url=new URL(adminUrl);assert(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.pathname,'/postgres');
const admin=new pg.Client({connectionString:adminUrl});await admin.connect();
const dir=await mkdtemp(path.join(tmpdir(),'radar-founder-prior-'));await mkdir(path.join(dir,'meta'));await writeFile(path.join(dir,'meta/_journal.json'),JSON.stringify(canonical));for(const e of canonical.entries)await copyFile(`drizzle/${e.tag}.sql`,path.join(dir,`${e.tag}.sql`));
const results=[];
try{for(const mode of ['clean','upgrade0014']){
 const name=`radar_founder_${mode}_${Date.now()}`;assert(/^radar_founder_\w+$/.test(name));await admin.query(`CREATE DATABASE "${name}"`);const conn=new URL(adminUrl);conn.pathname='/'+name;const pool=new pg.Pool({connectionString:conn.href});
 try{
  const db=drizzle(pool);let ledger=[],oldMail=[],oldLifecycle=[];
  if(mode==='upgrade0014'){
   await migrate(db,{migrationsFolder:dir});ledger=(await pool.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id')).rows;
   await assert.rejects(pool.query('SELECT sender_meta FROM outbox_emails LIMIT 0'));
   await pool.query("INSERT INTO outbox_emails(\"to\",subject,text,status) VALUES('old@test.local','Legacy failed','Frozen legacy body','failed'),('sent@test.local','Legacy accepted','Accepted body','sent')");oldMail=(await pool.query('SELECT * FROM outbox_emails ORDER BY id')).rows;
   const uid=(await pool.query("INSERT INTO users(name,email,email_verified_at) VALUES('Owner','owner@test.local',now()) RETURNING id")).rows[0].id;
   await pool.query("INSERT INTO lifecycle_emails(user_id,event_key,type,payload_enc,next_attempt_at,expires_at,attempts,first_attempt_at) VALUES($1,'old-retired-key','trial_ending','frozen-retired-payload',now()+interval'2 days',now()+interval'4 days',2,now())",[uid]);oldLifecycle=(await pool.query('SELECT * FROM lifecycle_emails')).rows;
  }
  await migrate(db,{migrationsFolder:'drizzle'});const finalLedger=(await pool.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id')).rows;assert.equal(finalLedger.length,16);assert.deepEqual(finalLedger.slice(0,ledger.length),ledger);
  const col=(await pool.query("SELECT is_nullable,column_default FROM information_schema.columns WHERE table_name='outbox_emails' AND column_name='sender_meta'")).rows[0];assert.equal(col.is_nullable,'YES');assert.equal(col.column_default,null);
  if(oldMail.length){const after=(await pool.query('SELECT * FROM outbox_emails ORDER BY id')).rows;assert(after.every(r=>r.sender_meta===null));assert.deepEqual(after.map(({sender_meta,...rest})=>rest),oldMail);assert.deepEqual((await pool.query('SELECT * FROM lifecycle_emails')).rows,oldLifecycle);}
  const fresh=(await pool.query("INSERT INTO outbox_emails(\"to\",subject,text,sender_meta) VALUES('new@test.local','Founder','New content',$1) RETURNING sender_meta",[JSON.stringify({from:'Ekene from Radar <same@example.test>',replyTo:'team@thally.io'})])).rows[0];assert.equal(fresh.sender_meta.replyTo,'team@thally.io');
  await migrate(db,{migrationsFolder:'drizzle'});assert.deepEqual((await pool.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id')).rows,finalLedger);
  results.push({mode,database:name,migrations:16,oldLedger:'unchanged',newColumn:'nullable/no-default',oldSenderMetadata:oldMail.length?'NULL; no backfill':'not-applicable',oldBodiesAndRetiredHistory:oldMail.length?'unchanged':'not-applicable',secondMigrate:'no-op'});
 }finally{await pool.end();}
}}finally{await admin.end();}
await writeFile('.factory/lifecycle-refinement/founder-voice-migrations.json',JSON.stringify({base,results},null,2)+'\n');console.log(JSON.stringify({base,results},null,2));
