import { createCanvas,type SKRSContext2D } from '@napi-rs/canvas';
import {layoutScene,loadFonts,pointOnPath,type TextBlock,type Point} from './layout';
export {layoutScene,loadFonts} from './layout';
import {legacyVideoStyle,type VideoStyleId} from '@/lib/videoStyles';
import {visualTheme,fontFace,type VisualTheme} from './styles';
import { PlanningValidationError,type Scene,type Timeline } from './model';
const color={bg:'#10151d',line:'#f1ecdf',input:'#77b8f1',output:'#90d5ae',attention:'#f1cf6d'};
export function wrap(ctx:SKRSContext2D,text:string,max:number,maxLines=3):string[]{
 const lines:string[]=[];let line='';for(const word of text.split(/\s+/)){if(ctx.measureText(word).width>max)throw new PlanningValidationError('layout','label_width','Diagram label is too wide');if(line&&ctx.measureText(line+' '+word).width>max){lines.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)lines.push(line);if(lines.length>maxLines)throw new PlanningValidationError('layout','label_lines','Explanation text needs shorter labels');return lines;
}
function drawText(ctx:SKRSContext2D,block:TextBlock,fill=color.line){ctx.font=`${block.font}px ${fontFace(block.family)}`;ctx.fillStyle=fill;ctx.textAlign='left';for(const row of block.rows)ctx.fillText(row.text,row.x,row.y);}
function trace(ctx:SKRSContext2D,points:Point[],progress:number){const end=pointOnPath(points,progress);let remaining=progress*points.slice(1).reduce((n,p,i)=>n+Math.hypot(p.x-points[i].x,p.y-points[i].y),0);ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);for(let i=1;i<points.length;i++){const length=Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y);if(remaining<length){ctx.lineTo(end.x,end.y);break;}ctx.lineTo(points[i].x,points[i].y);remaining-=length;}ctx.stroke();}
export function captionLines(value:string):string[]{
 loadFonts();const c=createCanvas(1,1).getContext('2d');c.font='48px "Radar Hand", "Radar Sans"';
 const words=value.trim().split(/\s+/);if(c.measureText(value).width<=790)return [value];
 let best:string[]|null=null,score=Infinity;
 for(let i=2;i<=words.length-2;i++){const a=words.slice(0,i).join(' '),b=words.slice(i).join(' '),wa=c.measureText(a).width,wb=c.measureText(b).width;if(Math.max(wa,wb)>790)continue;
 const penalty=Math.abs(wa-wb)+(/\b(?:a|an|the|of|to|for|with|and|or|if|when|before|after|at|in|on|should|can|will|have|has)$/.test(a)?250:0);if(penalty<score){score=penalty;best=[a,b];}}
 if(!best)throw new PlanningValidationError('layout','caption_width','Caption needs a shorter complete phrase');return best;
}
export const captionFits=(s:string)=>{try{captionLines(s);return true;}catch(error){if(error instanceof PlanningValidationError)return false;throw error;}};
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
function shape(ctx:SKRSContext2D,kind:Scene['nodes'][number]['kind'],x:number,y:number,w:number,h:number){ctx.beginPath();if(kind==='actor')ctx.ellipse(x,y,w/2,h/2,0,0,Math.PI*2);else if(kind==='input'){ctx.moveTo(x-w/2+25,y-h/2);ctx.lineTo(x+w/2,y-h/2);ctx.lineTo(x+w/2-25,y+h/2);ctx.lineTo(x-w/2,y+h/2);ctx.closePath();}else ctx.roundRect(x-w/2,y-h/2,w,h,kind==='storage'?26:12);}
let paperGrain:ReturnType<SKRSContext2D['createPattern']>|undefined;
function backdrop(ctx:SKRSContext2D,w:number,h:number,theme:VisualTheme){ctx.fillStyle=theme.bg;ctx.fillRect(0,0,w,h);if(theme.id==='blueprint'){ctx.strokeStyle='#153650';ctx.lineWidth=1;ctx.beginPath();for(let x=24;x<w;x+=48){ctx.moveTo(x,0);ctx.lineTo(x,h);}for(let y=24;y<h;y+=48){ctx.moveTo(0,y);ctx.lineTo(w,y);}ctx.stroke();}if(theme.id==='paper-cut'){if(!paperGrain){const tile=createCanvas(64,64),grain=tile.getContext('2d');grain.fillStyle='#88735914';for(const [x,y]of [[7,12],[34,21],[50,45],[17,55]])grain.fillRect(x,y,1,1);paperGrain=ctx.createPattern(tile,'repeat');}if(paperGrain){ctx.fillStyle=paperGrain;ctx.fillRect(0,0,w,h);}}}
export function drawScene(ctx:SKRSContext2D,s:Scene,elapsed:number,carousel=false,carried=new Set<string>(),carriedEdges=new Set<string>(),timing?:Timeline['scenes'][number],now=0,videoStyle:VideoStyleId='drawn',index=0,total=1){
 const theme=visualTheme(videoStyle),layout=layoutScene(s,carousel,videoStyle),nodes=layout.nodes;drawText(ctx,layout.title,theme.line);void elapsed;
 if(theme.id==='editorial'){ctx.font='26px "Radar Sans"';ctx.textAlign='left';ctx.fillStyle=theme.input;ctx.fillText(String(index+1).padStart(2,'0')+' / '+String(total).padStart(2,'0'),100,carousel?42:94);ctx.strokeStyle=theme.line;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(100,carousel?214:272);ctx.lineTo(980,carousel?214:272);ctx.stroke();}
 if(theme.id==='blueprint'){ctx.strokeStyle=theme.input;ctx.lineWidth=2;ctx.strokeRect(88,carousel?57:112,904,156);}
 const cue=(kind:'node'|'edge'|'revisit',target:string)=>timing?.cues.find(c=>c.kind===kind&&c.target===target);const reveal=(i:number)=>carousel||carried.has(nodes[i].node.id)?1:clamp((now-(cue('node',nodes[i].node.id)?.start??Infinity))/0.55);
 for(const route of layout.edges){const e=route.edge;const progress=carousel||carriedEdges.has(e.from+':'+e.to+':'+e.label+':'+e.kind)?1:clamp((now-(cue('edge',e.from+'->'+e.to)?.start??Infinity))/0.8);if(!progress)continue;
  ctx.save();ctx.strokeStyle=e.kind==='feedback'?theme.attention:theme.line;ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=theme.id==='paper-cut'?7:theme.id==='editorial'?3:4;ctx.globalAlpha=progress;trace(ctx,route.points,progress);
  if(progress>0.9){const end=route.points.at(-1)!,before=route.points.at(-2)!,angle=Math.atan2(end.y-before.y,end.x-before.x);ctx.beginPath();ctx.moveTo(end.x,end.y);ctx.lineTo(end.x-17*Math.cos(angle-0.5),end.y-17*Math.sin(angle-0.5));ctx.lineTo(end.x-17*Math.cos(angle+0.5),end.y-17*Math.sin(angle+0.5));ctx.closePath();ctx.fill();}
  if(theme.id==='blueprint')for(const p of [route.points[0],route.points.at(-1)!]){ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fillStyle=theme.bg;ctx.fill();ctx.stroke();}
  if(route.leader){ctx.lineWidth=2;trace(ctx,route.leader,1);}
  if(route.background&&route.label){ctx.fillStyle=theme.bg;const r=route.background;ctx.fillRect(r.x,r.y,r.w,r.h);drawText(ctx,route.label,theme.line);}
  const spoken=cue('edge',e.from+'->'+e.to);if(!carousel&&progress===1&&spoken&&now>=spoken.start&&now<=spoken.end+0.8){const k=clamp((now-spoken.start)/(spoken.end-spoken.start+0.8)),p=pointOnPath(route.points,k);ctx.fillStyle=theme.attention;ctx.beginPath();ctx.arc(p.x,p.y,8,0,Math.PI*2);ctx.fill();}ctx.restore();
 }
 for(const [i,p]of nodes.entries()){const r=reveal(i);if(!r)continue;const n=p.node,{w,h}=p.box,x=p.box.x+w/2,y=p.box.y+h/2,stroke=n.kind==='input'?theme.input:n.kind==='output'?theme.output:theme.line;ctx.save();ctx.globalAlpha=r;
  if(theme.id==='kinetic'||theme.id==='paper-cut')ctx.translate(0,6*(1-r));
  if(theme.id==='blueprint'&&r<1){ctx.beginPath();ctx.rect(p.box.x-14,p.box.y-14,w+28,(h+28)*r);ctx.clip();}
  ctx.strokeStyle=stroke;ctx.lineWidth=theme.id==='editorial'?2:4;ctx.setLineDash(theme.id==='drawn'&&!carousel?[Math.max(1,(w+h)*2*r),5000]:[]);ctx.fillStyle=n.kind==='input'?theme.fills.input:n.kind==='output'?theme.fills.output:theme.fills.other;
  if(theme.id==='kinetic'){
   ctx.strokeStyle=stroke;ctx.lineWidth=3;const iy=p.box.y+25;if(n.kind==='actor'){ctx.beginPath();ctx.ellipse(x,iy,12,10,0,0,Math.PI*2);ctx.stroke();}else if(n.kind==='input'){ctx.beginPath();ctx.moveTo(x-8,iy-12);ctx.lineTo(x+12,iy-12);ctx.lineTo(x+8,iy+12);ctx.lineTo(x-12,iy+12);ctx.closePath();ctx.stroke();}else if(n.kind==='storage'){ctx.strokeRect(x-12,iy-8,24,16);ctx.beginPath();ctx.ellipse(x,iy-8,12,4,0,0,Math.PI*2);ctx.stroke();}else if(n.kind==='chart'){ctx.beginPath();ctx.moveTo(x-12,iy-12);ctx.lineTo(x-12,iy+12);ctx.lineTo(x+12,iy+12);ctx.stroke();}else{ctx.strokeRect(x-12,iy-12,24,24);if(n.kind==='output'){ctx.beginPath();ctx.moveTo(x+4,iy-12);ctx.lineTo(x+4,iy-4);ctx.lineTo(x+12,iy-4);ctx.stroke();}}if(n.kind==='input'||n.kind==='output'){ctx.beginPath();ctx.moveTo(x-7,iy);ctx.lineTo(x+7,iy);ctx.lineTo(x+2,iy-5);ctx.moveTo(x+7,iy);ctx.lineTo(x+2,iy+5);ctx.stroke();}if(p.state){ctx.fillStyle=theme.panel;const b=p.state.bounds;ctx.fillRect(b.x-6,b.y-6,b.w+12,b.h+12);}
  }else{
   if(theme.id==='paper-cut'){ctx.save();ctx.translate(6,6);ctx.fillStyle='#b9a68c';shape(ctx,n.kind,x,y,w,h);ctx.fill();ctx.restore();}
   shape(ctx,n.kind,x,y,w,h);ctx.fill();ctx.stroke();ctx.setLineDash([]);
   if(n.kind==='storage'){ctx.beginPath();ctx.ellipse(x,y-h/2+14,w/2,16,0,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.ellipse(x,y+h/2-10,w/2,15,0,0,Math.PI);ctx.stroke();}
   if(n.kind==='output'){ctx.beginPath();ctx.moveTo(x+w/2-28,y-h/2);ctx.lineTo(x+w/2-28,y-h/2+28);ctx.lineTo(x+w/2,y-h/2+28);ctx.stroke();}
   if(theme.id==='editorial'){ctx.beginPath();ctx.moveTo(p.box.x+8,p.box.y+16);ctx.lineTo(p.box.x+8,p.box.y+h-16);ctx.stroke();}
   if(theme.id==='paper-cut'){ctx.fillStyle='#e0c594';ctx.fillRect(x-38,p.box.y-5,76,12);}
  }
  drawText(ctx,p.label,stroke);if(theme.id==='kinetic'){ctx.strokeStyle=stroke;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(p.label.bounds.x,p.label.bounds.y+p.label.bounds.h+1);ctx.lineTo(p.label.bounds.x+p.label.bounds.w,p.label.bounds.y+p.label.bounds.h+1);ctx.stroke();}
  if(p.state&&(carousel||now>=(cue('node',n.id)?.start??Infinity)))drawText(ctx,p.state,theme.attention);
  if(p.bars&&n.values?.length){const max=Math.max(1,...n.values),bar=p.bars.w/n.values.length;n.values.forEach((v,j)=>{ctx.fillStyle=theme.input;ctx.fillRect(p.bars!.x+j*bar,p.bars!.y+p.bars!.h-v/max*p.bars!.h,Math.max(1,bar-10),v/max*p.bars!.h);});}if(p.units)drawText(ctx,p.units,theme.line);
  const revisit=cue('revisit',n.id);if(s.revisit.includes(n.id)&&(carousel||revisit&&now>=revisit.start&&now<=revisit.end+0.8)){ctx.strokeStyle=theme.attention;ctx.lineWidth=3;
   if(theme.id==='drawn'){ctx.beginPath();ctx.ellipse(x,y,w/2+12,h/2+10,-0.025,0,Math.PI*2);ctx.stroke();}
   else if(theme.id==='editorial'||theme.id==='kinetic'){ctx.beginPath();ctx.moveTo(p.label.bounds.x,p.label.bounds.y+p.label.bounds.h+6);ctx.lineTo(p.label.bounds.x+p.label.bounds.w,p.label.bounds.y+p.label.bounds.h+6);ctx.stroke();}
   else{ctx.setLineDash(theme.id==='blueprint'?[18,8]:[]);ctx.strokeRect(p.box.x-8,p.box.y-8,w+16,h+16);}
  }ctx.restore();
 }
 if(layout.focus&&timing){const active=[...timing.cues].filter(c=>c.start<=now).sort((a,b)=>b.start-a.start)[0];if(active){const key=(active.kind==='revisit'?'node':active.kind)+':'+active.target,block=layout.focus.get(key);if(block){ctx.fillStyle=theme.panel;ctx.fillRect(88,1640,904,108);drawText(ctx,block,theme.line);}}}
}
export function videoFrame(t:Timeline,seconds:number,canvas=createCanvas(1080,1920),videoStyle:VideoStyleId='drawn'){loadFonts();const style=legacyVideoStyle(videoStyle),theme=visualTheme(style);const ctx=canvas.getContext('2d');backdrop(ctx,1080,1920,theme);const active=[...t.scenes].reverse().find(s=>seconds>=s.start)||t.scenes[0];const previous=t.scenes[t.scenes.indexOf(active)-1];const carried=new Set(previous?.scene.nodes.map(n=>n.id)||[]);const carriedEdges=new Set(previous?.scene.edges.map(e=>e.from+':'+e.to+':'+e.label+':'+e.kind)||[]);drawScene(ctx,active.scene,seconds-active.start,false,carried,carriedEdges,active,seconds,style,t.scenes.indexOf(active),t.scenes.length);
 const caption=t.captions.find(c=>seconds>=c.start&&seconds<c.end+0.06);if(caption){ctx.fillStyle=style==='drawn'?'#10151dee':theme.captionBg;ctx.fillRect(95,1410,835,220);ctx.font='48px "Radar Hand", "Radar Sans"';ctx.fillStyle=theme.captionText;ctx.textAlign='center';captionLines(caption.text).forEach((line,i)=>ctx.fillText(line,510,1490+i*58));}
 ctx.fillStyle=theme.footer;ctx.font='28px "Radar Sans"';ctx.textAlign='left';ctx.fillText('Illustrated explanation',90,1780);return canvas;
}
export function carouselFrame(s:Scene,index:number,total:number,videoStyle:VideoStyleId='drawn'){loadFonts();const style=legacyVideoStyle(videoStyle),theme=visualTheme(style);const canvas=createCanvas(1080,1350),ctx=canvas.getContext('2d');backdrop(ctx,1080,1350,theme);drawScene(ctx,s,100,true,new Set(),new Set(),undefined,0,style,index,total);drawText(ctx,layoutScene(s,true,style).summary!,theme.line);ctx.font='30px "Radar Sans"';ctx.fillStyle=theme.attention;ctx.textAlign='right';ctx.fillText(`${index+1} / ${total}`,960,1308);return canvas;}
