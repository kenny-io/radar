import { z } from 'zod';
import { RadarError } from '@/server/errors';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ExplainerFormat, ExplainerPlatform } from '@/lib/types';

export const VERSION = 'diagram-v2-aligned-cues';
export const VOICE = 'nPczCjzI2devNBz1zQrb';
export const voiceSettings = { stability: 0.4, similarity_boost: 0.8, style: 0.25, speed: 0.78 };
export function narrationSettings(){const speed=Number(process.env.ELEVENLABS_SPEED||voiceSettings.speed);if(!Number.isFinite(speed)||speed<0.7||speed>1.1)throw new Error('Narration speed configuration is invalid');return {...voiceSettings,speed};}
let identity:Promise<string>|undefined;
export function rendererIdentity(){return identity??=Promise.all(['Kalam-Regular.ttf','NotoSans.ttf'].map(f=>fs.readFile(path.join(process.cwd(),'assets/social-media',f)))).then(files=>hash({version:VERSION,fonts:files.map(f=>createHash('sha256').update(f).digest('hex'))}));}
export const PLATFORMS = ['instagram','tiktok','youtube'] as const;
export const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export function canonical(value: any): string { return JSON.stringify(value, (_,v) => v && !Array.isArray(v) && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v); }
const Id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/);
export const NodeZ = z.object({ id: Id, label: z.string().min(1).max(65), kind: z.enum(['actor','input','process','storage','output','group','chart']), state: z.string().max(50).optional(), values: z.array(z.number().finite().min(0).max(1e6)).max(5).optional(), units: z.string().max(24).optional(), illustrative: z.boolean().optional(), claimRef: z.string().max(80).optional() });
export const EdgeZ = z.object({ from: Id, to: Id, label: z.string().max(35), kind: z.enum(['flow','branch','feedback','transform','compare']) });
export const CueZ=z.object({kind:z.enum(['node','edge','revisit']),target:z.string().min(1).max(70),phrase:z.string().trim().min(3).max(120),occurrence:z.number().int().min(1).max(5)});
export const SceneZ = z.object({ id: Id, title: z.string().min(1).max(65), narration: z.string().trim().min(30).max(800),cues:z.array(CueZ).min(3).max(20), nodes: z.array(NodeZ).min(2).max(6), edges: z.array(EdgeZ).min(1).max(8), revisit: z.array(Id).max(3), mainIdea: z.string().min(8).max(300) });
export const PlanZ = z.object({ topic: z.string().min(5).max(120), question: z.string().max(200), example: z.string().max(300), assumptions: z.string().max(400), caveats: z.string().max(600), recommendation: z.object({ format:z.enum(['video','carousel']), reason:z.string().min(15).max(400), evidence:z.string().min(20).max(500) }), claims:z.array(z.object({id:z.string().min(1).max(80),claim:z.string().min(5).max(400),source:z.string().min(1).max(500),qualification:z.string().max(300)})).min(1).max(20), scenes:z.array(SceneZ).min(3).max(8) });
export const EntityDefinitionZ=NodeZ.pick({id:true,kind:true,label:true}).strict();
export const EntityReferenceZ=NodeZ.omit({kind:true,label:true}).strict();
export const RegistrySceneZ=SceneZ.extend({nodes:z.array(EntityReferenceZ).min(2).max(6)});
export const RegistryDraftZ=PlanZ.extend({entities:z.array(EntityDefinitionZ).min(2).max(48),scenes:z.array(RegistrySceneZ).min(3).max(8)});
export type RegistryDraft=z.infer<typeof RegistryDraftZ>;
export type Plan = z.infer<typeof PlanZ>;
export type Scene = Plan['scenes'][number];
export interface Alignment { characters:string[]; character_start_times_seconds:number[]; character_end_times_seconds:number[] }
export interface Caption { start:number; end:number; text:string }
export interface Timeline { duration:number; scenes:{start:number;end:number;scene:Scene;cues:{kind:'node'|'edge'|'revisit';target:string;start:number;end:number}[]}[]; captions:Caption[] }
export interface MediaOptions { generateAfterPrepare?:boolean; choices?:Choice[]; autoActivationId?:string; generateRecommended?:boolean; autoDate?:string; sourceNotes?:string }
export interface Choice { platform:ExplainerPlatform; format:ExplainerFormat|'recommended' }
export interface Consumer { packId:string; platform:ExplainerPlatform; requestId:string; mediaRevision:number; youtubeOptionsRevision?:number; options?:MediaOptions }
export type PlanningPhase='semantic'|'layout'|'duration'|'mechanism'|'clarity'|'source'|'unexpected';
export interface PlanningDiagnostic {phase:PlanningPhase;code:string;scene?:number;frames?:string[]}
interface PlanningRecoveryBase {sourceHash:string;maxDuration:number;repair:'available'|'dispatched'|'completed';diagnostic?:PlanningDiagnostic}
export interface LegacyPlanningRecovery extends PlanningRecoveryBase {version:1;candidate:Plan}
export interface RegistryPlanningRecovery extends PlanningRecoveryBase {version:2;candidate:RegistryDraft}
export type PlanningRecovery=LegacyPlanningRecovery|RegistryPlanningRecovery;
export type PlanningValidationCode='entity_duplicate'|'entity_reference'|'script_limit'|'duplicate_node'|'duplicate_cue'|'cue_phrase'|'cue_target'|'node_cue'|'edge_cue'|'revisit_cue'|'opening_cue'|'revisit_target'|'unchanged_scene'|'edge_target'|'node_identity'|'chart_evidence'|'label_width'|'label_lines'|'caption_width'|'platform_duration';
export class PlanningValidationError extends RadarError {
 constructor(public phase:'semantic'|'layout'|'duration',public diagnosticCode:PlanningValidationCode,message:string,public scene?:number){super(message,400,phase==='semantic'?'media_plan_invalid':phase==='layout'?'media_layout':'media_duration_limit');}
}
export function planningDiagnostic(error:unknown):PlanningDiagnostic {
 if(error instanceof PlanningValidationError)return {phase:error.phase,code:error.diagnosticCode,...(error.scene===undefined?{}:{scene:error.scene})};
 const frames=error instanceof Error?[...new Set((error.stack||'').split('\n').slice(1).flatMap(line=>line.match(/src\/server\/services\/social\/media\/(?:planner|model|draw|index|render|renderChild|timeline|narration|budget|config|db|jobs|material)\.ts:\d{1,7}:\d{1,7}(?!\d)/g)||[]))].slice(0,3):[];
 return {phase:error instanceof RadarError&&error.code==='media_needs_source'?'source':'unexpected',code:error instanceof RadarError&&error.code==='media_needs_source'?'media_needs_source':'media_plan_internal',...(frames.length?{frames}:{})};
}
export function recoveryMatches(value:PlanningRecovery|undefined,sourceHash:string,maxDuration:number):value is PlanningRecovery{return (value?.version===1||value?.version===2)&&value.sourceHash===sourceHash&&value.maxDuration===maxDuration;}
export function planMatches(cp:Checkpoint,sourceHash:string,maxDuration:number){return !!cp.plan&&cp.planSourceHash===sourceHash&&cp.planMaxDuration===maxDuration;}
/** Atomic replacement patch: an old plan must never acquire the identity of a newer source/cap. */
export function planningSourcePatch(cp:Checkpoint,source:NonNullable<Checkpoint['source']>,maxDuration:number):Partial<Checkpoint>{
 const key=hash(source);return {source,maxDuration,...(!planMatches(cp,key,maxDuration)?{plan:undefined,planSourceHash:undefined,planMaxDuration:undefined}:{}),...(!recoveryMatches(cp.planningRecovery,key,maxDuration)?{planningRecovery:undefined}:{}),planningDiagnostic:undefined};
}
export interface Checkpoint {
 planningRecovery?:PlanningRecovery; planningDiagnostic?:PlanningDiagnostic; planSourceHash?:string;planMaxDuration?:number;
 inputHash?:string; estimatedCostUsd?:number; maxDuration?:number; requestedChoices?:Choice[]; planOnly?:boolean; sourceNotes?:string; source?:{brief:string;link:string|null;title:string;presentationNotes?:string}; plan?:Plan; options?:MediaOptions;
 audioUrl?:string; alignment?:Alignment; originalAlignment?:Alignment; timeline?:Timeline;
 video?:import('@/lib/types').SocialVideo; slides?:import('@/lib/types').SocialSlide[];
 budget?:Record<string,number>; narrationId?:string; paidAttempt?:string; errorMessage?:string; progress?:{done:number;total:number};
}
export interface Generation { id:string; business_id:string; kind:ExplainerFormat|'narration'; cache_key:string; source_hash:string; status:import('@/lib/types').SocialMediaGeneration['status']; stage:string; request_version:string; lease_token:string|null; lease_until:Date|null; checkpoint:Checkpoint; consumers:Consumer[]; error_code:string|null; reserved_usd:number; actual_usd:number|null; charged_characters:number|null; created_at:Date; updated_at:Date }
export const scriptOf=(p:Plan)=>p.scenes.map(s=>s.narration.trim()).join('\n\n');
export function phraseOffset(text:string,phrase:string,occurrence:number):number {
 if(!/[\p{L}\p{N}]/u.test(phrase))throw new Error('A drawing cue must contain spoken words');let from=0,at=-1;for(let i=0;i<occurrence;i++){at=text.toLowerCase().indexOf(phrase.toLowerCase(),from);if(at<0)throw new Error('A drawing cue must quote the scene narration exactly');from=at+phrase.length;}return at;
}
export function validatePlan(plan:Plan):Plan {
 plan=PlanZ.parse(plan);
 const text=scriptOf(plan); if(text.length>3000 || text.split(/\s+/).length>310) throw new PlanningValidationError('duration','script_limit','The explanation is too long. Narrow the topic before recording.');
 const identities=new Map<string,string>();let previousDiagram='';
 for(const [scene,s] of plan.scenes.entries()){ const ids=new Set(s.nodes.map(n=>n.id)); if(ids.size!==s.nodes.length)throw new PlanningValidationError('semantic','duplicate_node','Duplicate diagram object',scene);
  const cueKeys=new Set<string>();const positions=new Map<string,number>();for(const cue of s.cues){const key=cue.kind+':'+cue.target;if(cueKeys.has(key))throw new PlanningValidationError('semantic','duplicate_cue','Duplicate drawing cue',scene);cueKeys.add(key);let at:number;try{at=phraseOffset(s.narration,cue.phrase,cue.occurrence);}catch{throw new PlanningValidationError('semantic','cue_phrase','A drawing cue must quote the scene narration exactly',scene);}positions.set(key,at);if(cue.kind==='edge'?!s.edges.some(e=>e.from+'->'+e.to===cue.target):!ids.has(cue.target))throw new PlanningValidationError('semantic','cue_target','A drawing cue has no semantic target',scene);}
  for(const n of s.nodes)if(!cueKeys.has('node:'+n.id))throw new PlanningValidationError('semantic','node_cue','Every diagram object needs a spoken introduction cue',scene);
  for(const e of s.edges)if(!cueKeys.has('edge:'+e.from+'->'+e.to))throw new PlanningValidationError('semantic','edge_cue','Every relationship needs a spoken cue',scene);
  for(const id of s.revisit)if(!cueKeys.has('revisit:'+id))throw new PlanningValidationError('semantic','revisit_cue','Every highlight needs a spoken cue',scene);
  if(Math.min(...s.nodes.map(n=>positions.get('node:'+n.id)!))!==0)throw new PlanningValidationError('semantic','opening_cue','The opening drawing must begin with the narration',scene);
  if(s.revisit.some(id=>!ids.has(id)))throw new PlanningValidationError('semantic','revisit_target','A highlight must point to an existing diagram object',scene);const diagram=hash({nodes:s.nodes,edges:s.edges});if(diagram===previousDiagram)throw new PlanningValidationError('semantic','unchanged_scene','Each scene must show a new relationship or state',scene);previousDiagram=diagram;
  for(const e of s.edges) if(!ids.has(e.from)||!ids.has(e.to)||e.from===e.to)throw new PlanningValidationError('semantic','edge_target','Diagram relation has no target',scene);
  for(const n of s.nodes){const identity=n.kind+':'+n.label; if(identities.has(n.id)&&identities.get(n.id)!==identity)throw new PlanningValidationError('semantic','node_identity','Recurring diagram objects must retain identity',scene); identities.set(n.id,identity);
   if(n.kind==='chart'&&(!n.values?.length||!n.units||(!n.illustrative&&!plan.claims.some(c=>c.id===n.claimRef))))throw new PlanningValidationError('semantic','chart_evidence','Charts require source-backed values and units',scene);}
 }
 return plan;
}

/** Authoring representation only: no renaming, label selection, cue changes or narrative edits. */
export function compileRegistryDraft(value:RegistryDraft):Plan {
 const draft=RegistryDraftZ.parse(value);const registry=new Map<string,z.infer<typeof EntityDefinitionZ>>();
 for(const entity of draft.entities){if(registry.has(entity.id))throw new PlanningValidationError('semantic','entity_duplicate','Declare each diagram entity once with a distinct identity.');registry.set(entity.id,entity);}
 const {entities,...metadata}=draft;void entities;
 return validatePlan(PlanZ.parse({...metadata,scenes:draft.scenes.map((scene,index)=>({...scene,nodes:scene.nodes.map(ref=>{const entity=registry.get(ref.id);if(!entity)throw new PlanningValidationError('semantic','entity_reference','Every scene object must reference a declared diagram entity.',index);return {...entity,...ref};})}))}));
}
