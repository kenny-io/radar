// Local-only, fresh-database proof; no providers or running workers.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
const adminUrl = process.env.LC2_LOCAL_ADMIN_URL || 'postgres://postgres@127.0.0.1:54329/postgres';
const url = new URL(adminUrl); assert(['127.0.0.1','localhost'].includes(url.hostname)); assert.equal(url.pathname,'/postgres');
const admin = new pg.Client({connectionString:adminUrl}); await admin.connect();
const journal = JSON.parse(await readFile('drizzle/meta/_journal.json','utf8'));
const dir = await mkdtemp(path.join(tmpdir(),'radar-lc2-upgrade-')); await mkdir(path.join(dir,'meta'));
const entries = journal.entries.filter(e=>e.idx<=12); await writeFile(path.join(dir,'meta/_journal.json'),JSON.stringify({...journal,entries})); for(const e of entries) await copyFile(`drizzle/${e.tag}.sql`,path.join(dir,`${e.tag}.sql`));
const results=[];
try { for(const mode of ['clean','upgrade']) {
  const name=`radar_lc2_${mode}_${Date.now()}`; assert(/^radar_lc2_\w+$/.test(name)); await admin.query(`CREATE DATABASE "${name}"`);
  const conn=new URL(adminUrl); conn.pathname='/'+name; const pool=new pg.Pool({connectionString:conn.href});
  try {
    const db=drizzle(pool); let uid,mid,before;
    if(mode==='upgrade') {
      await migrate(db,{migrationsFolder:dir});
      await assert.rejects(pool.query('SELECT guide_id FROM lifecycle_guide_states LIMIT 0'));
      uid=(await pool.query("INSERT INTO users(name,email,email_verified_at) VALUES('Old','old@test.local',now()) RETURNING id")).rows[0].id;
      await pool.query('INSERT INTO user_email_preferences(user_id,education,onboarding,daily_brief) VALUES($1,false,false,false)',[uid]);
      mid=(await pool.query("INSERT INTO lifecycle_emails(user_id,event_key,type,payload_enc,status,attempts,first_attempt_at,expires_at) VALUES($1,$2,'weekly_education','frozen-before-refinement','queued',1,now(),now()+interval'1 day') RETURNING id",[uid,`education:v1:${uid}:organic_search`])).rows[0].id;
      await pool.query("INSERT INTO education_enrollments(user_id,next_lesson,pending_email_id,last_accepted_at) VALUES($1,3,$2,now()-interval'8 days')",[uid,mid]);
      before=(await pool.query('SELECT payload_enc,attempts,first_attempt_at FROM lifecycle_emails WHERE id=$1',[mid])).rows[0];
    }
    await migrate(db,{migrationsFolder:'drizzle'});
    assert.equal(Number((await pool.query('SELECT count(*) FROM drizzle.__drizzle_migrations')).rows[0].count),14);
    await pool.query('SELECT g.guide_id,g.first_observed_at,g.pending_email_id,g.source_business_id FROM lifecycle_guide_states g LIMIT 0');
    assert.equal((await pool.query('SELECT * FROM lifecycle_guide_states')).rowCount,0,'Migration cannot enroll/send guides');
    if(mode==='upgrade') {
      assert.deepEqual((await pool.query('SELECT payload_enc,attempts,first_attempt_at FROM lifecycle_emails WHERE id=$1',[mid])).rows[0],before);
      assert.equal((await pool.query('SELECT next_lesson FROM education_enrollments WHERE user_id=$1',[uid])).rows[0].next_lesson,3);
      assert.equal((await pool.query('SELECT education FROM user_email_preferences WHERE user_id=$1',[uid])).rows[0].education,false);
    }
    const fresh=(await pool.query("INSERT INTO users(name,email,email_verified_at) VALUES('Fresh','fresh@test.local',now()) RETURNING id")).rows[0].id;
    const mail=(await pool.query("INSERT INTO lifecycle_emails(user_id,event_key,type,payload_enc,expires_at) VALUES($1,$2,'lifecycle_guide','test-only',now()+interval'30 days') RETURNING id",[fresh,`guide:v1:${fresh}:article_workflow`])).rows[0].id;
    await pool.query("INSERT INTO lifecycle_guide_states(user_id,guide_id,due_at,pending_email_id,status) VALUES($1,'article_workflow',now(),$2,'queued')",[fresh,mail]);
    await assert.rejects(pool.query('DELETE FROM lifecycle_emails WHERE id=$1',[mail])); await pool.query('DELETE FROM users WHERE id=$1',[fresh]); assert.equal((await pool.query('SELECT id FROM lifecycle_emails WHERE id=$1',[mail])).rowCount,0);
    results.push({mode,database:name,migrations:14,readiness:'passed',migrationEnrollmentCount:0,pendingDelete:'restricted',accountCascade:'passed',oldProgressAndAttemptedPayload:mode==='upgrade'?'unchanged':'not-applicable'});
  } finally {await pool.end();}
} } finally {await admin.end();}
await writeFile('.factory/lifecycle-refinement/runtime-migrations.json',JSON.stringify({results},null,2)+'\n'); console.log(JSON.stringify({results},null,2));
