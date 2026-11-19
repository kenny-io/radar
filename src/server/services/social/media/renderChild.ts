// Dedicated CPU process. No database/provider/storage credential is inherited.
import fs from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { videoFrame,carouselFrame } from './draw';
import { PlanZ,validatePlan,type Timeline } from './model';

async function command(exe:string,args:string[]):Promise<string>{return new Promise((resolve,reject)=>{const p=spawn(exe,args,{shell:false,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>{out+=b;if(out.length>100000)p.kill('SIGKILL');});p.stderr.on('data',b=>{err=(err+b).slice(-20000);});p.on('error',reject);p.on('exit',code=>code===0?resolve(out||err):reject(new Error('Media validation failed')));});}
async function main(){const request=JSON.parse(await fs.readFile(process.argv[2],'utf8'));const plan=validatePlan(PlanZ.parse(request.plan));
 if(request.format==='carousel'){
  for(let i=0;i<plan.scenes.length;i++){const canvas=carouselFrame(plan.scenes[i],i,plan.scenes.length);const file=canvas.toBuffer('image/jpeg',90);if(file.length>5*1024*1024)throw new Error('Slide is too large');await fs.writeFile(request.dir+`/slide-${i}.jpg`,file);process.send?.({done:i+1,total:plan.scenes.length});}
  await fs.writeFile(request.dir+'/result.json',JSON.stringify({slides:plan.scenes.length}));return;
 }
 const timeline=request.timeline as Timeline;if(!timeline||timeline.duration<3||timeline.duration>180)throw new Error('Video duration exceeds the selected limit');
 const fps=24,total=Math.ceil(timeline.duration*fps);const output=request.dir+'/video.mp4';
 const p=spawn(request.ffmpeg,['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','rgba','-video_size','1080x1920','-framerate',String(fps),'-i','pipe:0','-protocol_whitelist','file,pipe','-f','mp3','-i',request.audio,'-filter:a','adelay=500:all=1,loudnorm=I=-16:TP=-1.5:LRA=11,apad','-c:v','libx264','-preset','veryfast','-threads','2','-x264-params','ref=2:rc-lookahead=10','-pix_fmt','yuv420p','-b:v','3200k','-maxrate','4000k','-bufsize','8000k','-c:a','aac','-b:a','128k','-ar','48000','-t',String(timeline.duration),'-movflags','+faststart',output],{shell:false,stdio:['pipe','ignore','pipe']});
 let stderr='';p.stderr.on('data',b=>{stderr=(stderr+b).slice(-2000);});const done=new Promise<void>((resolve,reject)=>{p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error('Video encoding failed')));});done.catch(()=>{});
 p.stdin.on('error',()=>{});const surface=createCanvas(1080,1920);
 for(let i=0;i<total;i++){if(i%24===0&&process.memoryUsage().rss>320*1024*1024){p.kill('SIGKILL');throw new Error('The render exceeded its memory allowance');}if(p.exitCode!==null)throw new Error('Encoder stopped');const canvas=videoFrame(timeline,i/fps,surface);const rgba=canvas.data();if(!p.stdin.write(rgba))await once(p.stdin,'drain');if(i%24===0)process.send?.({done:i,total});if(i===0||i===Math.floor(total/2)||i===total-1)await fs.writeFile(request.dir+`/frame-${i}.jpg`,canvas.toBuffer('image/jpeg',85));}
 p.stdin.end();await done;
 const stat=await fs.stat(output);if(stat.size>100*1024*1024||!stat.size)throw new Error('Video is too large');
 const probe=JSON.parse(await command(request.ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_streams','-show_format','-of','json',output]));
 const video=probe.streams.find((s:any)=>s.codec_type==='video'),audio=probe.streams.find((s:any)=>s.codec_type==='audio');
 if(video?.codec_name!=='h264'||video.width!==1080||video.height!==1920||audio?.codec_name!=='aac'||Math.abs(Number(probe.format.duration)-timeline.duration)>0.3)throw new Error('Video probe did not match the master timeline');
 await command(request.ffmpeg,['-v','error','-protocol_whitelist','file,pipe','-i',output,'-f','null','-']);
 const levels=await command(request.ffmpeg,['-hide_banner','-nostats','-protocol_whitelist','file,pipe','-i',output,'-vn','-af','volumedetect','-f','null','-']);
 const peak=Number(levels.match(/max_volume:\s*(-?[\d.]+) dB/)?.[1]);if(!Number.isFinite(peak)||peak> -0.1||peak< -45)throw new Error('Narration levels need attention');
 await fs.writeFile(request.dir+'/result.json',JSON.stringify({durationSec:Number(probe.format.duration),width:1080,height:1920,fps,bytes:stat.size,peakDb:peak,fullDecode:true}));
}
main().then(()=>process.exit(0),e=>{console.error(String(e?.message||'Render failed'));process.exit(1);});
