// Authorized release smoke. Only a new nonhuman Resend simulator account, no business or billing actions.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const action=process.argv[2];
if(!['create','inspect','cleanup'].includes(action))throw new Error('Choose create, inspect or cleanup');
const file=new URL('../../../.data/email-release-simulator.json',import.meta.url);
const previous=action==='create'?null:JSON.parse(readFileSync(file,'utf8'));
const code=`(async()=>{
const {Client}=require('pg'),crypto=require('crypto'),bcrypt=require('bcryptjs');
const client=new Client({connectionString:process.env.DATABASE_URL,application_name:'radar-email-release-simulator',connectionTimeoutMillis:10000,query_timeout:10000});
await client.connect();
try{
const action=${JSON.stringify(action)},previous=${JSON.stringify(previous?{id:previous.id,email:previous.email}:null)};
if(action==='create'){
 const email='delivered+radar-email-release-'+crypto.randomBytes(8).toString('hex')+'@resend.dev';
 const password=crypto.randomBytes(32).toString('base64url');
 const passwordHash=await bcrypt.hash(password,12);
 const r=await client.query('INSERT INTO users(name,email,password_hash,email_verified_at) VALUES($1,$2,$3,now()) RETURNING id',['Radar release simulator',email,passwordHash]);
 console.log(JSON.stringify({id:r.rows[0].id,email,password,origin:process.env.APP_URL,createdAt:new Date().toISOString()}));
}else{
 if(!previous||!/^delivered\\+radar-email-release-[a-f0-9-]+@resend\\.dev$/.test(previous.email))throw new Error('Simulator identity required');
 const u=await client.query('SELECT id FROM users WHERE id=$1 AND email=$2 AND name=$3',[previous.id,previous.email,'Radar release simulator']);
 if(u.rowCount!==1)throw new Error('Exact simulator account not found');
 if(action==='inspect'){
  const rows=await client.query('SELECT id,type,status,attempts,provider_id,first_attempt_at,sent_at,last_error FROM lifecycle_emails WHERE user_id=$1 ORDER BY created_at',[previous.id]);
  console.log(JSON.stringify({simulator:true,rows:rows.rows}));
 }else{
  await client.query('BEGIN');
  const owned=await client.query('SELECT id FROM businesses WHERE owner_id=$1',[previous.id]);
  if(owned.rowCount)throw new Error('Refusing to remove a simulator with a business');
  const d=await client.query('DELETE FROM users WHERE id=$1 AND email=$2 AND name=$3 RETURNING id',[previous.id,previous.email,'Radar release simulator']);
  await client.query('COMMIT');console.log(JSON.stringify({simulator:true,deleted:d.rowCount}));
 }
}
}finally{await client.end();}
})().catch(e=>{console.error(JSON.stringify({error:e.code||e.name}));process.exitCode=1;});`;
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const raw=execFileSync('railway',['ssh','--service','web','--environment','production','--','node -e '+quote(code)],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
const result=JSON.parse(raw.trim());
if(action==='create'){mkdirSync(new URL('../../../.data/',import.meta.url),{recursive:true});writeFileSync(file,JSON.stringify(result),{mode:0o600});console.log(JSON.stringify({simulator:true,created:true,credentialsFile:file.pathname}));}
else console.log(JSON.stringify(result));
