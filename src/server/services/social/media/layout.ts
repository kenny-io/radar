import {createCanvas,GlobalFonts} from '@napi-rs/canvas';
import path from 'node:path';
import {PlanningValidationError,type Scene} from './model';

export interface Rect {x:number;y:number;w:number;h:number}
export interface Point {x:number;y:number}
export interface TextRow {text:string;x:number;y:number;bounds:Rect}
export interface TextBlock {font:number;rows:TextRow[];bounds:Rect;zone:Rect}
export interface NodeLayout {node:Scene['nodes'][number];box:Rect;protected:Rect;inner:Rect;label:TextBlock;state?:TextBlock;units?:TextBlock;bars?:Rect}
export interface EdgeLayout {edge:Scene['edges'][number];points:Point[];label?:TextBlock;background?:Rect;leader?:Point[]}
export interface SceneLayout {title:TextBlock;summary?:TextBlock;diagram:Rect;nodes:NodeLayout[];edges:EdgeLayout[]}
let fonts=false;
export function loadFonts(){if(fonts)return;for(const [file,name]of [['Kalam-Regular.ttf','Radar Hand'],['NotoSans.ttf','Radar Sans']])if(!GlobalFonts.registerFromPath(path.join(process.cwd(),'assets/social-media',file),name))throw new Error('Explainer font is missing');fonts=true;}
const measure=createCanvas(1,1).getContext('2d');
const cache=new WeakMap<Scene,Map<boolean,SceneLayout>>();
const center=(r:Rect):Point=>({x:r.x+r.w/2,y:r.y+r.h/2});
export const inflate=(r:Rect,p:number):Rect=>({x:r.x-p,y:r.y-p,w:r.w+2*p,h:r.h+2*p});
export const intersects=(a:Rect,b:Rect)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
export const inside=(a:Rect,b:Rect)=>a.x>=b.x-.01&&a.y>=b.y-.01&&a.x+a.w<=b.x+b.w+.01&&a.y+a.h<=b.y+b.h+.01;
function collision():never{throw new PlanningValidationError('layout','layout_collision','This diagram needs shorter labels or fewer objects to remain readable.');}
function metrics(value:string,font:number){measure.font=`${font}px "Radar Hand", "Radar Sans"`;measure.textAlign='left';const m=measure.measureText(value);return {left:m.actualBoundingBoxLeft,right:m.actualBoundingBoxRight,ascent:m.actualBoundingBoxAscent,descent:m.actualBoundingBoxDescent,width:Math.max(m.width,m.actualBoundingBoxLeft+m.actualBoundingBoxRight)};}
function rowsFor(value:string,width:number,font:number,maxLines:number){const rows:string[]=[];let line='';for(const word of value.trim().split(/\s+/)){if(metrics(word,font).width>width)return null;const next=line?line+' '+word:word;if(line&&metrics(next,font).width>width){rows.push(line);line=word;}else line=next;}if(line)rows.push(line);return rows.length<=maxLines?rows:null;}
export function fitText(value:string,zone:Rect,preferred:number,min:number,maxLines:number):TextBlock {
 loadFonts();for(let font=preferred;font>=min;font-=2){const rows=rowsFor(value,zone.w,font,maxLines);if(!rows)continue;const ms=rows.map(row=>metrics(row,font));const ascent=Math.max(...ms.map(m=>m.ascent)),descent=Math.max(...ms.map(m=>m.descent));const height=ascent+descent+(rows.length-1)*font*1.15;if(height>zone.h)continue;const top=zone.y+(zone.h-height)/2;const lines=rows.map((text,i)=>{const m=ms[i],x=zone.x+zone.w/2+(m.left-m.right)/2,y=top+ascent+i*font*1.15;return {text,x,y,bounds:{x:x-m.left,y:y-m.ascent,w:m.left+m.right,h:m.ascent+m.descent}};});const left=Math.min(...lines.map(r=>r.bounds.x)),right=Math.max(...lines.map(r=>r.bounds.x+r.bounds.w));const bounds={x:left,y:top,w:right-left,h:height};if(inside(bounds,zone))return {font,rows:lines,bounds,zone};}
 throw new PlanningValidationError('layout','label_lines','Explanation text needs shorter labels to remain readable.');
}
function move(block:TextBlock,y:number):TextBlock{const dy=y-block.bounds.y;return {...block,zone:{...block.zone,y,h:block.bounds.h},bounds:{...block.bounds,y},rows:block.rows.map(row=>({...row,y:row.y+dy,bounds:{...row.bounds,y:row.bounds.y+dy}}))};}
function nodeLayout(node:Scene['nodes'][number],box:Rect):NodeLayout {
 const inner=node.kind==='actor'?{x:box.x+box.w*.14,y:box.y+box.h*.16,w:box.w*.72,h:box.h*.68}:node.kind==='storage'?{x:box.x+18,y:box.y+36,w:box.w-36,h:box.h-56}:node.kind==='input'?{x:box.x+40,y:box.y+18,w:box.w-80,h:box.h-36}:{x:box.x+18,y:box.y+(node.kind==='output'?34:18),w:box.w-36,h:box.h-(node.kind==='output'?52:36)};
 for(let font=44;font>=36;font-=2){try{
  const label=fitText(node.label,{...inner,h:1000},font,font,3);const state=node.state?fitText(node.state,{...inner,h:1000},30,30,4):undefined;
  const chart=node.kind==='chart',count=1+Number(!!state)+2*Number(chart);const unitHeight=inner.h-label.bounds.h-(state?.bounds.h||0)-(chart?48:0)-(count-1)*8;const units=chart?fitText((node.illustrative?'Illustrative · ':'')+(node.units||''),{...inner,h:Math.max(0,unitHeight)},28,26,2):undefined;
  const height=label.bounds.h+(state?.bounds.h||0)+(units?.bounds.h||0)+(node.kind==='chart'?48:0)+(count-1)*8;if(height>inner.h)continue;
  let y=inner.y+(inner.h-height)/2;const fitted=move(label,y);y+=label.bounds.h+8;const fittedState=state?move(state,y):undefined;if(state)y+=state.bounds.h+8;const bars=node.kind==='chart'?{x:inner.x+8,y,w:inner.w-16,h:48}:undefined;if(bars)y+=bars.h+8;const fittedUnits=units?move(units,y):undefined;
  return {node,box,protected:inflate(box,16),inner,label:fitted,state:fittedState,bars,units:fittedUnits};
 }catch(error){if(!(error instanceof PlanningValidationError))throw error;}}
 throw new PlanningValidationError('layout','label_lines','This diagram object needs shorter labels or state text to remain readable.');
}
/** Closed segment intersection, including a small stroke clearance. */
export function segmentHits(a:Point,b:Point,rect:Rect,padding=3):boolean {
 const r=inflate(rect,padding);let low=0,high=1;const dx=b.x-a.x,dy=b.y-a.y;
 for(const [p,q]of [[-dx,a.x-r.x],[dx,r.x+r.w-a.x],[-dy,a.y-r.y],[dy,r.y+r.h-a.y]]){if(Math.abs(p)<1e-9){if(q<0)return false;}else{const t=q/p;if(p<0)low=Math.max(low,t);else high=Math.min(high,t);if(low>high)return false;}}
 return true;
}
const pathHits=(points:Point[],r:Rect,pad=3)=>points.slice(1).some((p,i)=>segmentHits(points[i],p,r,pad));
function cross(a:Point,b:Point,c:Point,d:Point){const orient=(p:Point,q:Point,r:Point)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);const u=orient(a,b,c),v=orient(a,b,d),w=orient(c,d,a),z=orient(c,d,b);if(Math.abs(u)+Math.abs(v)+Math.abs(w)+Math.abs(z)<1e-6)return Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))<=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))&&Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))<=Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y));const sign=(v:number)=>Math.abs(v)<1e-6?0:Math.sign(v);return sign(u)*sign(v)<=0&&sign(w)*sign(z)<=0;}
const pathsCross=(a:Point[],b:Point[])=>a.slice(1).some((p,i)=>b.slice(1).some((q,j)=>cross(a[i],p,b[j],q)));
function boundary(n:NodeLayout,toward:Point):Point {const c=center(n.box),dx=toward.x-c.x,dy=toward.y-c.y;if(!dx&&!dy)return c;const scale=n.node.kind==='actor'?1/Math.sqrt((dx/(n.box.w/2))**2+(dy/(n.box.h/2))**2):Math.min(dx?Math.abs(n.box.w/2/dx):Infinity,dy?Math.abs(n.box.h/2/dy):Infinity);return {x:c.x+dx*scale,y:c.y+dy*scale};}
export function pointOnPath(points:Point[],fraction:number):Point {const lengths=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.y-points[i].y));let distance=Math.max(0,Math.min(1,fraction))*lengths.reduce((a,b)=>a+b,0);for(let i=0;i<lengths.length;i++){if(distance<=lengths[i]||i===lengths.length-1){const k=lengths[i]?distance/lengths[i]:0;return {x:points[i].x+(points[i+1].x-points[i].x)*k,y:points[i].y+(points[i+1].y-points[i].y)*k};}distance-=lengths[i];}return points[0];}
function route(edge:Scene['edges'][number],nodes:NodeLayout[],index:number,previous:EdgeLayout[]):Point[]{
 const a=nodes.find(n=>n.node.id===edge.from)!,b=nodes.find(n=>n.node.id===edge.to)!,ac=center(a.box),bc=center(b.box),foreign=nodes.filter(n=>n!==a&&n!==b);const direct=[boundary(a,bc),boundary(b,ac)];const reverse=previous.some(e=>e.edge.from===edge.to&&e.edge.to===edge.from);if(!reverse&&!foreign.some(n=>pathHits(direct,n.protected)))return direct;
 if(ac.y===bc.y){const ys=[...new Set(nodes.map(n=>n.box.y))].sort((a,b)=>a-b);const bands=ys.slice(1).map((y,i)=>(ys[i]+a.box.h+y)/2);for(const y of bands){const path=[boundary(a,{x:ac.x,y}),{x:ac.x,y},{x:bc.x,y},boundary(b,{x:bc.x,y})];if(!foreign.some(n=>pathHits(path,n.protected)))return path;}}
 const gutter=[540,520,560],offset=index%gutter.length;const lanes=[...gutter.slice(offset),...gutter.slice(0,offset),56,1024];for(const x of lanes){if((x>a.box.x&&x<a.box.x+a.box.w)||(x>b.box.x&&x<b.box.x+b.box.w))continue;const path=[boundary(a,{x,y:ac.y}),{x,y:ac.y},{x,y:bc.y},boundary(b,{x,y:bc.y})].filter((p,i,all)=>!i||p.x!==all[i-1].x||p.y!==all[i-1].y);if(!foreign.some(n=>pathHits(path,n.protected)))return path;}
 return collision();
}
function labelPlacement(edge:EdgeLayout,index:number,edges:EdgeLayout[],nodes:NodeLayout[],diagram:Rect,bands:number[]):Pick<EdgeLayout,'label'|'background'|'leader'>{
 if(!edge.edge.label)return {};
 const text=fitText(edge.edge.label,{x:0,y:0,w:296,h:90},30,30,2);const w=text.bounds.w+24,h=text.bounds.h+16;const positions:Point[]=[];
 for(const t of [.5,.33,.67,.2,.8]){const p=pointOnPath(edge.points,t);positions.push(p,{x:p.x,y:p.y-60},{x:p.x,y:p.y+60});}
 for(const y of bands)for(const x of [540,260,820,400,680])positions.push({x,y});
 for(const node of nodes)positions.push({x:1080-center(node.box).x,y:center(node.box).y});
 const foreign=edges.filter(e=>e!==edge);const occupied=edges.slice(0,index).flatMap(e=>e.background?[e.background]:[]);
 for(const p of positions){const background={x:p.x-w/2,y:p.y-h/2,w,h};if(!inside(background,diagram)||nodes.some(n=>intersects(background,n.protected))||occupied.some(r=>intersects(inflate(background,6),r))||foreign.some(e=>pathHits(e.points,background,5)||e.leader&&pathHits(e.leader,background,4)))continue;
  let leader:Point[]|undefined;
  if(!pathHits(edge.points,background,0)){
   const targets=[.5,.33,.67,.2,.8].map(t=>pointOnPath(edge.points,t));
   const rails=[...new Set(nodes.flatMap(n=>[n.protected.y-8,n.protected.y+n.protected.h+8]))].filter(y=>y>=diagram.y&&y<=diagram.y+diagram.h).sort((a,b)=>Math.abs(a-p.y)-Math.abs(b-p.y));
   outer:for(const target of targets){const detours=rails.map(y=>[p,{x:p.x,y},{x:target.x,y},target]);for(const points of [[p,target],[p,{x:p.x,y:target.y},target],[p,{x:target.x,y:p.y},target],...detours]){
    if(nodes.some(n=>pathHits(points,n.protected))||occupied.some(r=>pathHits(points,r,5))||foreign.some(e=>pathsCross(points,e.points)||e.leader&&pathsCross(points,e.leader)))continue;leader=points;break outer;
   }}if(!leader)continue;
  }
  const zone={x:background.x+12,y:background.y+8,w:background.w-24,h:background.h-16},dx=zone.x-text.bounds.x,dy=zone.y-text.bounds.y;const label={...text,zone,bounds:{...text.bounds,x:zone.x,y:zone.y},rows:text.rows.map(row=>({...row,x:row.x+dx,y:row.y+dy,bounds:{...row.bounds,x:row.bounds.x+dx,y:row.bounds.y+dy}}))};return {label,background,leader};
 }
 return collision();
}
export function layoutScene(scene:Scene,carousel:boolean):SceneLayout {
 const previous=cache.get(scene)?.get(carousel);if(previous)return previous;loadFonts();const titleBox={x:100,y:carousel?65:120,w:880,h:140};const diagram={x:80,y:carousel?240:330,w:920,h:carousel?790:950};const title=fitText(scene.title,titleBox,56,48,2);const summary=carousel?fitText(scene.mainIdea,{x:100,y:1080,w:880,h:180},40,36,4):undefined;
 const columns=scene.nodes.length<=3?1:2,rows=Math.ceil(scene.nodes.length/columns),minimumGap=carousel?125:115;const h=Math.min(carousel?240:260,(diagram.h-(rows-1)*minimumGap)/rows);const gap=rows>1?(diagram.h-rows*h)/(rows-1):0;const width=columns===1?570:360;
 const nodes=scene.nodes.map((node,i)=>nodeLayout(node,{x:(columns===1?540:i%2?820:260)-width/2,y:diagram.y+(rows===1?(diagram.h-h)/2:Math.floor(i/columns)*(h+gap)),w:width,h}));
 const edges:EdgeLayout[]=[];for(const [i,edge]of scene.edges.entries())edges.push({edge,points:route(edge,nodes,i,edges)});const bands=Array.from({length:Math.max(0,rows-1)},(_,i)=>[.5,.25,.75].map(f=>diagram.y+h+i*(h+gap)+gap*f)).flat();
 for(let i=0;i<edges.length;i++)Object.assign(edges[i],labelPlacement(edges[i],i,edges,nodes,diagram,bands));
 const result={title,summary,diagram,nodes,edges};const modes=cache.get(scene)||new Map<boolean,SceneLayout>();modes.set(carousel,result);cache.set(scene,modes);return result;
}
