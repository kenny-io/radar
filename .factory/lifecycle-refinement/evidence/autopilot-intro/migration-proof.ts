/** Local-only reproducible upgrade/readiness proof. No transport, collector or provider calls. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
const uri = process.env.DATABASE_URL!;
const endpoint = new URL(uri);
assert.equal(endpoint.hostname, '127.0.0.1'); assert.equal(endpoint.port, '54329');
const folder = await mkdtemp(join(tmpdir(), 'radar-intro-old-'));
const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'));
const previous = { ...journal, entries: journal.entries.filter((entry: {idx:number}) => entry.idx < 16) };
await mkdir(join(folder, 'meta'));
await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(previous));
for (const entry of previous.entries) await copyFile(`drizzle/${entry.tag}.sql`, join(folder, `${entry.tag}.sql`));
const { db, pool } = await import('../../../../src/server/db/index');
const { waitForWorkerSchema } = await import('../../../../src/server/db/workerReady');
const ledger = async () => (await pool.query('SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at')).rows;
const snapshots = async () => Object.fromEntries(await Promise.all(['education_enrollments','lifecycle_guide_states','lifecycle_emails','user_email_preferences'].map(async table => [table, (await pool.query(`SELECT * FROM ${table} ORDER BY 1,2`)).rows])));
try {
  await migrate(db, { migrationsFolder: folder });
  assert.equal((await ledger()).length, 16);
  await assert.rejects(waitForWorkerSchema({ timeoutMs: 0, log: () => {} }), /schema is not ready/);
  const uid = randomUUID(), mid = randomUUID();
  await pool.query("INSERT INTO users(id,name,email,email_verified_at) VALUES($1,'Migration fixture',$2,now())", [uid, `migration-${uid}@test.local`]);
  await pool.query("INSERT INTO education_enrollments(user_id,next_lesson,status,last_accepted_at) VALUES($1,5,'completed',now())", [uid]);
  await pool.query("INSERT INTO lifecycle_emails(id,user_id,event_key,type,payload_enc,expires_at,first_attempt_at,attempts) VALUES($1,$2,$3,'lifecycle_guide','frozen-fixture',now()+interval '1 day',now(),1)", [mid,uid,`guide:v1:${uid}:search_refresh`]);
  await pool.query("INSERT INTO lifecycle_guide_states(user_id,guide_id,due_at,status,sent_at) VALUES($1,'article_workflow',now(),'sent',now())", [uid]);
  await pool.query("INSERT INTO lifecycle_guide_states(user_id,guide_id,due_at,status,pending_email_id) VALUES($1,'search_refresh',now(),'queued',$2)", [uid,mid]);
  await pool.query('INSERT INTO user_email_preferences(user_id,education,onboarding) VALUES($1,false,false)', [uid]);
  await assert.rejects(pool.query("INSERT INTO lifecycle_guide_states(user_id,guide_id,due_at) VALUES($1,'autopilot_intro',now())", [uid]), /lifecycle_guide_id_check/);
  const before = await snapshots(), oldLedger = await ledger();
  await migrate(db, { migrationsFolder: './drizzle' });
  assert.deepEqual(await snapshots(), before);
  assert.deepEqual((await ledger()).slice(0,16), oldLedger);
  assert.equal((await ledger()).length,17);
  await waitForWorkerSchema({ timeoutMs:0, log:()=>{} });
  await pool.query("INSERT INTO lifecycle_guide_states(user_id,guide_id,due_at) VALUES($1,'autopilot_intro',now()+interval '48 hours')", [uid]);
  const after = await snapshots(), fullLedger = await ledger();
  await migrate(db, { migrationsFolder:'./drizzle' });
  assert.deepEqual(await snapshots(),after); assert.deepEqual(await ledger(),fullLedger);
  const cleanUri = new URL(uri); cleanUri.pathname += '_clean';
  const adminUri = new URL(uri); adminUri.pathname = '/postgres'; const admin = new pg.Pool({connectionString:adminUri.toString()});
  const cleanName = cleanUri.pathname.slice(1); assert.match(cleanName,/^radar_[a-z0-9_]+$/);
  await admin.query(`CREATE DATABASE ${cleanName}`); await admin.end();
  const clean = new pg.Pool({ connectionString:cleanUri.toString() });
  try { await migrate(drizzle(clean),{migrationsFolder:'./drizzle'}); assert.equal((await clean.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')).rows[0].n,17); }
  finally { await clean.end(); }
  const proof = { base:'22267d421851bde1504282a9b0375d2e1713ecbf', migration:'0016_autopilot_intro', checks:{ clean17:true, upgrade15to16:true, oldReadinessRejected:true, newReadinessAccepted:true, oldCheckRejectsIntro:true, newCheckAdmitsIntro:true, completedCoursePreserved:true, bothGuideHistoriesAndFrozenAttemptPreserved:true, explicitOptoutPreserved:true, prior16LedgerRowsUnchanged:true, rerunNoop:true }, migrationSha256:createHash('sha256').update(await readFile('drizzle/0016_autopilot_intro.sql')).digest('hex') };
  await writeFile('.factory/lifecycle-refinement/evidence/autopilot-intro/migration-results.json', JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify(proof,null,2));
} finally { await pool.end(); await rm(folder,{recursive:true,force:true}); }
