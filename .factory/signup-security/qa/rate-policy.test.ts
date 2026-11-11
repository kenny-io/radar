import {afterAll,afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const H=vi.hoisted(()=>({jar:new Map<string,string>()}));
vi.mock('next/headers',async()=>(await import('@/server/testing/jar')).headersMock(()=>H.jar));
import {eq,like,sql} from'drizzle-orm';
import {db,schema}from'@/server/db';
import{env}from'@/server/env';
import{POST as signup}from'@/app/api/auth/signup/route';
import{POST as resend}from'@/app/api/auth/verification/resend/route';
import{sha256}from'@/server/crypto';
const prefix='policyqa-'+Date.now();let counter=0;
const address=()=>`${prefix}-${counter++}@test.local`;
const req=(email:string,ip=prefix+'-'+counter++)=>new Request('http://localhost:3810/api/auth',{method:'POST',headers:{'x-forwarded-for':ip},body:JSON.stringify({name:'Independent rate QA',email})});
let send:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 Object.assign(env,{isProd:true,devStubs:false,signupTurnstileRequired:false,turnstileSiteKey:'',turnstileSecretKey:'',resendKey:'mocked-sender-key'});
 send=vi.fn(async(url:string)=>{if(url!=='https://api.resend.com/emails')throw new Error('Unexpected outbound provider request');return Response.json({id:'synthetic-mail'});});vi.stubGlobal('fetch',send);
});
afterEach(()=>{H.jar.clear();vi.unstubAllGlobals();});
afterAll(async()=>{await db.delete(schema.users).where(like(schema.users.email,prefix+'%'));await db.delete(schema.outboxEmails).where(like(schema.outboxEmails.to,prefix+'%'));});
describe('independent production rate-only policy',()=>{
 it('allows pending signup with mocked sender, no Turnstile keys/token, no authentication and redacted security mail',async()=>{
  const email=address(),r=await signup(req(email));expect(r.status).toBe(200);expect(await r.json()).toEqual({ok:true,verificationRequired:true});
  const[u]=await db.select().from(schema.users).where(eq(schema.users.email,email));expect(u.emailVerifiedAt).toBeNull();expect(u.passwordHash).toBeNull();expect(H.jar.has('radar_session')).toBe(false);
  expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][0]).toBe('https://api.resend.com/emails');
  const[mail]=await db.select().from(schema.outboxEmails).where(eq(schema.outboxEmails.to,email));expect(mail.text).toBe('[Security email content redacted]');expect(mail.html).toBeNull();
 });
 it('caps mixed signup/resend requests at exactly ten per IP per hour',async()=>{
  const ip=prefix+'-combined',emails=Array.from({length:5},address);
  for(const email of emails)expect((await signup(req(email,ip))).status).toBe(200);
  for(const email of emails)expect((await resend(req(email,ip))).status).toBe(200);
  const denied=address();expect((await signup(req(denied,ip))).status).toBe(429);expect(await db.select().from(schema.users).where(eq(schema.users.email,denied))).toHaveLength(0);expect(send).toHaveBeenCalledTimes(10);
 });
 it('caps a target address at three confirmation requests across different IPs',async()=>{
  const email=address();expect((await signup(req(email))).status).toBe(200);expect((await resend(req(email))).status).toBe(200);expect((await resend(req(email))).status).toBe(200);expect((await signup(req(email))).status).toBe(429);expect(send).toHaveBeenCalledTimes(3);
 });
 it('enforces global300 before inserting/sending',async()=>{
  await db.execute(sql`INSERT INTO rate_limits(key,window_start,count) VALUES('auth:verification:global@3600',to_timestamp(floor(extract(epoch from now())/3600)*3600),300) ON CONFLICT(key,window_start) DO UPDATE SET count=300`);
  const email=address();try{const r=await signup(req(email));expect(r.status).toBe(503);expect((await r.json()).code).toBe('busy');expect(send).not.toHaveBeenCalled();expect(await db.select().from(schema.users).where(eq(schema.users.email,email))).toHaveLength(0);}finally{await db.delete(schema.rateLimits).where(eq(schema.rateLimits.key,'auth:verification:global@3600'));}
 });
 it('requires sender even when challenge disabled and fails closed when challenge explicitly enabled',async()=>{
  env.resendKey='';let r=await signup(req(address()));expect(r.status).toBe(503);expect((await r.json()).code).toBe('auth_unavailable');
  env.resendKey='mocked-sender-key';env.signupTurnstileRequired=true;r=await signup(req(address()));expect(r.status).toBe(503);expect((await r.json()).code).toBe('auth_unavailable');
  env.turnstileSiteKey='synthetic-real-shaped-key';env.turnstileSecretKey='synthetic-private-key';const email=address();r=await signup(req(email));expect(r.status).toBe(403);expect((await r.json()).code).toBe('human_check_failed');expect(send).not.toHaveBeenCalled();
  const hits=await db.execute(sql`SELECT key FROM rate_limits WHERE key=${'auth:verification:email:'+sha256(email)+'@3600'}`);expect(hits.rows).toHaveLength(0);
 });
});
