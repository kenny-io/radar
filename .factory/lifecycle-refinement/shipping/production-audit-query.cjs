const {Client}=require('pg');
(async()=>{
const client=new Client({connectionString:process.env.DATABASE_URL,application_name:'radar-email-release-readonly-audit',connectionTimeoutMillis:10000,query_timeout:10000});
try{
 await client.connect(); await client.query('BEGIN READ ONLY');
 const tables=(await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE '%email%' OR table_name LIKE '%education%' OR table_name LIKE '%guide%' OR table_name='ai_observations') ORDER BY table_name")).rows;
 const migrations=(await client.query('SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at')).rows;
 const present=new Set(tables.map(r=>r.table_name)); const counts={};
 for(const name of ['lifecycle_emails','engagement_events','education_enrollments','lifecycle_guide_states','ai_observations']) if(present.has(name)){
  const grouping=name==='lifecycle_emails'?'type,status':name==='engagement_events'?'kind,resolved_reason':name==='education_enrollments'?'status':name==='lifecycle_guide_states'?'guide_id,status':null;
  counts[name]=(await client.query(grouping?`SELECT ${grouping},count(*)::int AS count FROM ${name} GROUP BY ${grouping} ORDER BY ${grouping}`:`SELECT count(*)::int AS count FROM ${name}`)).rows;
 }
 const verified=(await client.query('SELECT count(*)::int AS accounts,count(*) FILTER(WHERE NOT guest AND email_verified_at IS NOT NULL)::int AS verified_accounts FROM users')).rows[0];
 const constraints=present.has('lifecycle_guide_states')?(await client.query("SELECT conname,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='lifecycle_guide_states'::regclass AND conname='lifecycle_guide_id_check'")).rows:[];
 await client.query('ROLLBACK');console.log(JSON.stringify({checkedAt:new Date().toISOString(),tables,migrations,counts,verified,constraints},null,2));
}catch(error){console.error(JSON.stringify({error:error.code||error.name}));process.exitCode=1;}finally{await client.end();}

})().catch(()=>{console.error('audit failed');process.exitCode=1;});
