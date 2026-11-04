import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {drizzle} from 'drizzle-orm/node-postgres';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
const root=process.cwd();
const env=JSON.parse(await fs.readFile('.data/signup-security/local-env.json','utf8'));
const url=new URL(env.DATABASE_URL);assert.equal(url.hostname,'localhost');assert.equal(url.port,'54329');
const database='radar_signup_qa_migration_'+Date.now();
const adminUrl=new URL(url);adminUrl.pathname='/postgres';const admin=new pg.Pool({connectionString:adminUrl.toString()});let pool;
const out='.data/signup-security/qa';await fs.mkdir(out,{recursive:true});
const journal=JSON.parse(await fs.readFile('drizzle/meta/_journal.json','utf8'));const previous=journal.entries.filter(x=>x.idx<9);
const migrations=path.resolve(out,'pre-migrations');await fs.mkdir(path.join(migrations,'meta'),{recursive:true});await fs.writeFile(path.join(migrations,'meta/_journal.json'),JSON.stringify({...journal,entries:previous}));
for(const entry of previous)await fs.copyFile('drizzle/'+entry.tag+'.sql',path.join(migrations,entry.tag+'.sql'));
const startedAt=new Date().toISOString();
try{
 await admin.query('CREATE DATABASE '+database);url.pathname='/'+database;pool=new pg.Pool({connectionString:url.toString()});
 await migrate(drizzle(pool),{migrationsFolder:migrations});
 const ids=Array.from({length:4},()=>crypto.randomUUID());const [password,google,mixed,guest]=ids;
 for(const [i,id]of ids.entries())await pool.query('INSERT INTO users(id,name,email,password_hash,google_sub,guest) VALUES($1,$2,$3,$4,$5,$6)',[id,'QA migration',i===3?'guest+qa@guest.radar.invalid':`qa-migrate-${i}@test.local`,i===0||i===2?'old-password-hash':null,i===1||i===2?'google-sub-'+i:null,i===3]);
 const sessions=ids.map(()=>crypto.randomBytes(32).toString('hex'));
 for(const [i,id]of ids.entries())await pool.query("INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",[sessions[i],id]);
 const business=crypto.randomUUID(),member=crypto.randomUUID();
 await pool.query("INSERT INTO businesses(id,owner_id,domain,status,profile) VALUES($1,$2,'qa-migration.test','active','{}')",[business,password]);
 await pool.query("INSERT INTO members(id,business_id,user_id,email,role,status) VALUES($1,$2,$3,'qa-migrate-0@test.local','Owner','active')",[member,business,password]);
 await pool.query("INSERT INTO billing_accounts(user_id,comp,status,stripe_customer_id,stripe_subscription_id) VALUES($1,true,'active','qa-customer','qa-subscription')",[password]);
 const before={business:(await pool.query('SELECT * FROM businesses WHERE id=$1',[business])).rows[0],member:(await pool.query('SELECT * FROM members WHERE id=$1',[member])).rows[0],billing:(await pool.query('SELECT * FROM billing_accounts WHERE user_id=$1',[password])).rows[0]};
 await migrate(drizzle(pool),{migrationsFolder:path.resolve('drizzle')});
 const rows=(await pool.query('SELECT id,password_hash,google_sub,guest,email_verified_at FROM users WHERE id=ANY($1)',[ids])).rows;
 const byId=Object.fromEntries(rows.map(r=>[r.id,r]));
 assert.equal(byId[password].email_verified_at,null);assert.equal(byId[password].password_hash,'old-password-hash');
 for(const id of[google,mixed]){assert(byId[id].email_verified_at);assert.equal(byId[id].password_hash,null);assert(byId[id].google_sub);}
 assert.equal(byId[guest].email_verified_at,null);assert.equal(byId[guest].guest,true);
 assert.deepEqual((await pool.query('SELECT user_id FROM sessions')).rows.map(r=>r.user_id),[guest]);
 for(const [table,idCol,id,key]of[['businesses','id',business,'business'],['members','id',member,'member'],['billing_accounts','user_id',password,'billing']])assert.deepEqual((await pool.query(`SELECT * FROM ${table} WHERE ${idCol}=$1`,[id])).rows[0],before[key]);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM email_verification_tokens')).rows[0].n,0);
 // A second migration invocation is idempotent and must not clear new post-rollout sessions.
 await pool.query("INSERT INTO sessions(id,user_id,expires_at) VALUES('post-rollout-session',$1,now()+interval '1 day')",[google]);
 await migrate(drizzle(pool),{migrationsFolder:path.resolve('drizzle')});
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM sessions WHERE id='post-rollout-session'")).rows[0].n,1);
 const result={pass:true,startedAt,finishedAt:new Date().toISOString(),checks:['Actual pre-0009 schema migrated through Drizzle','Password-only remains unverified','Google-only/mixed verified and unsafe hashes removed','All non-guest sessions revoked; guest preserved','Business/member/billing entire rows unchanged','Token table empty','Migration re-run preserves new sessions']};
 await fs.writeFile(out+'/migration-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(pool)await pool.end();await admin.query('DROP DATABASE IF EXISTS '+database+' WITH (FORCE)');await admin.end();}
