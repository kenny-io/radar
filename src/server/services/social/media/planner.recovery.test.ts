import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({run:vi.fn()}));
vi.mock('@/server/ai',()=>({ai:{run:mocks.run},profileContext:()=>''}));
import {env} from '@/server/env';
import {RadarError} from '@/server/errors';
import {planExplanation,stubPlan} from './planner';
import {hash,planningSourcePatch,planningDiagnostic,type PlanningRecovery,type Checkpoint} from './model';
import * as draw from './draw';
const source={title:'How a queue saves a receipt',brief:'Owner reference: a worker saves the accepted receipt before checking status. It reuses the receipt when resuming a status check.',link:null};
const good=()=>stubPlan(source);
const bad=()=>{const p=good();p.scenes[0].cues[0].phrase='Missing phrase';return p;};
const pass={pass:true,problems:[]};
const old=env.devStubs;
let saved:PlanningRecovery[]=[];
const options=(checkpoint?:PlanningRecovery)=>({sourceHash:hash(source),checkpoint,save:async(value:PlanningRecovery)=>{saved.push(structuredClone(value));}});
const run=(checkpoint?:PlanningRecovery)=>planExplanation('synthetic-business','synthetic-generation',source,async()=>{},async()=>{},180,options(checkpoint));
const state=(repair:PlanningRecovery['repair'],candidate=good()):PlanningRecovery=>({version:1,sourceHash:hash(source),maxDuration:180,candidate,repair});
beforeEach(()=>{env.devStubs=false;saved=[];});
afterEach(()=>{env.devStubs=old;mocks.run.mockReset();vi.restoreAllMocks();});
describe('private durable storyboard recovery',()=>{
 it('checkpoints the invalid initial candidate before semantic validation, then spends its single correction',async()=>{
  mocks.run.mockImplementation(async(_task,request)=>{
   if(request.purpose==='social.media.plan')return {json:bad()};
   if(request.purpose==='social.media.revise'){expect(saved.at(-1)?.repair).toBe('dispatched');expect(saved.at(-1)?.diagnostic).toEqual({phase:'semantic',code:'cue_phrase',scene:0});return {json:good()};}
   return {json:pass};
  });
  await run();expect(saved[0].candidate.scenes[0].cues[0].phrase).toBe('Missing phrase');
  expect(saved.map(s=>s.repair)).toEqual(['available','available','dispatched','completed']);
  expect(mocks.run.mock.calls.map(c=>c[1].purpose)).toEqual(['social.media.plan','social.media.revise','social.media.review','social.media.review']);
  for(const c of mocks.run.mock.calls.filter(c=>c[1].purpose!=='social.media.review'))expect(c[1]).toMatchObject({maxTokens:12000,timeoutMs:120000});
 });
 it('uses the same single allowance for a semantic defect followed by a factual review failure',async()=>{
  mocks.run.mockResolvedValueOnce({json:bad()}).mockResolvedValueOnce({json:good()}).mockResolvedValue({json:{pass:false,problems:['A source qualification is absent.']}});
  await expect(run()).rejects.toMatchObject({code:'media_review_failed'});
  expect(mocks.run.mock.calls.map(c=>c[1].purpose)).toEqual(['social.media.plan','social.media.revise','social.media.review']);
  expect(saved.at(-1)?.repair).toBe('completed');
 });
 it.each(['layout','duration']as const)('repairs a known %s defect before both reviews',async(kind)=>{
  const p=good();if(kind==='layout')p.scenes[0].narration+=' '+('W'.repeat(200));else for(const scene of p.scenes)scene.narration+=' '+Array(30).fill('word').join(' ');
  mocks.run.mockResolvedValueOnce({json:p}).mockResolvedValueOnce({json:good()}).mockResolvedValue({json:pass});
  await planExplanation('synthetic-business','synthetic-generation',source,async()=>{},async()=>{},kind==='duration'?70:180,{...options(),checkpoint:undefined});
  expect(saved.some(s=>s.diagnostic?.phase===kind)).toBe(true);expect(mocks.run).toHaveBeenCalledTimes(4);
 });
 it('resumes an available candidate without another full plan request',async()=>{
  mocks.run.mockResolvedValue({json:pass});await run(state('available'));
  expect(mocks.run.mock.calls.map(c=>c[1].purpose)).toEqual(['social.media.review','social.media.review']);
 });
 it('resumes a completed corrected candidate but cannot acquire another correction',async()=>{
  mocks.run.mockResolvedValue({json:{pass:false,problems:['Still unsupported.']}});
  await expect(run(state('completed'))).rejects.toMatchObject({code:'media_review_failed'});
  expect(mocks.run).toHaveBeenCalledTimes(1);expect(saved.at(-1)?.repair).toBe('completed');
 });
 it('halts an uncertain dispatched correction without any automatic AI request',async()=>{
  await expect(run(state('dispatched'))).rejects.toMatchObject({code:'media_plan_interrupted'});expect(mocks.run).not.toHaveBeenCalled();
 });
 it('awaits durable candidate persistence and refuses correction if that guarded save fails',async()=>{
  mocks.run.mockResolvedValueOnce({json:bad()});
  const save=vi.fn(async()=>{throw new RadarError('Request changed',409,'media_cancelled');});
  await expect(planExplanation('synthetic-business','synthetic-generation',source,async()=>{},async()=>{},180,{...options(),save})).rejects.toMatchObject({code:'media_cancelled'});
  expect(mocks.run).toHaveBeenCalledTimes(1);
 });
 it('does not spend a correction on a font/runtime failure and records only safe diagnostics',async()=>{
  const marker='SECRET_SOURCE_MARKER';vi.spyOn(draw,'carouselFrame').mockImplementation(()=>{throw new Error(marker);});
  mocks.run.mockResolvedValueOnce({json:good()});await expect(run()).rejects.toMatchObject({code:'media_plan_internal'});
  expect(mocks.run).toHaveBeenCalledTimes(1);expect(saved.at(-1)?.diagnostic?.code).toBe('media_plan_internal');
  expect(JSON.stringify(saved.at(-1)?.diagnostic)).not.toContain(marker);
 });
 it('keeps review echo markers out of public failure copy and persisted diagnostics',async()=>{
  mocks.run.mockResolvedValue({json:{pass:false,problems:['SECRET_REVIEW_MARKER https://private.example']}});
  const error=await run(state('completed')).catch(e=>e);expect(error.code).toBe('media_review_failed');expect(error.message).not.toContain('SECRET_REVIEW_MARKER');
  expect(JSON.stringify(saved.at(-1)?.diagnostic)).toBe('{"phase":"mechanism","code":"mechanism_review"}');
 });
 it('clears stale and legacy authorities before assigning a new source or duration cap',()=>{
  const cp:Checkpoint={source,plan:good(),planSourceHash:hash(source),planMaxDuration:180,planningRecovery:state('available')};
  expect(planningSourcePatch(cp,source,180).plan).toBeUndefined(); // no destructive plan property on matching patch
  expect(Object.hasOwn(planningSourcePatch(cp,source,180),'plan')).toBe(false);
  const changed={...source,brief:source.brief+' New factual detail.'};
  for(const patch of [planningSourcePatch(cp,changed,180),planningSourcePatch(cp,source,60),planningSourcePatch({plan:good()},source,180)]){
   expect(Object.hasOwn(patch,'plan')).toBe(true);expect(patch.plan).toBeUndefined();expect(patch.planSourceHash).toBeUndefined();expect(patch.planningRecovery).toBeUndefined();
  }
 });
 it('only records bounded relative module frames, never exception text or external stack paths',()=>{
  const e=new Error('SOURCE_MARKER');e.stack='SOURCE_MARKER\n at /private/secret.ts:1:2\n at /repo/src/server/services/social/media/draw.ts:8:9\n at /repo/src/server/services/social/media/planner.ts:10:4';
  expect(planningDiagnostic(e)).toEqual({phase:'unexpected',code:'media_plan_internal',frames:['src/server/services/social/media/draw.ts:8:9','src/server/services/social/media/planner.ts:10:4']});
 });
});
