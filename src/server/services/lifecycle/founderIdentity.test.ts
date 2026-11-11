import { weeklyRecommendationShare } from '@/lib/recommendationShare';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, schema } from '@/server/db';
import { env } from '@/server/env';
import { encrypt, sha256 } from '@/server/crypto';
import { Fixtures } from '@/server/testing/fixtures';
import { sendMail, sendAuthMail } from '../mail';
import { founderFrom, FOUNDER_REPLY_TO } from '../mailIdentity';
import { queueLifecycle, lifecyclePayload } from './queue';
import { dispatchLifecycleBatch } from './dispatch';
import { LIFECYCLE_TYPES } from './templates';
const F=new Fixtures(),emails:string[]=[],M=schema.lifecycleEmails,O=schema.outboxEmails;
const prior={from:env.mailFrom,key:env.resendKey,stub:env.devStubs};
const now=new Date('2026-11-10T12:00:00Z'),from='Service name <Radar+Alerts@Example.TEST>';
const outbox=(email:string)=>db.select().from(O).where(eq(O.to,email));
const provider=()=>vi.fn(async(_url:string|URL|Request,_init?:RequestInit)=>new Response('{"id":"founder-identity-test"}'));
async function user(){const u=await F.user();emails.push(u.email);return u;}
const idFor=(key:string)=>{const hash=sha256(key).slice(0,32);return `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`;};
async function retired(uid:string,type='trial_ending',extra:Partial<typeof M.$inferInsert>={}){
 const [row]=await db.insert(M).values({userId:uid,type,eventKey:'retired:'+randomUUID(),payloadEnc:'unreadable-legacy-history',nextAttemptAt:now,expiresAt:new Date(now.getTime()-864e5),...extra}).returning();return row;
}

describe('founder identity formatter',()=>{
 it.each(['Radar+Alerts@Example.TEST',from])('preserves the exact configured mailbox from%s',value=>{expect(founderFrom(value)).toBe('Ekene from Radar <Radar+Alerts@Example.TEST>');});
 it.each(['x@example.test\r\nBcc: other@example.test','x@example.test\u0000','a@example.test, b@example.test','A <a@example.test>, B <b@example.test>','a@example.test, B <b@example.test>'])('rejects header controls or multiple configured mailboxes',value=>{expect(()=>founderFrom(value)).toThrow('Invalid configured mail sender');});
});

describe.skipIf(!process.env.DATABASE_URL)('founder transport and retired-message safety (fake provider only)',()=>{
 beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);env.mailFrom=from;env.resendKey='not-a-real-key';env.devStubs=false;});
 afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();Object.assign(env,{mailFrom:prior.from,resendKey:prior.key,devStubs:prior.stub});});
 afterAll(async()=>{await F.cleanup();if(emails.length)await db.delete(O).where(inArray(O.to,emails));});
 it('refuses direct retired queue calls before rendering and excludes the type from active inventory',async()=>{
  const u=await user();await queueLifecycle(db,{type:'trial_ending',userId:u.id,eventKey:'retired-direct:'+u.id,data:{}});
  await queueLifecycle(db,{type:'workspace_ready' as any,userId:u.id,eventKey:'retired-workspace:'+u.id,data:{}});
  expect(await db.select().from(M).where(eq(M.userId,u.id))).toHaveLength(0);expect(LIFECYCLE_TYPES as readonly string[]).not.toContain('trial_ending');
 });
 it.each(['trial_ending','workspace_ready'])('retires future/due/expired/malformed/attempted %s rows even without credentials, preserving history',async type=>{
  const u=await user(),first=new Date(now.getTime()-3600e3);
  const originals=[await retired(u.id,type),await retired(u.id,type,{nextAttemptAt:new Date(now.getTime()+30*864e5)}),await retired(u.id,type,{attempts:3,firstAttemptAt:first,providerId:'ambiguous-ack'})];
  env.resendKey='';const fake=provider();await dispatchLifecycleBatch({userIds:[u.id],now,fetch:fake,sleep:async()=>{}});expect(fake).not.toHaveBeenCalled();
  for(const original of originals){const [saved]=await db.select().from(M).where(eq(M.id,original.id));expect(saved).toMatchObject({status:'suppressed',lastError:'retired_type',attempts:original.attempts,firstAttemptAt:original.firstAttemptAt,providerId:original.providerId,payloadEnc:original.payloadEnc,eventKey:original.eventKey,sentAt:original.sentAt});}
 });
 it('reclaims only stale retired leases and preserves sent/logged/failed history plus live claims',async()=>{
  const u=await user(),old=new Date(now.getTime()-3*60e3),token=randomUUID();
  const stale=await retired(u.id,'trial_ending',{status:'sending',claimedAt:old,claimToken:token,attempts:2,firstAttemptAt:old});
  const live=await retired(u.id,'trial_ending',{status:'sending',claimedAt:now,claimToken:randomUUID(),attempts:1,firstAttemptAt:now});
  const history=[];for(const status of ['sent','logged','failed'] as const)history.push(await retired(u.id,'trial_ending',{status,sentAt:status==='sent'?old:null,providerId:status==='sent'?'prior-acceptance':null,attempts:1}));
  const fake=provider();await dispatchLifecycleBatch({userIds:[u.id],now,fetch:fake,sleep:async()=>{}});expect(fake).not.toHaveBeenCalled();
  const [saved]=await db.select().from(M).where(eq(M.id,stale.id));expect(saved).toMatchObject({status:'suppressed',lastError:'retired_type',attempts:2,payloadEnc:stale.payloadEnc,firstAttemptAt:old});
  expect((await db.select().from(M).where(eq(M.id,live.id)))[0]).toEqual(live);for(const original of history)expect((await db.select().from(M).where(eq(M.id,original.id)))[0]).toEqual(original);
 });
 it('uses founder From and matching visible/team Reply-To for every newly rendered active lifecycle type',async()=>{
  const u=await user(),bid=randomUUID(),data={aiReport:{version:1 as const,businessId:bid,ownerId:u.id,domain:'example.test',series:'1'.repeat(64),periodEnd:'2026-11-09',summary:{series:'1'.repeat(64),weekly:weeklyRecommendationShare([{promptId:'fixture',engine:'ChatGPT',status:'mentioned',series:'1'.repeat(64),day:'2026-11-08',measuredAt:'2026-11-08T12:00:00Z'}],'1'.repeat(64),'example.test',new Date('2026-11-09T12:00:00Z')),weeklyBiggestMiss:null}},trialEnd:new Date(now.getTime()+864e5).toISOString(),periodEnd:new Date(now.getTime()+864e5).toISOString(),resetUrl:env.appUrl+'/reset-password#token=not-real',education:{version:1 as const,lesson:'ai_visibility' as const,context:{gscConnected:false,access:'workspace' as const}},guide:{version:1 as const,id:'article_workflow' as const,context:{gscConnected:false,access:'workspace' as const}},workSections:[{eventId:randomUUID(),businessId:bid,businessName:'A business',kind:'brief_reply' as const,ref:'2026-11-10',count:1}]};
  for(const type of LIFECYCLE_TYPES){const p=lifecyclePayload(type,u,data);expect(p.envelope.from).toBe(founderFrom(from));expect(p.envelope.reply_to).toBe(FOUNDER_REPLY_TO);expect(p.envelope.text).toContain(FOUNDER_REPLY_TO);expect(p.envelope.html).toContain('mailto:'+FOUNDER_REPLY_TO);}
 });
 it('persists new general sender metadata before POST and freezes the entire retry envelope across config/option changes',async()=>{
  const u=await user(),key='founder-retry:'+u.id;const fake=vi.fn(async(_url:string|URL|Request,_init?:RequestInit)=>{expect((await outbox(u.email))[0].senderMeta).toEqual({from:founderFrom(from),replyTo:FOUNDER_REPLY_TO});return new Response('',{status:503});});vi.stubGlobal('fetch',fake);
  await expect(sendMail(u.email,'Original subject','Original content','<p>Original</p>',{idempotencyKey:key})).rejects.toThrow();
  env.mailFrom='Other deployment <new@example.test>';await expect(sendMail(u.email,'Changed subject','Changed content',undefined,{idempotencyKey:key,identity:'service'})).rejects.toThrow();
  expect(fake).toHaveBeenCalledTimes(2);expect(fake.mock.calls[0][1]?.body).toBe(fake.mock.calls[1][1]?.body);expect(JSON.parse(fake.mock.calls[0][1]?.body as string)).toMatchObject({from:founderFrom(from),reply_to:FOUNDER_REPLY_TO});expect(fake.mock.calls[0][1]?.headers).toEqual(fake.mock.calls[1][1]?.headers);
 });
 it('does not retrofit historical NULL metadata and preserves the legacy From/no-Reply-To envelope',async()=>{
  const u=await user(),key='historical:'+u.id;await db.insert(O).values({id:idFor(key),to:u.email,subject:'Historical subject',text:'Historical private text',status:'failed',createdAt:now,senderMeta:null});
  const fake=provider();vi.stubGlobal('fetch',fake);await sendMail(u.email,'New founder subject','New founder text',undefined,{idempotencyKey:key});
  const body=JSON.parse(fake.mock.calls[0][1]?.body as string);expect(body.from).toBe(from);expect(body).not.toHaveProperty('reply_to');expect(body.subject).toBe('Historical subject');expect(body.text).toBe('Historical private text');expect((await outbox(u.email))[0].senderMeta).toBeNull();
 });
 it('keeps new internal service forwards separate and does not let retries override the stored identity',async()=>{
  const u=await user(),key='service:'+u.id,fake=vi.fn(async(_url:string|URL|Request,_init?:RequestInit)=>new Response('',{status:503}));vi.stubGlobal('fetch',fake);
  await expect(sendMail(u.email,'Internal forward','Request details',undefined,{idempotencyKey:key,identity:'service'})).rejects.toThrow();
  await expect(sendMail(u.email,'Founder override','Changed',undefined,{idempotencyKey:key,identity:'founder'})).rejects.toThrow();const body=JSON.parse(fake.mock.calls[0][1]?.body as string);expect(body.from).toBe(from);expect(body).not.toHaveProperty('reply_to');expect(fake.mock.calls[1][1]?.body).toBe(fake.mock.calls[0][1]?.body);
 });
 it('uses founder identity for fresh security confirmation while retaining content redaction',async()=>{
  const u=await user(),fake=provider();vi.stubGlobal('fetch',fake);await sendAuthMail(u.email,'Confirmation bearer-secret');
  const body=JSON.parse(fake.mock.calls[0][1]?.body as string);expect(body).toMatchObject({from:founderFrom(from),reply_to:FOUNDER_REPLY_TO,to:[u.email]});const [saved]=await outbox(u.email);expect(saved.senderMeta).toEqual({from:founderFrom(from),replyTo:FOUNDER_REPLY_TO});expect(saved.text).not.toContain('bearer-secret');
 });
});
