import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({run:vi.fn()}));
vi.mock('@/server/ai',()=>({ai:{run:mocks.run},profileContext:()=>''}));
import {env} from '@/server/env';
import {stubPlan,stubRegistryDraft,planExplanation} from './planner';
import {RegistryDraftZ,compileRegistryDraft,validatePlan,hash,type PlanningRecovery,type RegistryDraft,type Plan} from './model';
import {carouselFrame,videoFrame} from './draw';
import {timelineFor} from './timeline';
const source={title:'Reproducing a command and adding a navigation link',brief:'Owner-provided: first reproduce the command. Then check whether the guide has a title and a navigation link. This checks those items, without guaranteeing a reader reaches the guide.',link:null};
const previous=env.devStubs;const pass={pass:true,problems:[]};let saved:PlanningRecovery[]=[];
beforeEach(()=>{env.devStubs=false;saved=[];});afterEach(()=>{env.devStubs=previous;mocks.run.mockReset();});
const recovery=(checkpoint?:PlanningRecovery)=>({sourceHash:hash(source),checkpoint,save:async(value:PlanningRecovery)=>{saved.push(structuredClone(value));}});
const run=(checkpoint?:PlanningRecovery)=>planExplanation('synthetic-business','synthetic-generation',source,async()=>{},async()=>{},180,recovery(checkpoint));
const state=(candidate:Plan|RegistryDraft,version:1|2=1,repair:PlanningRecovery['repair']='available')=>({version,candidate,sourceHash:hash(source),maxDuration:180,repair})as PlanningRecovery;
function conflict(){
 const plan=stubPlan(source);
 for(const [i,scene]of plan.scenes.entries()){
  for(const node of scene.nodes)if(node.id==='review'){node.id='fix';node.label=i===2?'Add title or nav link':'Reproduce first';}
  for(const edge of scene.edges){if(edge.from==='review')edge.from='fix';if(edge.to==='review')edge.to='fix';}
  for(const cue of scene.cues)cue.target=cue.target.replaceAll('review','fix');
 }
 return plan;
}
/** Explicitly authored correction fixture. Production has no conflict-normalization helper. */
function corrected(){
 const old=conflict();return {...old,entities:[{id:'source',kind:'input',label:'Source'},{id:'fix',kind:'process',label:'Reproduce first'},{id:'addLink',kind:'process',label:'Add title or nav link'},{id:'result',kind:'output',label:'Result'}],scenes:old.scenes.map((scene,i)=>({...scene,nodes:scene.nodes.map(({kind,label,...ref})=>{void kind;void label;return {...ref,id:i===2&&ref.id==='fix'?'addLink':ref.id};}),edges:scene.edges.map(edge=>({...edge,from:i===2&&edge.from==='fix'?'addLink':edge.from,to:i===2&&edge.to==='fix'?'addLink':edge.to})),cues:scene.cues.map(cue=>({...cue,target:i===2?cue.target.replaceAll('fix','addLink'):cue.target}))}))} satisfies RegistryDraft;
}
describe('canonical storyboard registry compilation',()=>{
 it('expands one authored identity consistently and preserves all remaining story data',()=>{
  const draft=stubRegistryDraft(source);draft.entities[0].label='Saved source';draft.scenes[0].nodes[1].state='Reading source';
  const plan=compileRegistryDraft(draft);expect(plan.scenes.every(s=>s.nodes.find(n=>n.id==='source')!.label==='Saved source')).toBe(true);
  expect(plan.claims).toEqual(draft.claims);expect(plan.scenes.map(s=>s.narration)).toEqual(draft.scenes.map(s=>s.narration));
  expect(plan.scenes.map(s=>s.edges)).toEqual(draft.scenes.map(s=>s.edges));expect(plan.scenes.map(s=>s.cues)).toEqual(draft.scenes.map(s=>s.cues));expect(plan.scenes.map(s=>s.revisit)).toEqual(draft.scenes.map(s=>s.revisit));expect(plan.scenes[0].nodes[1].state).toBe('Reading source');expect(plan).not.toHaveProperty('entities');
 });
 it('retains per-scene chart values, units, illustrative marking and claim reference',()=>{
  const draft=stubRegistryDraft(source);draft.entities[2].kind='chart';for(const scene of draft.scenes){const node=scene.nodes.find(n=>n.id==='result')!;Object.assign(node,{values:[2,4],units:'items',illustrative:true,claimRef:'owner'});}
  const plan=compileRegistryDraft(draft);expect(plan.scenes[0].nodes[2]).toMatchObject({kind:'chart',values:[2,4],units:'items',illustrative:true,claimRef:'owner'});carouselFrame(plan.scenes[0],0,3);
 });
 it('refuses duplicate declarations rather than choosing the first or last label',()=>{
  const draft=stubRegistryDraft(source);draft.entities.push({...draft.entities[1],label:'Another action'});
  expect(()=>compileRegistryDraft(draft)).toThrow(expect.objectContaining({diagnosticCode:'entity_duplicate'}));
 });
 it('refuses unknown references, including prototype property names, with a fixed safe scene diagnostic',()=>{
  const draft=stubRegistryDraft(source);draft.scenes[2].nodes[0].id='constructor';expect(()=>compileRegistryDraft(draft)).toThrow(expect.objectContaining({diagnosticCode:'entity_reference',scene:2}));
 });
 it.each(['kind','label'])('rejects a scene %s identity override instead of stripping it',key=>{
  const draft=stubRegistryDraft(source);Object.assign(draft.scenes[0].nodes[0],{[key]:key==='kind'?'output':'Different label'});
  expect(RegistryDraftZ.safeParse(draft).success).toBe(false);expect(()=>compileRegistryDraft(draft)).toThrow();
 });
 it('rejects undeclared identity attributes and the registry capacity limit',()=>{
  const draft=stubRegistryDraft(source);Object.assign(draft.entities[0],{state:'Not an identity'});expect(RegistryDraftZ.safeParse(draft).success).toBe(false);
  const large=stubRegistryDraft(source);large.entities=Array.from({length:49},(_,i)=>({id:'entity'+i,label:'Item',kind:'input'}));expect(RegistryDraftZ.safeParse(large).success).toBe(false);
 });
 it('retains exact cue, source-backed chart and state-change validation after compilation',()=>{
  const badCue=stubRegistryDraft(source);badCue.scenes[0].cues[0].phrase='Not spoken';expect(()=>compileRegistryDraft(badCue)).toThrow(expect.objectContaining({diagnosticCode:'cue_phrase'}));
  const chart=stubRegistryDraft(source);chart.entities[2].kind='chart';for(const scene of chart.scenes)Object.assign(scene.nodes[2],{values:[3],units:'items'});expect(()=>compileRegistryDraft(chart)).toThrow(expect.objectContaining({diagnosticCode:'chart_evidence'}));
  const unchanged=stubRegistryDraft(source);unchanged.scenes[1].nodes=structuredClone(unchanged.scenes[0].nodes);expect(()=>compileRegistryDraft(unchanged)).toThrow(expect.objectContaining({diagnosticCode:'unchanged_scene'}));
 });
 it('allows bounded unused declarations without altering the compiled Plan',()=>{
  const draft=stubRegistryDraft(source);const before=compileRegistryDraft(draft);draft.entities.push({id:'unused',kind:'actor',label:'Illustrative reviewer'});expect(compileRegistryDraft(draft)).toEqual(before);
 });
});
describe('registry planning, legacy recovery and review boundaries',()=>{
 it('retains the observed legacy conflict and asks for one authored registry correction without a new plan',async()=>{
  const legacy=conflict();expect(()=>validatePlan(legacy)).toThrow(expect.objectContaining({diagnosticCode:'node_identity'}));
  mocks.run.mockResolvedValueOnce({json:corrected()}).mockResolvedValue({json:pass});const plan=await run(state(legacy));
  expect(mocks.run.mock.calls.map(c=>c[1].purpose)).toEqual(['social.media.revise','social.media.review','social.media.review']);
  const correction=mocks.run.mock.calls[0][1];expect(correction.schema).toBe(RegistryDraftZ);const data=JSON.parse(correction.prompt.split('UNTRUSTED REVISION DATA JSON:\n')[1]);
  expect(data.candidateVersion).toBe(1);expect(data.candidatePlan).toEqual(legacy);expect(data.validation.code).toBe('node_identity');expect(saved[0].version).toBe(1);expect(saved.at(-1)?.version).toBe(2);expect(saved.at(-1)?.repair).toBe('completed');
  expect(plan.scenes[0].nodes.find(n=>n.id==='fix')!.label).toBe('Reproduce first');expect(plan.scenes[2].nodes.find(n=>n.id==='addLink')!.label).toBe('Add title or nav link');expect(plan.scenes[2].nodes.some(n=>n.id==='fix')).toBe(false);expect(plan.scenes.map(s=>s.narration)).toEqual(legacy.scenes.map(s=>s.narration));
 });
 it('accepts a valid paid legacy candidate without an upgrade call',async()=>{
  mocks.run.mockResolvedValue({json:pass});const plan=await run(state(stubPlan(source)));expect(plan).toEqual(stubPlan(source));expect(mocks.run.mock.calls.map(c=>c[1].purpose)).toEqual(['social.media.review','social.media.review']);
 });
 it('saves the raw registry before a compilation error and correction dispatch',async()=>{
  const draft=stubRegistryDraft(source);draft.entities.push({...draft.entities[1],label:'Conflicting action'});
  mocks.run.mockImplementation(async(_task,request)=>{
   if(request.purpose==='social.media.plan'){expect(request.schema).toBe(RegistryDraftZ);return {json:draft};}
   if(request.purpose==='social.media.revise'){expect(saved[0]).toMatchObject({version:2,candidate:draft,repair:'available'});expect(saved.at(-1)?.diagnostic?.code).toBe('entity_duplicate');expect(saved.at(-1)?.repair).toBe('dispatched');return {json:stubRegistryDraft(source)};}
   return {json:pass};
  });await run();expect(saved.at(-1)?.version).toBe(2);
 });
 it('reuses a saved invalid registry without another plan request and cannot spend a second correction',async()=>{
  const draft=stubRegistryDraft(source);draft.scenes[0].nodes[0].id='unknown';mocks.run.mockResolvedValueOnce({json:stubRegistryDraft(source)}).mockResolvedValue({json:{pass:false,problems:['Unsupported outcome guarantee.']}});
  await expect(run(state(draft,2))).rejects.toMatchObject({code:'media_review_failed'});expect(mocks.run.mock.calls.map(c=>c[1].purpose)).toEqual(['social.media.revise','social.media.review']);
  mocks.run.mockReset();mocks.run.mockResolvedValue({json:{pass:false,problems:['Still unsupported.']}});await expect(run(saved.at(-1)!)).rejects.toMatchObject({code:'media_review_failed'});expect(mocks.run.mock.calls.some(c=>c[1].purpose==='social.media.revise')).toBe(false);
 });
 it('does not automatically repeat an interrupted v2 correction',async()=>{
  await expect(run(state(stubRegistryDraft(source),2,'dispatched'))).rejects.toMatchObject({code:'media_plan_interrupted'});expect(mocks.run).not.toHaveBeenCalled();
 });
 it('clarifies neutral explanations and same-scene revisits while retaining outcome/identity constraints',async()=>{
  mocks.run.mockResolvedValueOnce({json:stubRegistryDraft(source)}).mockResolvedValue({json:pass});await run();
  for(const call of mocks.run.mock.calls.slice(1)){
   expect(call[1].prompt).toContain('neutral definitions');expect(call[1].prompt).toContain('introduced earlier in the same scene');expect(call[1].prompt).toContain('revisit:[] is valid');expect(call[1].prompt).toContain('unless the supplied evidence explicitly supports the outcome and its conditions');
  }
 });
 it('renders a same-scene introduction then revisit while other recurring objects need no highlight',()=>{
  const draft=stubRegistryDraft(source);draft.scenes[0].revisit=['source'];draft.scenes[0].cues.push({kind:'revisit',target:'source',phrase:'Follow the same item',occurrence:1});draft.scenes[1].revisit=[];draft.scenes[1].cues=draft.scenes[1].cues.filter(c=>c.kind!=='revisit');
  const plan=compileRegistryDraft(draft);const script=plan.scenes.map(s=>s.narration).join('\n\n');const alignment={characters:[...script],character_start_times_seconds:[...script].map((_,i)=>i*.04),character_end_times_seconds:[...script].map((_,i)=>(i+1)*.04)};const timeline=timelineFor(plan,alignment,script.length*.04);const cue=timeline.scenes[0].cues.find(c=>c.kind==='revisit')!;
  expect(cue.start).toBeGreaterThan(timeline.scenes[0].cues.find(c=>c.kind==='node'&&c.target==='source')!.start);expect(videoFrame(timeline,cue.start+.1).toBuffer('image/png').length).toBeGreaterThan(1000);
 });
});
