import {describe,it,expect,vi} from 'vitest';
import {createCanvas} from '@napi-rs/canvas';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {layoutScene,fitText,inside,intersects,segmentHits,pointOnPath,type Rect,type TextBlock} from './layout';
import {carouselFrame,drawScene,videoFrame} from './draw';
import {rendererIdentity,VERSION,LAYOUT_VERSION,hash,scriptOf,type Scene} from './model';
import {stubPlan} from './planner';
import {timelineFor} from './timeline';
function scene(count=4):Scene{return {id:'synthetic',title:'Follow a request through the checks',narration:'A request moves through an illustrative check and keeps a receipt for later review.',mainIdea:'Each item keeps its own result, so an incomplete check can be reviewed before the next action starts.',nodes:Array.from({length:count},(_,i)=>({id:'item'+i,label:['Approved request','Check account','Keep receipt','Reviewed result','Next check','Complete record'][i],kind:i===0?'input':i===count-1?'output':'process'})),edges:Array.from({length:count-1},(_,i)=>({from:'item'+i,to:'item'+(i+1),label:'next step',kind:'flow'})),revisit:[],cues:[]};}
const contained=(a:Rect,b:Rect)=>expect(inside(a,b)).toBe(true);
const words=(s:string)=>s.trim().replace(/\s+/g,' ');
const value=(b:TextBlock)=>words(b.rows.map(r=>r.text).join(' '));
describe('deterministic measured diagram layout',()=>{
 it.each([2,4,6])('fits %i ordered nodes with disjoint text zones and protected labels',count=>{
  const input=scene(count),before=structuredClone(input);
  for(const mode of [true,false]){const l=layoutScene(input,mode);expect(input).toEqual(before);expect(l.nodes.map(n=>n.node.id)).toEqual(input.nodes.map(n=>n.id));
   for(const n of l.nodes){expect(n.label.font).toBeGreaterThanOrEqual(36);contained(n.label.bounds,n.inner);for(const row of n.label.rows)contained(row.bounds,n.inner);expect(value(n.label)).toBe(words(n.node.label));}
   for(const edge of l.edges){if(edge.background){for(const n of l.nodes)expect(intersects(edge.background,n.protected)).toBe(false);for(const other of l.edges.filter(e=>e!==edge)){expect(other.points.slice(1).some((p,i)=>segmentHits(other.points[i],p,edge.background!,0))).toBe(false);if(other.background)expect(intersects(edge.background,other.background)).toBe(false);}}}
  }
 });
 it('keeps a long main idea at readable size with every word and punctuation',()=>{
  const input=scene();input.mainIdea='Record the accepted result for each independent check, then review the remaining evidence before deciding whether a later action is needed.';
  const l=layoutScene(input,true);expect(l.summary!.rows.length).toBeGreaterThan(2);expect(l.summary!.font).toBeGreaterThanOrEqual(36);expect(value(l.summary!)).toBe(input.mainIdea);contained(l.summary!.bounds,{x:100,y:1080,w:880,h:180});
 });
 it('packs storage label and a wrapped state into separate cap-safe zones',()=>{
  const input=scene(5);input.nodes[3]={id:'item3',label:'Separate records',kind:'storage',state:'illustrative example results'};
  const n=layoutScene(input,true).nodes[3];expect(n.state!.rows.length).toBeGreaterThan(1);expect(n.state!.font).toBe(30);expect(value(n.state!)).toBe(input.nodes[3].state);expect(intersects(n.label.zone,n.state!.zone)).toBe(false);contained(n.label.bounds,n.inner);contained(n.state!.bounds,n.inner);expect(n.inner.y).toBeGreaterThanOrEqual(n.box.y+36);
 });
 it('fits actor text inside the ellipse and keeps chart units, state and bars separate',()=>{
  const input=scene(2);input.nodes[0]={id:'item0',label:'Review team',kind:'actor',state:'Ready'};input.nodes[1]={id:'item1',label:'Saved count',kind:'chart',values:[2,4],units:'items',illustrative:true,state:'Example'};
  const l=layoutScene(input,true);for(const row of [...l.nodes[0].label.rows,...l.nodes[0].state!.rows])for(const x of [row.bounds.x,row.bounds.x+row.bounds.w])for(const y of [row.bounds.y,row.bounds.y+row.bounds.h]){const box=l.nodes[0].box;expect(((x-box.x-box.w/2)/(box.w/2))**2+((y-box.y-box.h/2)/(box.h/2))**2).toBeLessThan(1);}
  const n=l.nodes[1];expect(n.bars!.h).toBeGreaterThanOrEqual(48);expect(n.units!.font).toBeGreaterThanOrEqual(26);const zones=[n.label.bounds,n.state!.bounds,n.bars!,n.units!.bounds];for(const [i,a]of zones.entries()){contained(a,n.inner);for(const b of zones.slice(i+1))expect(intersects(a,b)).toBe(false);}expect(value(n.units!)).toBe('Illustrative · items');
 });
 it('moves a horizontal edge label to a clear band using a leader without losing its text',()=>{
  const input=scene(4);input.edges=[{from:'item0',to:'item1',label:'a complete comparison',kind:'compare'}];const e=layoutScene(input,true).edges[0];expect(e.leader).toBeTruthy();expect(e.label!.font).toBe(30);expect(value(e.label!)).toBe('a complete comparison');expect(e.background!.w).toBeLessThanOrEqual(320);
 });
 it('routes a skipping connection around the intervening protected object and preserves direction',()=>{
  const input=scene(6);input.edges=[{from:'item0',to:'item4',label:'skip completed check',kind:'flow'}];const l=layoutScene(input,true),e=l.edges[0];expect(e.points.length).toBeGreaterThan(2);expect(e.points.slice(1).some((p,i)=>segmentHits(e.points[i],p,l.nodes[2].protected,0))).toBe(false);expect(e.edge.from).toBe('item0');expect(e.edge.to).toBe('item4');expect(pointOnPath(e.points,0)).toEqual(e.points[0]);expect(pointOnPath(e.points,1)).toEqual(e.points.at(-1));
 });
 it('places long horizontal relationships above and below a diagonal connection without crossing it',()=>{
  const input=scene(4);input.nodes=input.nodes.map((n,i)=>({...n,label:['Incoming recorded item','Current approval check','Saved accepted result','Later receipt review'][i],kind:['input','process','storage','output'][i] as Scene['nodes'][number]['kind'],state:['Waiting for a check','Check is now complete','Saved for later review','Ready for the next step'][i]}));input.edges.forEach((edge,i)=>edge.label=['Check recorded conditions','Retain the accepted receipt','Review the saved result'][i]);
  for(const mode of [true,false]){const l=layoutScene(input,mode);expect(l.edges.every(e=>e.label)).toBe(true);expect(l.edges[0].leader).toBeTruthy();for(const edge of l.edges){expect(value(edge.label!)).toBe(edge.edge.label);for(const other of l.edges.filter(e=>e!==edge))expect(other.points.slice(1).some((p,i)=>segmentHits(other.points[i],p,edge.background!,2))).toBe(false);}}
 });
 it('uses cumulative distance along bends instead of jumping directly between endpoints',()=>{
  const points=[{x:0,y:0},{x:100,y:0},{x:100,y:300}];expect(pointOnPath(points,.25)).toEqual({x:100,y:0});expect(pointOnPath(points,.5)).toEqual({x:100,y:100});expect(pointOnPath(points,.75)).toEqual({x:100,y:200});
 });
 it('refuses truly impossible text at the minimum rather than truncating or shrinking',()=>{
  expect(()=>fitText('W'.repeat(65),{x:0,y:0,w:200,h:180},44,36,3)).toThrow(expect.objectContaining({phase:'layout'}));
  const input=scene(6);input.nodes[0].label='A complicated grouping with many separate labelled properties';input.nodes[0].state='A long descriptive status that cannot share this space';expect(()=>layoutScene(input,true)).toThrow(expect.objectContaining({phase:'layout'}));
 });
 it('routes a reverse feedback connection on a separate stable rail',()=>{
  const input=scene(2);input.edges.push({from:'item1',to:'item0',label:'reverse connection',kind:'feedback'});
  const l=layoutScene(input,true);expect(l.edges[1].points.length).toBeGreaterThan(2);expect(l.edges[1].points).not.toEqual([...l.edges[0].points].reverse());expect(l.edges.every(e=>e.label)).toBe(true);
 });
 it('refuses a dense label collision instead of masking foreign connections',()=>{
  const input=scene(6);input.edges=[[0,1],[0,2],[0,3],[0,4],[0,5],[1,3],[2,4],[3,5]].map(([from,to])=>({from:'item'+from,to:'item'+to,label:'a result for the subsequent review',kind:'flow'}));
  expect(()=>layoutScene(input,true)).toThrow(expect.objectContaining({phase:'layout',diagnosticCode:'layout_collision'}));
 });
 it('draws all fitted synthetic strings, measuring actual glyph bounds inside their boxes',()=>{
  const input=scene(4);input.nodes[2].state='Waiting for review';const l=layoutScene(input,true),canvas=createCanvas(1080,1350),ctx=canvas.getContext('2d'),trace:{text:string;x:number;y:number;font:string}[]=[];const fill=ctx.fillText.bind(ctx);vi.spyOn(ctx,'fillText').mockImplementation((text,x,y,maxWidth)=>{trace.push({text:String(text),x,y,font:ctx.font});fill(String(text),x,y,maxWidth);});drawScene(ctx,input,100,true);
  const blocks=[l.title,...l.nodes.flatMap(n=>[n.label,...(n.state?[n.state]:[])]),...l.edges.flatMap(e=>e.label?[e.label]:[])];for(const b of blocks)for(const row of b.rows){expect(trace.some(t=>t.text===row.text&&Math.abs(t.x-row.x)<.001&&Math.abs(t.y-row.y)<.001)).toBe(true);ctx.font=`${b.font}px "Radar Hand", "Radar Sans"`;ctx.textAlign='left';const m=ctx.measureText(row.text);contained({x:row.x-m.actualBoundingBoxLeft,y:row.y-m.actualBoundingBoxAscent,w:m.actualBoundingBoxLeft+m.actualBoundingBoxRight,h:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent},b.zone);}vi.restoreAllMocks();
 });
 it('caches scene measurements for warm frames and produces deterministic images',()=>{
  const input=scene(4);expect(layoutScene(input,true)).toBe(layoutScene(input,true));expect(layoutScene(input,true)).not.toBe(layoutScene(input,false));const canvas=createCanvas(1080,1350),ctx=canvas.getContext('2d');const measure=vi.spyOn(Object.getPrototypeOf(ctx),'measureText');drawScene(ctx,input,100,true);expect(measure).not.toHaveBeenCalled();measure.mockRestore();const first=carouselFrame(input,0,3).toBuffer('image/jpeg');const second=carouselFrame(input,0,3).toBuffer('image/jpeg');expect(first.equals(second)).toBe(true);expect(layoutScene(structuredClone(input),true)).toEqual(layoutScene(input,true));
 });
 it('changes only the visual identity salt while keeping reviewed script and timeline immutable',async()=>{
  const fonts=await Promise.all(['Kalam-Regular.ttf','NotoSans.ttf'].map(f=>fs.readFile('assets/social-media/'+f)));const digests=fonts.map(f=>createHash('sha256').update(f).digest('hex'));expect(await rendererIdentity()).not.toBe(hash({version:VERSION,fonts:digests}));expect(await rendererIdentity()).toBe(hash({version:VERSION,layout:LAYOUT_VERSION,fonts:digests}));expect(VERSION).toBe('diagram-v2-aligned-cues');
  const p=stubPlan({title:'How a request keeps a receipt'}),script=scriptOf(p),a={characters:[...script],character_start_times_seconds:[...script].map((_,i)=>i*.03),character_end_times_seconds:[...script].map((_,i)=>(i+1)*.03)},timeline=timelineFor(p,a,script.length*.03),snapshot=structuredClone(timeline);videoFrame(timeline,1);videoFrame(timeline,5);expect(timeline).toEqual(snapshot);expect(scriptOf(p)).toBe(script);
 });
});
