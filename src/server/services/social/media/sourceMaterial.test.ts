import { beforeAll,afterAll,beforeEach,describe,it,expect,vi } from 'vitest';
vi.hoisted(()=>{process.env.RADAR_DEV_STUBS='1';process.env.RADAR_BILLING='off';});
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db,pool,schema as S } from '@/server/db';
import { defaultProfile } from '@/server/workspace';
import { profileContext } from '@/server/ai';
import { updatePack } from '../generate';
import { sourceFor } from './planner';
import { prepareMedia,runMediaGeneration } from './index';
import { hasMaterialEvidence } from './material';

const fact='Approved posts wait until their planned time, then a worker records each accepted upload.';
describe('material evidence qualification',()=>{
 it('does not count empty field scaffolding or repeated identity/topic text',()=>{
  const profile=defaultProfile('only-identity.test');profile.business.name='Identity only';
  expect(hasMaterialEvidence([profileContext(profile),'Idea from the user: Hello','Hello','not provided','unknown','N/A','Page title: A very long topic title without any factual body content'])).toBe(false);
 });
 it('does not count voice/language/presentation requests as explanation facts',()=>{
  expect(hasMaterialEvidence(['Hello','Use a warm and friendly voice, with curious delivery and blue captions.','The voice should be calm, patient and engaging.','Language: English, French and German.','Presentation: Write naturally and use a handwritten font.'])).toBe(false);
 });
 it('accepts short useful facts without requiring a padded160-character paragraph',()=>{
  expect(hasMaterialEvidence(['Queues','Workers claim tasks when they are due.'])).toBe(true);
  expect(hasMaterialEvidence(['Content:\n'+fact])).toBe(true);
  expect(hasMaterialEvidence(['任务队列会保存已批准的内容，工作进程在计划时间到达后认领任务并记录上传回执。'])).toBe(true);
 });
});

describe.skipIf(!process.env.DATABASE_URL)('source material boundary before planning',()=>{
 let owner:string,bid:string,packId:string;
 beforeAll(async()=>{
  const [user]=await db.insert(S.users).values({email:`source-material-${randomUUID()}@test.local`,name:'Source material fixture'}).returning();owner=user.id;
  const [business]=await db.insert(S.businesses).values({ownerId:owner,status:'active',domain:'source-material.test',profile:defaultProfile('source-material.test')}).returning();bid=business.id;
 });
 beforeEach(async()=>{
  await db.update(S.businesses).set({profile:defaultProfile('source-material.test')}).where(eq(S.businesses.id,bid));
  await db.delete(S.crawlPages).where(eq(S.crawlPages.businessId,bid));
  packId='material-'+randomUUID();await db.insert(S.socialPacks).values({id:packId,businessId:bid,data:{id:packId,name:'Hello',source:{kind:'idea',label:'Hello'},created:'2026-11-19',style:'branded',auto:false,posts:{youtube:{text:'Hello',style:'branded',seed:1,imageUrl:null,copiedAt:null,v:0}}}});
 });
 afterAll(async()=>{await db.delete(S.businesses).where(eq(S.businesses.id,bid));await db.delete(S.users).where(eq(S.users.id,owner));});
 it('returns actionable needs-source before planning or narration for an empty template and Hello',async()=>{
  const profile=defaultProfile('source-material.test');profile.brand.voice='Use a warm, curious and patient voice with friendly words. '.repeat(8);profile.brand.language='English (US)';
  await db.update(S.businesses).set({profile}).where(eq(S.businesses.id,bid));
  await updatePack(bid,packId,p=>({...p,voice:'Speak naturally and use a very warm, friendly tone. '.repeat(8)}));
  const started=await prepareMedia(bid,packId,['youtube']);const row=(await pool.query('SELECT id FROM social_media_generations WHERE business_id=$1 AND request_version=$2',[bid,started.requestId])).rows[0];
  expect(await runMediaGeneration(bid,row.id)).toEqual({status:'failed',code:'media_needs_source'});
  const state=(await pool.query('SELECT checkpoint FROM social_media_generations WHERE id=$1',[row.id])).rows[0];expect(state.checkpoint.plan).toBeUndefined();
  expect((await pool.query("SELECT id FROM social_media_generations WHERE business_id=$1 AND kind='narration'",[bid])).rowCount).toBe(0);
 });
 it('keeps short-topic requests grounded in actual business facts',async()=>{
  const profile=defaultProfile('source-material.test');profile.business.description='Workers claim approved tasks when their scheduled time arrives.';
  await db.update(S.businesses).set({profile}).where(eq(S.businesses.id,bid));
  await updatePack(bid,packId,p=>({...p,source:{kind:'idea',label:'Queues'}}));
  expect((await sourceFor(bid,packId)).brief).toContain(profile.business.description);
 });
 it('uses substantive existing website text, not a URL or page title alone',async()=>{
  await db.insert(S.crawlPages).values({businessId:bid,url:'https://source-material.test/queue',path:'/queue',kind:'page',title:'A long page title that is only metadata',text:'',description:''});
  await expect(sourceFor(bid,packId)).rejects.toMatchObject({code:'media_needs_source'});
  await db.update(S.crawlPages).set({text:fact}).where(eq(S.crawlPages.businessId,bid));
  expect((await sourceFor(bid,packId)).brief).toContain(fact);
 });
 it('accepts explicit explanation details and rejects presentation-only notes',async()=>{
  await expect(sourceFor(bid,packId,'Use a warm voice, speak slowly, and keep the captions concise.')).rejects.toMatchObject({code:'media_needs_source'});
  expect((await sourceFor(bid,packId,fact)).brief).toContain(fact);
  expect((await sourceFor(bid,packId,'Use a warm voice. '+fact)).brief).toContain(fact);
 });
});
