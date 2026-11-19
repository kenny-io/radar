import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pool } from '@/server/db';
import { putObject,readStoredBounded } from '../../storage';
import { videoMeta,videoDuration } from '../publish/media';
import { RadarError } from '@/server/errors';
import { type Plan,type Timeline,type Checkpoint } from './model';

export async function renderMedia(bid:string,id:string,format:'video'|'carousel',plan:Plan,audioUrl:string|undefined,timeline:Timeline|undefined,signal:AbortSignal,progress:(p:{done:number;total:number})=>Promise<void>):Promise<Pick<Checkpoint,'video'|'slides'>>{
 const lock=await pool.connect();const lockAbort=new AbortController();let lockLost=false;const lost=()=>{lockLost=true;lockAbort.abort();};lock.on('error',lost);lock.on('end',lost);signal=AbortSignal.any([signal,lockAbort.signal]);let locked=false;let dir='';
 try{
  locked=(await lock.query('SELECT pg_try_advisory_lock(71839211) AS ok')).rows[0].ok;if(!locked)throw new RadarError('Another explanation is rendering. Radar will retry shortly.',409,'media_renderer_busy');
  dir=await fs.mkdtemp(path.join(os.tmpdir(),'radar-media-'));await fs.chmod(dir,0o700);
  let audio:string|undefined;
  if(format==='video'){if(!audioUrl||!timeline)throw new Error('Narration must be recorded first');const bytes=await readStoredBounded(bid,audioUrl,12*1024*1024);if(!bytes)throw new Error('Cached narration could not be read');audio=path.join(dir,'audio.mp3');await fs.writeFile(audio,bytes.body);}
  const input=path.join(dir,'input.json');await fs.writeFile(input,JSON.stringify({format,plan,timeline,dir,audio,ffmpeg:process.env.FFMPEG_PATH||'ffmpeg',ffprobe:process.env.FFPROBE_PATH||'ffprobe'}),{mode:0o600});
  await new Promise<void>((resolve,reject)=>{
   const child=spawn(process.execPath,['--import','tsx',path.join(process.cwd(),'src/server/services/social/media/renderChild.ts'),input],{detached:true,shell:false,env:{PATH:process.env.PATH||'/usr/bin:/bin',HOME:dir,TMPDIR:dir,NODE_ENV:process.env.NODE_ENV||'development'},stdio:['ignore','ignore','pipe','ipc']});let error='';let settled=false;
   const kill=()=>{if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch{}};
   const abort=()=>{kill();finish(new RadarError('Generation was cancelled. Your previous media is kept.',409,'media_cancelled'));};
   const timer=setTimeout(()=>{kill();finish(new RadarError('The render took too long. Cached narration is kept for retry.',504,'media_render_timeout'));},20*60e3);
   const size=setInterval(()=>{fs.stat(path.join(dir,'video.mp4')).then(s=>{if(s.size>105*1024*1024){kill();finish(new Error('Video exceeds the media limit'));}}).catch(()=>{});},1500);
   const stop=()=>abort();process.once('SIGTERM',stop);process.once('SIGINT',stop);
   function finish(e?:Error){if(settled)return;settled=true;clearTimeout(timer);clearInterval(size);signal.removeEventListener('abort',abort);process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);e?reject(e):resolve();}
   signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();child.on('message',(p:any)=>{if(Number.isInteger(p.done)&&Number.isInteger(p.total)&&p.done>=0&&p.total>0&&p.done<=p.total)progress({done:p.done,total:p.total}).catch(()=>abort());});child.stderr?.on('data',b=>{error=(error+b).slice(-1000);});child.on('error',()=>finish(new Error('The renderer could not start. Check the worker video tools.')));child.on('exit',code=>{if(code!==0)kill();finish(code===0?undefined:new Error(error||'The video could not be rendered. Cached narration is kept.'));});
  });
  if(signal.aborted)throw new Error('Generation was cancelled');const result=JSON.parse(await fs.readFile(path.join(dir,'result.json'),'utf8'));
  const prefix=`${bid}/social-media/${id}/`;
  if(format==='carousel'){const slides=[];for(let i=0;i<plan.scenes.length;i++){const body=await fs.readFile(path.join(dir,`slide-${i}.jpg`));const url=await putObject(prefix+`slide-${String(i+1).padStart(2,'0')}.jpg`,body,'image/jpeg',{signal});slides.push({url,meta:{bytes:body.length,type:'image/jpeg'},alt:plan.scenes[i].mainIdea});}return {slides};}
  const body=await fs.readFile(path.join(dir,'video.mp4'));const meta=videoMeta(body);const duration=videoDuration(body);if(!meta||!duration||duration>180||Math.abs(duration-result.durationSec)>0.3)throw new Error('Rendered video failed attachment validation');
  const url=await putObject(prefix+'video.mp4',body,'video/mp4',{signal});return {video:{url,meta,durationSec:duration,width:1080,height:1920,fps:24}};
 }finally{if(dir)await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});if(locked&&!lockLost)await lock.query('SELECT pg_advisory_unlock(71839211)').catch(()=>{});lock.removeListener('error',lost);lock.removeListener('end',lost);lock.release(lockLost);}
}
