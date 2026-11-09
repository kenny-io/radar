import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {and,eq,inArray} from 'drizzle-orm';
import {db,pool,schema} from '@/server/db';
import {env} from '@/server/env';
import {encrypt} from '@/server/crypto';
import {Fixtures} from '@/server/testing/fixtures';
import {collectGuides} from '@/server/services/lifecycle/guides';
import {collectEducation,educationContext} from '@/server/services/lifecycle/education';
import {queueLifecycle} from '@/server/services/lifecycle/queue';
import {dispatchLifecycleBatch} from '@/server/services/lifecycle/dispatch';
import {educationPreferenceToken,updateEducationPreference} from '@/server/services/lifecycle/preferences';
import {renderLifecycle as renderBefore} from '../before-source/lifecycle/templates';
import {BASE,DAY,requireLocalDatabase,owner,messages,payload,fakeProvider,posts,dispatch} from './fixtures';
const F=new Fixtures('lc2-independent-delivery'),G=schema.lifecycleGuideStates,M=schema.lifecycleEmails,E=schema.educationEnrollments;
const state=async(uid:string)=>(await db.select().from(G).where(and(eq(G.userId,uid),eq(G.guideId,'article_workflow'))))[0];
async function queued(){const {u,b}=await owner(F);await collectGuides(BASE,[u.id]);const due=new Date(BASE.getTime()+DAY);vi.setSystemTime(due);await collectGuides(due,[u.id]);return {u,b,due,row:(await messages(u.id)).find(m=>m.type==='lifecycle_guide')!};}
function oldEnvelope(type:any,u:{id:string;name:string;email:string},data:any){const mail=renderBefore(type,data,{appUrl:env.appUrl,unsubscribeUrl:env.appUrl+'/email-preferences?token='+encodeURIComponent(educationPreferenceToken(u.id))});return {data,envelope:{from:env.mailFrom,to:[u.email],subject:mail.subject,text:mail.text,html:mail.html,reply_to:mail.replyTo,...(type==='weekly_education'?{headers:{'List-Unsubscribe':`<${env.appUrl}/api/email-preferences?token=${encodeURIComponent(educationPreferenceToken(u.id))}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}}:{})}};}
beforeEach(()=>{requireLocalDatabase();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(BASE);process.env.RADAR_EDUCATION_EMAILS='1';process.env.RADAR_BILLING='on';env.devStubs=false;env.resendKey='qa-not-real';env.stripeSecretKey='sk_test_local_nonfunctional';});
afterEach(async()=>{await db.delete(G).where(inArray(G.userId,F.users));await db.delete(E).where(inArray(E.userId,F.users));await F.cleanup();vi.useRealTimers();});
describe('LC2 independent in-flight compatibility, dispatch and atomicity',()=>{
 it('sends an old queued core envelope unchanged rather than replaying it to deliver new copy',async()=>{
  const {u}=await owner(F);const data={name:u.name,profileAnalyzed:false};await queueLifecycle(db,{userId:u.id,type:'welcome',eventKey:'welcome:'+u.id,data,sendAt:BASE});const row=(await messages(u.id))[0],old=oldEnvelope('welcome',u,data);await db.update(M).set({payloadEnc:encrypt(old)}).where(eq(M.id,row.id));const f=fakeProvider();await dispatch([u.id],BASE,f);await dispatch([u.id],BASE,f);expect(posts(f)).toHaveLength(1);expect(posts(f)[0][1]?.body).toBe(JSON.stringify(old.envelope));expect(posts(f)[0][1]?.headers).toMatchObject({'Idempotency-Key':'radar-lifecycle/'+row.id});
 });
 it('retains an attempted old weekly envelope/key and course identity through the rewrite',async()=>{
  const {u}=await owner(F);const data={name:u.name,education:{version:1 as const,lesson:'ai_visibility' as const,...await educationContext(u.id)}};await queueLifecycle(db,{userId:u.id,type:'weekly_education',eventKey:`education:v1:${u.id}:ai_visibility`,data,sendAt:BASE});const row=(await messages(u.id))[0],old=oldEnvelope('weekly_education',u,data);await db.update(M).set({payloadEnc:encrypt(old),firstAttemptAt:new Date(BASE.getTime()-60000),attempts:1}).where(eq(M.id,row.id));await db.insert(E).values({userId:u.id,nextLesson:0,pendingEmailId:row.id,nextDueAt:BASE,status:'active'});const f=fakeProvider();await dispatch([u.id],BASE,f);expect(posts(f)).toHaveLength(1);expect(posts(f)[0][1]?.body).toBe(JSON.stringify(old.envelope));expect((await db.select().from(E).where(eq(E.userId,u.id)))[0]).toMatchObject({version:1,nextLesson:1});
 });
 it('retries guide with immutable body/key despite profile text change, then does not reenroll sent history',async()=>{
  const {u,b,due,row}=await queued();let tries=0;const f=vi.fn(async(_url:string,init?:RequestInit)=>init?.method==='GET'?new Response('',{status:404}):new Response(++tries===1?'':'{"id":"qa-guide-retry"}',{status:tries===1?503:200}));await dispatch([u.id],due,f);expect((await state(u.id)).status).toBe('queued');await db.update(schema.users).set({name:'A different display name'}).where(eq(schema.users.id,u.id));await db.update(schema.businesses).set({profile:{...b.profile,business:{...b.profile.business,name:'A different business name'}}}).where(eq(schema.businesses.id,b.id));const retry=new Date(due.getTime()+60000);vi.setSystemTime(retry);await dispatch([u.id],retry,f);const p=f.mock.calls.filter(([,i])=>i?.method==='POST');expect(p).toHaveLength(2);expect(p[0][1]?.body).toBe(p[1][1]?.body);expect(p[0][1]?.headers).toEqual(p[1][1]?.headers);expect((await state(u.id)).status).toBe('sent');await collectGuides(new Date(retry.getTime()+20*DAY),[u.id]);expect((await messages(u.id)).filter(m=>m.type==='lifecycle_guide')).toHaveLength(1);expect(payload((await messages(u.id)).find(m=>m.id===row.id)!).envelope).toEqual(JSON.parse(p[0][1]?.body as string));
 });
 it('blocks attempted optout and unsafe ownership/access retries without reopening after reenabling',async()=>{
  const {u,due}=await queued();const f=vi.fn(async(_url:string,init?:RequestInit)=>init?.method==='GET'?new Response('',{status:404}):new Response('',{status:503}));await dispatch([u.id],due,f);await updateEducationPreference(u.id,false,due);const retry=new Date(due.getTime()+60000);await dispatch([u.id],retry,f);expect(f.mock.calls.filter(([,i])=>i?.method==='POST')).toHaveLength(1);expect((await state(u.id)).status).toBe('blocked');await updateEducationPreference(u.id,true,retry);await collectGuides(new Date(retry.getTime()+DAY),[u.id]);expect((await state(u.id)).status).toBe('blocked');
 });
 it('rolls back provider acknowledgment and guide progression together on an injected database failure',async()=>{
  const {u,due}=await queued();const f=fakeProvider();await pool.query("CREATE OR REPLACE FUNCTION qa_lc2_reject_ack() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = '"+u.id+"'::uuid AND NEW.status = 'sent' THEN RAISE EXCEPTION 'QA injected guide acknowledgment failure'; END IF; RETURN NEW; END $$");await pool.query('CREATE TRIGGER qa_lc2_ack_failure BEFORE UPDATE ON lifecycle_guide_states FOR EACH ROW EXECUTE FUNCTION qa_lc2_reject_ack()');
  try{await dispatch([u.id],due,f);expect((await state(u.id)).status).toBe('queued');expect((await messages(u.id)).find(m=>m.type==='lifecycle_guide')?.status).toBe('queued');}
  finally{await pool.query('DROP TRIGGER qa_lc2_ack_failure ON lifecycle_guide_states');await pool.query('DROP FUNCTION qa_lc2_reject_ack()');}
  await dispatch([u.id],new Date(due.getTime()+60000),f);expect(posts(f)).toHaveLength(2);expect(posts(f)[0][1]?.body).toBe(posts(f)[1][1]?.body);expect(posts(f)[0][1]?.headers).toEqual(posts(f)[1][1]?.headers);expect((await state(u.id)).status).toBe('sent');
 });
 it('orders transactional→weekly→guide→founder and enforces the rolling optional cap',async()=>{
  const {u,due}=await queued();await collectEducation(due,[u.id]);await queueLifecycle(db,{userId:u.id,type:'founder_note',eventKey:'founder:'+u.id,data:{},sendAt:due});await queueLifecycle(db,{userId:u.id,type:'invoice_paid',eventKey:'invoice-priority:'+u.id,data:{amountCents:5000},sendAt:due});const f=fakeProvider();await dispatchLifecycleBatch({now:due,clock:()=>due,userIds:[u.id],fetch:f as any,sleep:async()=>{},limit:1});expect((await messages(u.id)).find(m=>m.type==='invoice_paid')?.status).toBe('sent');await dispatch([u.id],due,f);expect((await messages(u.id)).find(m=>m.type==='weekly_education')?.status).toBe('sent');expect((await state(u.id)).status).toBe('queued');
  const next=new Date(due.getTime()+DAY);vi.setSystemTime(next);await dispatch([u.id],next,f);expect((await state(u.id)).status).toBe('sent');expect((await messages(u.id)).find(m=>m.type==='founder_note')?.attempts).toBe(0);expect(posts(f)).toHaveLength(3);
 });
 it('fails closed on unknown preflight errors, honors optout after restricted-key lookup and never advances simulated mail',async()=>{
  const {u,due}=await queued();const invalid=vi.fn(async()=>new Response('{"name":"invalid_api_key"}',{status:401}));await dispatch([u.id],due,invalid);expect(invalid).toHaveBeenCalledTimes(1);expect((await messages(u.id)).find(m=>m.type==='lifecycle_guide')?.attempts).toBe(0);expect((await state(u.id)).status).toBe('queued');
  const later=new Date(due.getTime()+3600e3);const restricted=vi.fn(async()=>{await updateEducationPreference(u.id,false,later);return new Response('{"name":"restricted_api_key"}',{status:401});});await dispatch([u.id],later,restricted);expect(restricted).toHaveBeenCalledTimes(1);await updateEducationPreference(u.id,true,later);env.devStubs=true;const none=fakeProvider();await dispatch([u.id],later,none);expect(none).not.toHaveBeenCalled();expect((await state(u.id)).status).not.toBe('sent');
 });
 it('protects pending guide history from direct outbox deletion and permits normal account cleanup',async()=>{
  const {u,b,row}=await queued();await expect(db.delete(M).where(eq(M.id,row.id))).rejects.toThrow();await db.delete(schema.businesses).where(eq(schema.businesses.id,b.id));await db.delete(schema.users).where(eq(schema.users.id,u.id));expect(await state(u.id)).toBeUndefined();expect(await messages(u.id)).toHaveLength(0);
 });
});
