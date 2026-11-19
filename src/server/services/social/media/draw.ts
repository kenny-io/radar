import { createCanvas,type SKRSContext2D } from '@napi-rs/canvas';
import {layoutScene,loadFonts,pointOnPath,type TextBlock,type Point} from './layout';
export {layoutScene,loadFonts} from './layout';
import { PlanningValidationError,type Scene,type Timeline } from './model';
const color={bg:'#10151d',line:'#f1ecdf',input:'#77b8f1',output:'#90d5ae',attention:'#f1cf6d'};
export function wrap(ctx:SKRSContext2D,text:string,max:number,maxLines=3):string[]{
 const lines:string[]=[];let line='';for(const word of text.split(/\s+/)){if(ctx.measureText(word).width>max)throw new PlanningValidationError('layout','label_width','Diagram label is too wide');if(line&&ctx.measureText(line+' '+word).width>max){lines.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)lines.push(line);if(lines.length>maxLines)throw new PlanningValidationError('layout','label_lines','Explanation text needs shorter labels');return lines;
}
function drawText(ctx:SKRSContext2D,block:TextBlock,fill=color.line){ctx.font=`${block.font}px "Radar Hand", "Radar Sans"`;ctx.fillStyle=fill;ctx.textAlign='left';for(const row of block.rows)ctx.fillText(row.text,row.x,row.y);}
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
export function drawScene(ctx:SKRSContext2D,s:Scene,elapsed:number,carousel=false,carried=new Set<string>(),carriedEdges=new Set<string>(),timing?:Timeline['scenes'][number],now=0){
 const layout=layoutScene(s,carousel),nodes=layout.nodes;drawText(ctx,layout.title);void elapsed;
 const cue=(kind:'node'|'edge'|'revisit',target:string)=>timing?.cues.find(c=>c.kind===kind&&c.target===target);const reveal=(i:number)=>carousel||carried.has(nodes[i].node.id)?1:clamp((now-(cue('node',nodes[i].node.id)?.start??Infinity))/0.55);
 for(const route of layout.edges){const e=route.edge;const progress=carousel||carriedEdges.has(e.from+':'+e.to+':'+e.label+':'+e.kind)?1:clamp((now-(cue('edge',e.from+'->'+e.to)?.start??Infinity))/0.8);if(!progress)continue;
  ctx.save();ctx.strokeStyle=e.kind==='feedback'?color.attention:color.line;ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=4;ctx.globalAlpha=progress;trace(ctx,route.points,progress);
  if(progress>0.9){const end=route.points.at(-1)!,before=route.points.at(-2)!,angle=Math.atan2(end.y-before.y,end.x-before.x);ctx.beginPath();ctx.moveTo(end.x,end.y);ctx.lineTo(end.x-17*Math.cos(angle-0.5),end.y-17*Math.sin(angle-0.5));ctx.lineTo(end.x-17*Math.cos(angle+0.5),end.y-17*Math.sin(angle+0.5));ctx.closePath();ctx.fill();}
  if(route.leader){ctx.lineWidth=2;trace(ctx,route.leader,1);}
  if(route.background&&route.label){ctx.fillStyle=color.bg;const r=route.background;ctx.fillRect(r.x,r.y,r.w,r.h);drawText(ctx,route.label);}
  const spoken=cue('edge',e.from+'->'+e.to);if(!carousel&&progress===1&&spoken&&now>=spoken.start&&now<=spoken.end+0.8){const k=clamp((now-spoken.start)/(spoken.end-spoken.start+0.8)),p=pointOnPath(route.points,k);ctx.fillStyle=color.attention;ctx.beginPath();ctx.arc(p.x,p.y,8,0,Math.PI*2);ctx.fill();}ctx.restore();
 }
 for(const [i,p]of nodes.entries()){const r=reveal(i);if(!r)continue;const n=p.node,{w,h}=p.box,x=p.box.x+w/2,y=p.box.y+h/2,stroke=n.kind==='input'?color.input:n.kind==='output'?color.output:color.line;ctx.save();ctx.globalAlpha=r;ctx.strokeStyle=stroke;ctx.lineWidth=4;ctx.setLineDash(carousel?[]:[Math.max(1,(w+h)*2*r),5000]);ctx.fillStyle=color.bg;
  ctx.beginPath();if(n.kind==='actor'){ctx.ellipse(x,y,w/2,h/2,0,0,Math.PI*2);}else if(n.kind==='input'){ctx.moveTo(x-w/2+25,y-h/2);ctx.lineTo(x+w/2,y-h/2);ctx.lineTo(x+w/2-25,y+h/2);ctx.lineTo(x-w/2,y+h/2);ctx.closePath();}else{ctx.roundRect(x-w/2,y-h/2,w,h,n.kind==='storage'?26:12);}ctx.fill();ctx.stroke();ctx.setLineDash([]);
  if(n.kind==='storage'){ctx.beginPath();ctx.ellipse(x,y-h/2+14,w/2,16,0,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.ellipse(x,y+h/2-10,w/2,15,0,0,Math.PI);ctx.stroke();}
  if(n.kind==='output'){ctx.beginPath();ctx.moveTo(x+w/2-28,y-h/2);ctx.lineTo(x+w/2-28,y-h/2+28);ctx.lineTo(x+w/2,y-h/2+28);ctx.stroke();}
  drawText(ctx,p.label,stroke);if(p.state&&(carousel||now>=(cue('node',n.id)?.start??Infinity)))drawText(ctx,p.state,color.attention);
  if(p.bars&&n.values?.length){const max=Math.max(1,...n.values),bar=p.bars.w/n.values.length;n.values.forEach((v,j)=>{ctx.fillStyle=color.input;ctx.fillRect(p.bars!.x+j*bar,p.bars!.y+p.bars!.h-v/max*p.bars!.h,Math.max(1,bar-10),v/max*p.bars!.h);});}if(p.units)drawText(ctx,p.units);
  const revisit=cue('revisit',n.id);if(s.revisit.includes(n.id)&&(carousel||revisit&&now>=revisit.start&&now<=revisit.end+0.8)){ctx.strokeStyle=color.attention;ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(x,y,w/2+12,h/2+10,-0.025,0,Math.PI*2);ctx.stroke();}ctx.restore();
 }
}
export function videoFrame(t:Timeline,seconds:number,canvas=createCanvas(1080,1920)){loadFonts();const ctx=canvas.getContext('2d');ctx.fillStyle=color.bg;ctx.fillRect(0,0,1080,1920);const active=[...t.scenes].reverse().find(s=>seconds>=s.start)||t.scenes[0];const previous=t.scenes[t.scenes.indexOf(active)-1];const carried=new Set(previous?.scene.nodes.map(n=>n.id)||[]);const carriedEdges=new Set(previous?.scene.edges.map(e=>e.from+':'+e.to+':'+e.label+':'+e.kind)||[]);drawScene(ctx,active.scene,seconds-active.start,false,carried,carriedEdges,active,seconds);
 const caption=t.captions.find(c=>seconds>=c.start&&seconds<c.end+0.06);if(caption){ctx.fillStyle='#10151dee';ctx.fillRect(95,1410,835,220);ctx.font='48px "Radar Hand", "Radar Sans"';ctx.fillStyle=color.line;ctx.textAlign='center';captionLines(caption.text).forEach((line,i)=>ctx.fillText(line,510,1490+i*58));}
 ctx.fillStyle='#707985';ctx.font='28px "Radar Sans"';ctx.textAlign='left';ctx.fillText('Illustrated explanation',90,1780);return canvas;
}
export function carouselFrame(s:Scene,index:number,total:number){loadFonts();const canvas=createCanvas(1080,1350),ctx=canvas.getContext('2d');ctx.fillStyle=color.bg;ctx.fillRect(0,0,1080,1350);drawScene(ctx,s,100,true);drawText(ctx,layoutScene(s,true).summary!);ctx.font='30px "Radar Sans"';ctx.fillStyle=color.attention;ctx.textAlign='right';ctx.fillText(`${index+1} / ${total}`,960,1308);return canvas;}
