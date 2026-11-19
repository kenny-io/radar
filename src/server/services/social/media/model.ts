import { z } from 'zod';
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
export type Plan = z.infer<typeof PlanZ>;
export type Scene = Plan['scenes'][number];
export interface Alignment { characters:string[]; character_start_times_seconds:number[]; character_end_times_seconds:number[] }
export interface Caption { start:number; end:number; text:string }
export interface Timeline { duration:number; scenes:{start:number;end:number;scene:Scene;cues:{kind:'node'|'edge'|'revisit';target:string;start:number;end:number}[]}[]; captions:Caption[] }
export interface MediaOptions { generateAfterPrepare?:boolean; choices?:Choice[]; autoActivationId?:string; generateRecommended?:boolean; autoDate?:string; sourceNotes?:string }
export interface Choice { platform:ExplainerPlatform; format:ExplainerFormat|'recommended' }
export interface Consumer { packId:string; platform:ExplainerPlatform; requestId:string; mediaRevision:number; youtubeOptionsRevision?:number; options?:MediaOptions }
export interface Checkpoint {
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
 const text=scriptOf(plan); if(text.length>3000 || text.split(/\s+/).length>310) throw new Error('The explanation is too long. Narrow the topic before recording.');
 const identities=new Map<string,string>();let previousDiagram='';
 for(const s of plan.scenes){ const ids=new Set(s.nodes.map(n=>n.id)); if(ids.size!==s.nodes.length)throw new Error('Duplicate diagram object');
  const cueKeys=new Set<string>();const positions=new Map<string,number>();for(const cue of s.cues){const key=cue.kind+':'+cue.target;if(cueKeys.has(key))throw new Error('Duplicate drawing cue');cueKeys.add(key);const at=phraseOffset(s.narration,cue.phrase,cue.occurrence);positions.set(key,at);if(cue.kind==='edge'?!s.edges.some(e=>e.from+'->'+e.to===cue.target):!ids.has(cue.target))throw new Error('A drawing cue has no semantic target');}
  for(const n of s.nodes)if(!cueKeys.has('node:'+n.id))throw new Error('Every diagram object needs a spoken introduction cue');
  for(const e of s.edges)if(!cueKeys.has('edge:'+e.from+'->'+e.to))throw new Error('Every relationship needs a spoken cue');
  for(const id of s.revisit)if(!cueKeys.has('revisit:'+id))throw new Error('Every highlight needs a spoken cue');
  if(Math.min(...s.nodes.map(n=>positions.get('node:'+n.id)!))!==0)throw new Error('The opening drawing must begin with the narration');
  if(s.revisit.some(id=>!ids.has(id)))throw new Error('A highlight must point to an existing diagram object');const diagram=hash({nodes:s.nodes,edges:s.edges});if(diagram===previousDiagram)throw new Error('Each scene must show a new relationship or state');previousDiagram=diagram;
  for(const e of s.edges) if(!ids.has(e.from)||!ids.has(e.to)||e.from===e.to)throw new Error('Diagram relation has no target');
  for(const n of s.nodes){const identity=n.kind+':'+n.label; if(identities.has(n.id)&&identities.get(n.id)!==identity)throw new Error('Recurring diagram objects must retain identity'); identities.set(n.id,identity);
   if(n.kind==='chart'&&(!n.values?.length||!n.units||(!n.illustrative&&!plan.claims.some(c=>c.id===n.claimRef))))throw new Error('Charts require source-backed values and units');}
 }
 return plan;
}
