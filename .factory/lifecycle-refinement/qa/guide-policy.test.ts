import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {and,eq,inArray} from 'drizzle-orm';
import {db,schema} from '@/server/db';
import {env} from '@/server/env';
import {Fixtures,uniq} from '@/server/testing/fixtures';
import {collectGuides} from '@/server/services/lifecycle/guides';
import {queueLifecycle} from '@/server/services/lifecycle/queue';
import {updateEducationPreference,stopOnboarding} from '@/server/services/lifecycle/preferences';
import {BASE,DAY,requireLocalDatabase,owner,messages,payload,fakeProvider,posts,dispatch} from './fixtures';
const F=new Fixtures('lc2-independent-guides'),G=schema.lifecycleGuideStates,M=schema.lifecycleEmails;
const state=async(uid:string,id='article_workflow')=>(await db.select().from(G).where(and(eq(G.userId,uid),eq(G.guideId,id as any))))[0];
const onlyGuide=async(uid:string,id='article_workflow')=>(await messages(uid)).find(m=>m.eventKey===`guide:v1:${uid}:${id}`)!;
async function acceptedOrganic(uid:string,at=new Date(BASE.getTime()-8*DAY),status='sent'){
 await queueLifecycle(db,{userId:uid,type:'weekly_education',eventKey:`education:v1:${uid}:organic_search`,data:{education:{version:1,lesson:'organic_search',context:{access:'workspace',gscConnected:true}}},sendAt:at});
 await db.update(M).set({status:status as any,sentAt:status==='sent'?at:null,firstAttemptAt:at}).where(eq(M.eventKey,`education:v1:${uid}:organic_search`));
}
async function gsc(bid:string,at=BASE,extra:{date?:string;impressions?:number;kind?:'page'|'query';status?:'connected'|'error'}={}){
 await db.insert(schema.gscConnections).values({businessId:bid,status:extra.status||'connected',property:'sc-domain:qa.test',lastSyncedThrough:'2026-11-09',updatedAt:new Date('2021-01-01')}).onConflictDoUpdate({target:schema.gscConnections.businessId,set:{status:extra.status||'connected'}});
 await db.insert(schema.gscRows).values({businessId:bid,kind:extra.kind||'page',date:extra.date||'2026-11-09',key:'https://qa.test/useful-'+uniq(),clicks:2,impressions:extra.impressions??20,ctr:0.1,position:14});
}
beforeEach(()=>{requireLocalDatabase();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(BASE);process.env.RADAR_EDUCATION_EMAILS='1';process.env.RADAR_BILLING='on';env.devStubs=false;env.resendKey='qa-not-real';env.stripeSecretKey='sk_test_local_nonfunctional';});
afterEach(async()=>{await db.delete(G).where(inArray(G.userId,F.users));await F.cleanup();vi.useRealTimers();});
describe('LC2 independent guide timing, relevance and history',()=>{
 it('anchors old and new owners to first observation with workspace24h versus savedpretrial/lapsed3days',async()=>{
  for(const mode of ['workspace','pretrial','lapsed'] as const){const u=await F.user();await db.update(schema.users).set({createdAt:new Date('2020-01-01')}).where(eq(schema.users.id,u.id));if(mode==='workspace')await F.account(u.id,{comp:true});if(mode==='lapsed')await F.account(u.id,{status:'canceled',stripeSubscriptionId:'sub_local'});await F.biz(u,{status:mode==='workspace'?'active':'onboarding',onboarding:{savedAt:'2020-01-01'},createdAt:new Date('2020-01-01')});
   await collectGuides(BASE,[u.id]);const s=await state(u.id);expect(s.firstObservedAt).toEqual(BASE);expect(s.dueAt.getTime()-BASE.getTime()).toBe((mode==='workspace'?1:3)*DAY);expect(await onlyGuide(u.id)).toBeUndefined();
  }
 });
 it('shortens after access is gained without ever postponing an existing due time',async()=>{
  const u=await F.user(),b=await F.biz(u,{status:'onboarding',onboarding:{savedAt:BASE.toISOString()}});await collectGuides(BASE,[u.id]);await F.account(u.id,{comp:true});await db.update(schema.businesses).set({status:'active'}).where(eq(schema.businesses.id,b.id));const gain=new Date(BASE.getTime()+6*3600e3);vi.setSystemTime(gain);await collectGuides(gain,[u.id]);const due=(await state(u.id)).dueAt;expect(due.getTime()).toBe(gain.getTime()+DAY);
  await collectGuides(new Date(gain.getTime()+12*3600e3),[u.id]);expect((await state(u.id)).dueAt).toEqual(due);
 });
 it('keeps proposed topics eligible but permanently skips meaningful work on any owned business',async()=>{
  const {u,b}=await owner(F);await db.insert(schema.calendarEntries).values({id:uniq(),businessId:b.id,title:'Proposed topic',kw:'test',type:'guide',date:'2026-11-15',status:'proposed'});await collectGuides(BASE,[u.id]);expect((await state(u.id)).status).toBe('waiting');
  const other=await F.biz(u);const id=uniq();await db.insert(schema.calendarEntries).values({id,businessId:other.id,title:'An approved topic',kw:'test',type:'guide',date:'2026-11-15',status:'approved'});await collectGuides(BASE,[u.id]);expect((await state(u.id)).status).toBe('skipped');await db.delete(schema.calendarEntries).where(eq(schema.calendarEntries.id,id));await updateEducationPreference(u.id,false,BASE);await updateEducationPreference(u.id,true,BASE);await collectGuides(new Date(BASE.getTime()+5*DAY),[u.id]);expect(await onlyGuide(u.id)).toBeUndefined();
 });
 it('excludes guests, unverified, inheritedoptout and member-only profiles without borrowing another owner data',async()=>{
  const guest=await F.user({guest:true}),unverified=await F.user({verified:false}),off=await F.user(),member=await F.user();for(const u of [guest,unverified,off])await F.biz(u);await stopOnboarding(off.id);const {b}=await owner(F);await F.member(b.id,member);
  await collectGuides(BASE,[guest.id,unverified.id,off.id,member.id]);for(const id of [guest.id,unverified.id,off.id,member.id])expect(await state(id)).toBeUndefined();
 });
 it('concurrent observation/queue/send is once per account and does not change course progress',async()=>{
  const {u}=await owner(F);await Promise.all([collectGuides(BASE,[u.id]),collectGuides(BASE,[u.id])]);const due=new Date(BASE.getTime()+DAY);vi.setSystemTime(due);await Promise.all([collectGuides(due,[u.id]),collectGuides(due,[u.id])]);expect((await messages(u.id)).filter(m=>m.type==='lifecycle_guide')).toHaveLength(1);const f=fakeProvider();await Promise.all([dispatch([u.id],due,f),dispatch([u.id],due,f)]);expect(posts(f)).toHaveLength(1);expect((await state(u.id)).status).toBe('sent');expect(await db.select().from(schema.educationEnrollments).where(eq(schema.educationEnrollments.userId,u.id))).toHaveLength(0);
  await updateEducationPreference(u.id,false,due);await updateEducationPreference(u.id,true,due);await collectGuides(new Date(due.getTime()+90*DAY),[u.id]);expect((await messages(u.id)).filter(m=>m.type==='lifecycle_guide')).toHaveLength(1);
 });
 it('requires measured completed-day page data plus actual Organic acceptance, not logged or attempted rows',async()=>{
  for(const mode of ['sent','logged','queued','missing'] as const){const {u,b}=await owner(F);await gsc(b.id);if(mode!=='missing')await acceptedOrganic(u.id,undefined,mode);await collectGuides(BASE,[u.id]);const s=await state(u.id,'search_refresh');if(mode==='sent'){expect(s.firstObservedAt).toEqual(BASE);expect(s.dueAt.getTime()).toBe(BASE.getTime()+DAY);}else expect(s).toBeUndefined();}
 });
 it('excludes zero, stale, current, future, query-only and disconnected measurements',async()=>{
  for(const extra of [{impressions:0},{date:'2026-10-01'},{date:'2026-11-10'},{date:'2026-11-11'},{kind:'query' as const},{status:'error' as const}]){const {u,b}=await owner(F);await acceptedOrganic(u.id);await gsc(b.id,BASE,extra);await collectGuides(BASE,[u.id]);expect(await state(u.id,'search_refresh')).toBeUndefined();}
 });
 it('uses business-local completed days at both sides of UTC midnight and respects organic+7days',async()=>{
  const {u,b}=await owner(F);await db.update(schema.businesses).set({timezone:'Asia/Dubai'}).where(eq(schema.businesses.id,b.id));const observed=new Date('2026-11-10T21:00:00Z');await acceptedOrganic(u.id,new Date('2026-11-05T12:00:00Z'));await gsc(b.id,observed,{date:'2026-11-10'});vi.setSystemTime(observed);await collectGuides(observed,[u.id]);expect((await state(u.id,'search_refresh')).dueAt.toISOString()).toBe('2026-11-12T12:00:00.000Z');
  const {u:v,b:c}=await owner(F);await db.update(schema.businesses).set({timezone:'Pacific/Honolulu'}).where(eq(schema.businesses.id,c.id));await acceptedOrganic(v.id);await gsc(c.id,BASE,{date:'2026-11-09'});const earlier=new Date('2026-11-10T03:00:00Z');vi.setSystemTime(earlier);await collectGuides(earlier,[v.id]);expect(await state(v.id,'search_refresh')).toBeUndefined();
 });
 it('keeps paused unattempted work beyond30days and resumes the same pending message',async()=>{
  const {u}=await owner(F);await collectGuides(BASE,[u.id]);const due=new Date(BASE.getTime()+DAY);vi.setSystemTime(due);await collectGuides(due,[u.id]);const original=await onlyGuide(u.id);await updateEducationPreference(u.id,false,due);const later=new Date(due.getTime()+40*DAY);vi.setSystemTime(later);let f=fakeProvider();await dispatch([u.id],later,f);expect(posts(f)).toHaveLength(0);await updateEducationPreference(u.id,true,later);await dispatch([u.id],later,f);expect((await state(u.id)).status).toBe('sent');expect((await onlyGuide(u.id)).id).toBe(original.id);
 });
 it('rechecks workflow and recipient immediately before send and never rebinds a deleted source business',async()=>{
  for(const mode of ['workflow','recipient','deleted'] as const){const {u,b}=await owner(F);await collectGuides(BASE,[u.id]);const due=new Date(BASE.getTime()+DAY);vi.setSystemTime(due);await collectGuides(due,[u.id]);if(mode==='workflow')await db.insert(schema.calendarEntries).values({id:uniq(),businessId:b.id,title:'Started topic',kw:'test',type:'guide',date:'2026-11-15',status:'approved'});if(mode==='recipient')await db.update(schema.users).set({email:'changed-'+u.email}).where(eq(schema.users.id,u.id));if(mode==='deleted'){await db.delete(schema.businesses).where(eq(schema.businesses.id,b.id));await F.biz(u);}
   const f=fakeProvider();await dispatch([u.id],due,f);expect(posts(f)).toHaveLength(0);expect(['skipped','blocked']).toContain((await state(u.id)).status);expect((await onlyGuide(u.id)).businessId).toBeNull();
  }
 });
 it('bounds missing-search-data deferral and never replays an expired guide under a new key',async()=>{
  const {u,b}=await owner(F);await db.insert(schema.calendarEntries).values({id:uniq(),businessId:b.id,title:'Already started',kw:'test',type:'guide',date:'2026-11-15',status:'approved'});await acceptedOrganic(u.id);await gsc(b.id);await collectGuides(BASE,[u.id]);const due=new Date(BASE.getTime()+DAY);vi.setSystemTime(due);await collectGuides(due,[u.id]);const original=await onlyGuide(u.id,'search_refresh');await db.update(schema.gscConnections).set({status:'error'}).where(eq(schema.gscConnections.businessId,b.id));const f=fakeProvider();await dispatch([u.id],due,f);expect(posts(f)).toHaveLength(0);expect((await state(u.id,'search_refresh')).status).toBe('queued');
  const expired=new Date(due.getTime()+31*DAY);vi.setSystemTime(expired);await dispatch([u.id],expired,f);expect((await state(u.id,'search_refresh')).status).toBe('blocked');expect((await onlyGuide(u.id,'search_refresh')).attempts).toBe(0);await updateEducationPreference(u.id,false,expired);await updateEducationPreference(u.id,true,expired);await collectGuides(expired,[u.id]);expect((await onlyGuide(u.id,'search_refresh')).id).toBe(original.id);
 });
 it('pauses waiting before its due date without inventing a new observation or original delay',async()=>{
  const {u}=await owner(F);await collectGuides(BASE,[u.id]);const original=await state(u.id);await updateEducationPreference(u.id,false,BASE);const later=new Date(BASE.getTime()+40*DAY);vi.setSystemTime(later);await collectGuides(later,[u.id]);expect(await onlyGuide(u.id)).toBeUndefined();await updateEducationPreference(u.id,true,later);await collectGuides(later,[u.id]);expect((await state(u.id)).firstObservedAt).toEqual(original.firstObservedAt);expect((await state(u.id)).dueAt).toEqual(original.dueAt);const f=fakeProvider();await dispatch([u.id],later,f);expect(posts(f)).toHaveLength(1);
 });

});
