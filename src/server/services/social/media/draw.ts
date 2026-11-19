import { createCanvas,GlobalFonts,type SKRSContext2D } from '@napi-rs/canvas';
import path from 'node:path';
import type { Scene,Timeline } from './model';
let fonts=false;
export function loadFonts(){if(fonts)return;for(const [file,name]of [['Kalam-Regular.ttf','Radar Hand'],['NotoSans.ttf','Radar Sans']]){if(!GlobalFonts.registerFromPath(path.join(process.cwd(),'assets/social-media',file),name))throw new Error('Explainer font is missing');}fonts=true;}
const color={bg:'#10151d',line:'#f1ecdf',input:'#77b8f1',output:'#90d5ae',attention:'#f1cf6d'};
export function wrap(ctx:SKRSContext2D,text:string,max:number,maxLines=3):string[]{
 const lines:string[]=[];let line='';for(const word of text.split(/\s+/)){if(ctx.measureText(word).width>max)throw new Error('Diagram label is too wide');if(line&&ctx.measureText(line+' '+word).width>max){lines.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)lines.push(line);if(lines.length>maxLines)throw new Error('Explanation text needs shorter labels');return lines;
}
function text(ctx:SKRSContext2D,value:string,x:number,y:number,width:number,size:number,lines=3,fill=color.line){ctx.font=`${size}px "Radar Hand", "Radar Sans"`;ctx.fillStyle=fill;ctx.textAlign='center';const rows=wrap(ctx,value,width,lines);rows.forEach((s,i)=>ctx.fillText(s,x,y+i*size*1.15));return rows.length*size*1.15;}
export function captionLines(value:string):string[]{
 loadFonts();const c=createCanvas(1,1).getContext('2d');c.font='48px "Radar Hand", "Radar Sans"';
 const words=value.trim().split(/\s+/);if(c.measureText(value).width<=790)return [value];
 let best:string[]|null=null,score=Infinity;
 for(let i=2;i<=words.length-2;i++){const a=words.slice(0,i).join(' '),b=words.slice(i).join(' '),wa=c.measureText(a).width,wb=c.measureText(b).width;if(Math.max(wa,wb)>790)continue;
 const penalty=Math.abs(wa-wb)+(/\b(?:a|an|the|of|to|for|with|and|or|if|when|before|after|at|in|on|should|can|will|have|has)$/.test(a)?250:0);if(penalty<score){score=penalty;best=[a,b];}}
 if(!best)throw new Error('Caption needs a shorter complete phrase');return best;
}
export const captionFits=(s:string)=>{try{captionLines(s);return true;}catch{return false;}};
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
function nodePositions(s:Scene,carousel:boolean){const columns=s.nodes.length<=3?1:2;const w=columns===1?570:355,h=carousel?180:210;const top=carousel?325:360;const step=carousel?270:310;return s.nodes.map((node,i)=>({node,x:columns===1?540: i%2===0?300:780,y:top+Math.floor(i/columns)*step,w,h}));}
export function drawScene(ctx:SKRSContext2D,s:Scene,elapsed:number,carousel=false,carried=new Set<string>(),carriedEdges=new Set<string>(),timing?:Timeline['scenes'][number],now=0){
 const nodes=nodePositions(s,carousel);const titleHeight=text(ctx,s.title,540,carousel?95:175,840,56,2);void titleHeight;
 const cue=(kind:'node'|'edge'|'revisit',target:string)=>timing?.cues.find(c=>c.kind===kind&&c.target===target);const reveal=(i:number)=>carousel||carried.has(nodes[i].node.id)?1:clamp((now-(cue('node',nodes[i].node.id)?.start??Infinity))/0.55);
 // Relationships appear only once their endpoints exist. Markers follow their direction; feedback is visibly curved.
 for(const [i,e]of s.edges.entries()){const a=nodes.find(p=>p.node.id===e.from)!,b=nodes.find(p=>p.node.id===e.to)!;const progress=carousel||carriedEdges.has(e.from+':'+e.to+':'+e.label+':'+e.kind)?1:clamp((now-(cue('edge',e.from+'->'+e.to)?.start??Infinity))/0.8);if(!progress)continue;
  const dx=b.x-a.x,dy=b.y-a.y;const vertical=Math.abs(dy)>Math.abs(dx);const ax=a.x+(vertical?0:Math.sign(dx)*a.w/2),ay=a.y+(vertical?Math.sign(dy)*a.h/2:0);const bx=b.x-(vertical?0:Math.sign(dx)*b.w/2),by=b.y-(vertical?Math.sign(dy)*b.h/2:0);
  ctx.save();ctx.strokeStyle=e.kind==='feedback'?color.attention:color.line;ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=4;ctx.globalAlpha=progress;ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(ax+(bx-ax)*progress,ay+(by-ay)*progress);ctx.stroke();const angle=Math.atan2(by-ay,bx-ax);if(progress>0.9){ctx.beginPath();ctx.moveTo(bx,by);ctx.lineTo(bx-17*Math.cos(angle-0.5),by-17*Math.sin(angle-0.5));ctx.lineTo(bx-17*Math.cos(angle+0.5),by-17*Math.sin(angle+0.5));ctx.closePath();ctx.fill();}
  if(e.label&&Math.hypot(dx,dy)>240){ctx.fillStyle=color.bg;ctx.fillRect((ax+bx)/2-115,(ay+by)/2-23,230,45);text(ctx,e.label,(ax+bx)/2,(ay+by)/2+9,220,30,1);}
  const spoken=cue('edge',e.from+'->'+e.to);if(!carousel&&progress===1&&spoken&&now>=spoken.start&&now<=spoken.end+0.8){const k=clamp((now-spoken.start)/(spoken.end-spoken.start+0.8));ctx.fillStyle=color.attention;ctx.beginPath();ctx.arc(ax+(bx-ax)*k,ay+(by-ay)*k,8,0,Math.PI*2);ctx.fill();}ctx.restore();
 }
 for(const [i,p]of nodes.entries()){const r=reveal(i);if(!r)continue;const n=p.node,stroke=n.kind==='input'?color.input:n.kind==='output'?color.output:color.line;ctx.save();ctx.globalAlpha=r;ctx.strokeStyle=stroke;ctx.lineWidth=4;ctx.setLineDash(carousel?[]:[Math.max(1,(p.w+p.h)*2*r),5000]);ctx.fillStyle=color.bg;
  ctx.beginPath();if(n.kind==='actor'){ctx.ellipse(p.x,p.y,p.w/2,p.h/2,0,0,Math.PI*2);}else if(n.kind==='input'){ctx.moveTo(p.x-p.w/2+25,p.y-p.h/2);ctx.lineTo(p.x+p.w/2,p.y-p.h/2);ctx.lineTo(p.x+p.w/2-25,p.y+p.h/2);ctx.lineTo(p.x-p.w/2,p.y+p.h/2);ctx.closePath();}else{ctx.roundRect(p.x-p.w/2,p.y-p.h/2,p.w,p.h,n.kind==='storage'?26:12);}ctx.fill();ctx.stroke();ctx.setLineDash([]);
  if(n.kind==='storage'){ctx.beginPath();ctx.ellipse(p.x,p.y-p.h/2+14,p.w/2,16,0,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.ellipse(p.x,p.y+p.h/2-10,p.w/2,15,0,0,Math.PI);ctx.stroke();}
  if(n.kind==='output'){ctx.beginPath();ctx.moveTo(p.x+p.w/2-28,p.y-p.h/2);ctx.lineTo(p.x+p.w/2-28,p.y-p.h/2+28);ctx.lineTo(p.x+p.w/2,p.y-p.h/2+28);ctx.stroke();}
  text(ctx,n.label,p.x,p.y-(n.kind==='chart'?45:10),p.w-40,44,3,stroke);
  if(n.state&&(carousel||now>=(cue('node',n.id)?.start??Infinity)))text(ctx,n.state,p.x,p.y+p.h/2-25,p.w-30,30,1,color.attention);
  if(n.kind==='chart'&&n.values?.length){const max=Math.max(1,...n.values),bar=(p.w-70)/n.values.length;n.values.forEach((v,j)=>{ctx.fillStyle=color.input;ctx.fillRect(p.x-p.w/2+35+j*bar,p.y+35-v/max*65,bar-10,v/max*65);});text(ctx,(n.illustrative?'Illustrative · ':'')+(n.units||''),p.x,p.y+p.h/2-13,p.w-20,25,1);}
  const revisit=cue('revisit',n.id);if(s.revisit.includes(n.id)&&(carousel||revisit&&now>=revisit.start&&now<=revisit.end+0.8)){ctx.strokeStyle=color.attention;ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(p.x,p.y,p.w/2+12,p.h/2+10,-0.025,0,Math.PI*2);ctx.stroke();}ctx.restore();
 }
}
export function videoFrame(t:Timeline,seconds:number,canvas=createCanvas(1080,1920)){loadFonts();const ctx=canvas.getContext('2d');ctx.fillStyle=color.bg;ctx.fillRect(0,0,1080,1920);const active=[...t.scenes].reverse().find(s=>seconds>=s.start)||t.scenes[0];const previous=t.scenes[t.scenes.indexOf(active)-1];const carried=new Set(previous?.scene.nodes.map(n=>n.id)||[]);const carriedEdges=new Set(previous?.scene.edges.map(e=>e.from+':'+e.to+':'+e.label+':'+e.kind)||[]);drawScene(ctx,active.scene,seconds-active.start,false,carried,carriedEdges,active,seconds);
 const caption=t.captions.find(c=>seconds>=c.start&&seconds<c.end+0.06);if(caption){ctx.fillStyle='#10151dee';ctx.fillRect(95,1410,835,220);ctx.font='48px "Radar Hand", "Radar Sans"';ctx.fillStyle=color.line;ctx.textAlign='center';captionLines(caption.text).forEach((line,i)=>ctx.fillText(line,510,1490+i*58));}
 ctx.fillStyle='#707985';ctx.font='28px "Radar Sans"';ctx.textAlign='left';ctx.fillText('Illustrated explanation',90,1780);return canvas;
}
export function carouselFrame(s:Scene,index:number,total:number){loadFonts();const canvas=createCanvas(1080,1350),ctx=canvas.getContext('2d');ctx.fillStyle=color.bg;ctx.fillRect(0,0,1080,1350);drawScene(ctx,s,100,true);text(ctx,s.mainIdea,540,1180,850,40,2);ctx.font='30px "Radar Sans"';ctx.fillStyle=color.attention;ctx.textAlign='right';ctx.fillText(`${index+1} / ${total}`,960,1290);return canvas;}
