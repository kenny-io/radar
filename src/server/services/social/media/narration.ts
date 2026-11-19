import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { env } from '@/server/env';
import { RadarError } from '@/server/errors';
import { pool } from '@/server/db';
import { putObject,readStoredBounded } from '../../storage';
import { recordAiCallNow } from '@/server/ai/record';
import { query,transaction } from './db';
import { reserveBudget } from './budget';
import { speechRate } from './config';
import { hash,VOICE,narrationSettings,scriptOf,type Plan,type Alignment,type Generation } from './model';
import { checkAlignment } from './timeline';

export class UncertainNarration extends RadarError{constructor(){super('Narration may have completed before the connection was interrupted. Radar has not requested it again. Explicit retry may be billed.',409,'media_narration_uncertain');}}
export async function audioDuration(file:Buffer):Promise<number>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'radar-audio-'));try{const f=path.join(dir,'audio.mp3');await fs.writeFile(f,file);return await new Promise((resolve,reject)=>{const p=spawn(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-protocol_whitelist','file,pipe','-f','mp3','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',f],{shell:false,env:{PATH:process.env.PATH,NODE_ENV:process.env.NODE_ENV||'development'},stdio:['ignore','pipe','ignore']});let out='';const timer=setTimeout(()=>{p.kill('SIGKILL');reject(new Error('Audio validation timed out'));},10000);p.stdout.on('data',b=>out+=b);p.on('error',reject);p.on('exit',code=>{clearTimeout(timer);const n=Number(out);code===0&&n>0&&n<180?resolve(n):reject(new Error('Narration exceeds the platform limit. Narrow the explanation before another recording.'));});});}finally{await fs.rm(dir,{recursive:true,force:true});}}
export async function narrationFor(bid:string,plan:Plan,guard:()=>Promise<void>,signal:AbortSignal,paidNonce?:string){
 const script=scriptOf(plan),settings=narrationSettings();const key=hash({script,voice:VOICE,model:env.elevenlabsModel,settings,format:'mp3_44100_128',paidNonce});const lease=randomUUID();
 const row=await transaction(async tx=>{
  await query(tx,`INSERT INTO social_media_generations(business_id,kind,cache_key,source_hash,status,stage,request_version,checkpoint) VALUES($1,'narration',$2,$2,'queued','narration_reserved',$3,'{}') ON CONFLICT(business_id,kind,cache_key) DO NOTHING`,[bid,key,randomUUID()]);
  const r=(await query<Generation>(tx,`SELECT * FROM social_media_generations WHERE business_id=$1 AND kind='narration' AND cache_key=$2 FOR UPDATE`,[bid,key])).rows[0];
  if(r.checkpoint.audioUrl&&r.checkpoint.alignment)return r;
  if(r.stage==='narration_dispatched'||r.status==='needs_attention')throw new UncertainNarration();
  if(r.lease_until&&new Date(r.lease_until).getTime()>Date.now())throw new RadarError('The same narration is already being recorded. Radar will reuse it.',409,'media_narration_busy');
  if(!env.elevenlabsKey)throw new RadarError('Brian narration is not configured. Your previous media is kept.',503,'media_voice_config');
  await guard();const usd=script.length/1000*speechRate();await reserveBudget(tx,bid,{usd,characters:script.length,narrations:1});
  await query(tx,`UPDATE social_media_generations SET status='narrating',stage='narration_dispatched',lease_token=$2,lease_until=now()+interval '5 minutes',reserved_usd=reserved_usd+$3,updated_at=now() WHERE id=$1`,[r.id,lease,usd]);return {...r,lease_token:lease};
 });
 if(row.checkpoint.audioUrl&&row.checkpoint.alignment){let duration=row.checkpoint.timeline?.duration;if(!duration){const audio=await readStoredBounded(bid,row.checkpoint.audioUrl,12*1024*1024);if(!audio)throw new RadarError('Cached narration is unavailable. Radar has not requested it again.',409,'media_narration_uncertain');duration=await audioDuration(audio.body);checkAlignment(row.checkpoint.alignment,duration);await pool.query("UPDATE social_media_generations SET status='ready',stage='audio_saved',checkpoint=jsonb_set(checkpoint,'{timeline}',$2::jsonb),lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",[row.id,JSON.stringify({duration})]);}return {id:row.id,audioUrl:row.checkpoint.audioUrl,alignment:row.checkpoint.alignment,duration};}
 const started=Date.now();const timeout=AbortSignal.timeout(120000);const combined=AbortSignal.any([signal,timeout]);
 try{
  const response=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=mp3_44100_128`,{method:'POST',redirect:'error',headers:{'xi-api-key':env.elevenlabsKey,'content-type':'application/json'},body:JSON.stringify({text:script,model_id:env.elevenlabsModel,voice_settings:settings}),signal:combined});
  if(!response.ok){
   // Only explicit rejected requests are safe to retry. Never echo provider bodies or keys into job errors.
   const safe=[400,401,403,404,422,429].includes(response.status);if(!safe)throw new UncertainNarration();
   await pool.query(`UPDATE social_media_generations SET status='failed',stage='narration_rejected',error_code=$3,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2`,[row.id,lease,'voice_http_'+response.status]);
   throw new RadarError(response.status===429?'Brian narration is at its usage limit. Check the voice allowance before retrying.':'Brian could not record this explanation. Check the configured voice/model access.',502,'media_voice_rejected');
  }
  const reader=response.body?.getReader();if(!reader)throw new UncertainNarration();const parts:Uint8Array[]=[];let size=0;for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>24*1024*1024){await reader.cancel();throw new UncertainNarration();}parts.push(r.value);}const data=JSON.parse(Buffer.concat(parts).toString());
  const audio=Buffer.from(data.audio_base64||'','base64');const alignment=(data.normalized_alignment||data.alignment) as Alignment;if(audio.length<1000||audio.length>12*1024*1024||!alignment)throw new UncertainNarration();
  // Durable audio first: once this exists no worker issues the unchanged narration again.
  const url=await putObject(`${bid}/social-media/${row.id}/audio.mp3`,audio,'audio/mpeg',{signal:AbortSignal.timeout(60000)});await pool.query("UPDATE social_media_generations SET stage='audio_received',checkpoint=$3,updated_at=now() WHERE id=$1 AND lease_token=$2",[row.id,lease,{audioUrl:url,alignment,originalAlignment:data.alignment}]);const duration=await audioDuration(audio);checkAlignment(alignment,duration);
  const saved=await pool.query(`UPDATE social_media_generations SET status='ready',stage='audio_saved',checkpoint=$3,charged_characters=$4,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 RETURNING id`,[row.id,lease,{audioUrl:url,alignment,originalAlignment:data.alignment,timeline:{duration},estimatedCostUsd:(Number(response.headers.get('character-cost'))||script.length)/1000*speechRate()},Number(response.headers.get('character-cost'))||script.length]);
  if(!saved.rowCount)throw new UncertainNarration();
  await recordAiCallNow({businessId:bid,task:'narration',purpose:'social.media.narrate',provider:'ElevenLabs',model:env.elevenlabsModel,latencyMs:Date.now()-started,costUsd:(Number(response.headers.get('character-cost'))||script.length)/1000*speechRate(),ok:true}).catch(()=>{});
  return {id:row.id,audioUrl:url,alignment,duration};
 }catch(e){if(e instanceof RadarError&&e.code==='media_voice_rejected')throw e;
  await pool.query(`UPDATE social_media_generations SET status='needs_attention',stage='narration_dispatched',error_code='media_narration_uncertain',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2`,[row.id,lease]);throw new UncertainNarration();
 }
}
