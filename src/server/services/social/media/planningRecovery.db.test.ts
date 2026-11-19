import {beforeAll,afterAll,beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
vi.hoisted(()=>{process.env.RADAR_DEV_STUBS='1';process.env.RADAR_BILLING='off';});
import {randomUUID} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {db,pool,schema as S} from '@/server/db';
import {defaultProfile} from '@/server/workspace';
import {prepareMedia,generateMedia,runMediaGeneration,retryMedia,mediaNotes} from './index';
import {getPack} from '../generate';
import type {Generation} from './model';
import * as draw from './draw';
import * as narration from './narration';
const evidence='A worker claims approved work when it is due and saves an accepted receipt before checking upload status. It retains that reference when resuming a status check.';
describe.skipIf(!process.env.DATABASE_URL)('lease-bound planning recovery and source authority',()=>{
 let owner:string,bid:string,packId:string,entry:string;
 const row=async(id:string)=>(await pool.query<Generation>('SELECT * FROM social_media_generations WHERE id=$1',[id])).rows[0];
 const prepare=async()=>{const result=await prepareMedia(bid,packId,['instagram']);const r=(await pool.query<Generation>('SELECT * FROM social_media_generations WHERE business_id=$1 AND request_version=$2',[bid,result.requestId])).rows[0];expect(await runMediaGeneration(bid,r.id)).toEqual({prepared:true});return await row(r.id);};
 beforeAll(async()=>{const [u]=await db.insert(S.users).values({email:`recovery-${randomUUID()}@test.local`,name:'Recovery fixture'}).returning();owner=u.id;const [b]=await db.insert(S.businesses).values({ownerId:owner,status:'active',domain:'recovery.test',profile:defaultProfile('recovery.test')}).returning();bid=b.id;});
 beforeEach(async()=>{packId='recovery-'+randomUUID();entry='entry-'+randomUUID();await db.insert(S.calendarEntries).values({id:entry,businessId:bid,title:'A receipt workflow',kw:'receipt',type:'Explainer',date:'2026-11-19',status:'draft'});await db.insert(S.articles).values({entryId:entry,businessId:bid,data:{generated:true,body:[['p',evidence]]}});await db.insert(S.socialPacks).values({id:packId,businessId:bid,data:{id:packId,name:'A receipt workflow',source:{kind:'article',label:'A receipt workflow',ref:entry},created:'2026-11-19',style:'branded',auto:false,posts:{instagram:{text:'Receipt workflow',style:'branded',seed:1,imageUrl:'/previous.jpg',copiedAt:null,v:0}}}});});
 afterEach(()=>vi.restoreAllMocks());
 afterAll(async()=>{await db.delete(S.businesses).where(eq(S.businesses.id,bid));await db.delete(S.users).where(eq(S.users.id,owner));});
 it('clears old reviewed authority before a changed-source preparation fails, then retries the new candidate',async()=>{
  const before=await prepare();before.checkpoint.plan!.topic='Old source authority';await pool.query('UPDATE social_media_generations SET checkpoint=$2 WHERE id=$1',[before.id,before.checkpoint]);
  await db.update(S.articles).set({data:{generated:true,body:[['p',evidence+' Updated detail: completed checks retain a receipt for the next worker.']]}}).where(eq(S.articles.entryId,entry));
  const request=await prepareMedia(bid,packId,['instagram']);const frame=vi.spyOn(draw,'carouselFrame').mockImplementation(()=>{throw new Error('PRIVATE_NATIVE_MARKER');});const voice=vi.spyOn(narration,'narrationFor');
  expect(await runMediaGeneration(bid,before.id)).toEqual({status:'failed',code:'media_plan_internal'});
  let failed=await row(before.id);expect(failed.checkpoint.source!.brief).toContain('Updated detail');expect(failed.checkpoint.plan).toBeUndefined();expect(failed.checkpoint.planSourceHash).toBeUndefined();expect(failed.checkpoint.planMaxDuration).toBeUndefined();expect(failed.checkpoint.planningRecovery!.candidate.topic).not.toBe('Old source authority');
  expect(JSON.stringify(failed.checkpoint.planningRecovery!.diagnostic)).not.toContain('PRIVATE_NATIVE_MARKER');expect((await getPack(bid,packId))!.posts.instagram!.mediaGeneration!.stage).not.toContain('PRIVATE_NATIVE_MARKER');
  await expect(mediaNotes(bid,before.id,'script')).rejects.toMatchObject({status:404});
  frame.mockRestore();await retryMedia(bid,before.id);expect((await row(before.id)).status).toBe('preparing');expect((await getPack(bid,packId))!.posts.instagram!.mediaGeneration!.status).toBe('preparing');
  expect(await runMediaGeneration(bid,before.id)).toEqual({prepared:true});failed=await row(before.id);expect(failed.checkpoint.plan!.topic).not.toBe('Old source authority');expect(failed.checkpoint.planSourceHash).toBe(failed.source_hash);expect(failed.checkpoint.planMaxDuration).toBe(180);expect(failed.checkpoint.planningRecovery).toBeUndefined();expect(voice).not.toHaveBeenCalled();expect(request.requestId).not.toBe(before.request_version);
 });
 it('automatically stops a dispatched correction and only explicit Retry restores its allowance',async()=>{
  const prepared=await prepare();const candidate=prepared.checkpoint.plan!;const cp={...prepared.checkpoint,plan:undefined,planSourceHash:undefined,planMaxDuration:undefined,planningRecovery:{version:1,sourceHash:prepared.source_hash,maxDuration:180,candidate,repair:'dispatched'}};
  await pool.query("UPDATE social_media_generations SET status='preparing',checkpoint=$2 WHERE id=$1",[prepared.id,cp]);
  expect(await runMediaGeneration(bid,prepared.id)).toEqual({status:'failed',code:'media_plan_interrupted'});expect((await row(prepared.id)).checkpoint.planningRecovery!.repair).toBe('dispatched');
  await retryMedia(bid,prepared.id);expect((await row(prepared.id)).checkpoint.planningRecovery!.repair).toBe('available');expect(await runMediaGeneration(bid,prepared.id)).toEqual({prepared:true});
 });
 it('re-enters preparation for a legacy recommendation while preserving format and previous attachment',async()=>{
  const prepared=await prepare();delete prepared.checkpoint.planSourceHash;delete prepared.checkpoint.planMaxDuration;await pool.query('UPDATE social_media_generations SET checkpoint=$2 WHERE id=$1',[prepared.id,prepared.checkpoint]);
  const result=await generateMedia(bid,packId,[{platform:'instagram',format:'carousel'}],prepared.request_version);
  const pending=await row(result.generationIds[0]);expect(pending.status).toBe('preparing');expect(pending.checkpoint.requestedChoices).toEqual([{platform:'instagram',format:'carousel',videoStyle:'drawn'}]);expect(pending.checkpoint.options!.generateAfterPrepare).toBe(true);
  expect((await getPack(bid,packId))!.posts.instagram!.imageUrl).toBe('/previous.jpg');expect(pending.checkpoint.planOnly).toBe(true);
 });
 it('Generate transparently reprepares changed bound sources with the chosen format',async()=>{
  const before=await prepare();await db.update(S.articles).set({data:{generated:true,body:[['p',evidence+' A completed receipt is available to the next worker.']]}}).where(eq(S.articles.entryId,entry));
  const refreshed=await generateMedia(bid,packId,[{platform:'instagram',format:'carousel'}],before.request_version);const pending=await row(refreshed.generationIds[0]);
  expect(pending.status).toBe('preparing');expect(pending.checkpoint.options!.generateAfterPrepare).toBe(true);expect(pending.checkpoint.requestedChoices).toEqual([{platform:'instagram',format:'carousel',videoStyle:'drawn'}]);expect(pending.request_version).not.toBe(before.request_version);
  expect((await getPack(bid,packId))!.posts.instagram!.imageUrl).toBe('/previous.jpg');expect(await runMediaGeneration(bid,pending.id)).toEqual({prepared:true});
  const prepared=await row(pending.id);expect(prepared.source_hash).not.toBe(before.source_hash);expect(prepared.checkpoint.planSourceHash).toBe(prepared.source_hash);
 });
 it('transfers newly reviewed bindings to a same-plan legacy cache without discarding paid audio',async()=>{
  const prepared=await prepare();const derived=await generateMedia(bid,packId,[{platform:'instagram',format:'video'}],prepared.request_version);const cached=await row(derived.generationIds[0]);delete cached.checkpoint.planSourceHash;delete cached.checkpoint.planMaxDuration;cached.checkpoint.audioUrl='/paid-cached-audio.mp3';
  await pool.query("UPDATE social_media_generations SET status='failed',checkpoint=$2 WHERE id=$1",[cached.id,cached.checkpoint]);
  const refresh=await prepareMedia(bid,packId,['instagram']);expect(await runMediaGeneration(bid,prepared.id)).toEqual({prepared:true});
  const reused=await generateMedia(bid,packId,[{platform:'instagram',format:'video'}],refresh.requestId);expect(reused.generationIds).toEqual([cached.id]);
  const bound=await row(cached.id);expect(bound.checkpoint.audioUrl).toBe('/paid-cached-audio.mp3');expect(bound.checkpoint.planSourceHash).toBe(bound.source_hash);expect(bound.checkpoint.planMaxDuration).toBe(180);
 });
});
