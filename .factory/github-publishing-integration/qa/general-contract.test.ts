import {describe,it,expect,vi,beforeEach} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {astro,jekyll,custom,fixtures,payload,type Fixture} from './general-fixtures';
vi.mock('@/server/ai',()=>{const run=vi.fn();return {run,ai:{run}};});
import {run} from '@/server/ai';
import {planRepositoryPost,resolveQuote} from '@/server/services/publishing/connectors/nextjs-agent';
const hash=(value:string)=>crypto.createHash('sha1').update(value).digest('hex');
const mock=vi.mocked(run);
const results:{fixture:string;paths:string[];route:string}[]=[];
const sources=(f:Fixture)=>({entries:[...f.files].map(([path,content])=>({path,type:'blob',mode:'100644',sha:hash(content)})),read:vi.fn(async(name:string)=>{if(!f.files.has(name))throw new Error('Unobserved path '+name);return f.files.get(name)!;})});
function contract(f:Fixture){
 const isAstro=f===astro,isJekyll=f===jekyll;
 const routePath=isAstro?'products/guide-web/src/pages/notes/[...id].astro':isJekyll?'_config.yml':'packages/field-notes/build.mjs';
 const listingPath=isAstro?'products/guide-web/src/pages/notes/index.astro':isJekyll?'index.html':'packages/field-notes/build.mjs';
 const content=isAstro?`---\ntitle: ${JSON.stringify(payload.title)}\ndescription: ${JSON.stringify(payload.meta)}\npubDate: ${payload.date}\n---\n{{RADAR_MARKDOWN}}`:isJekyll?`---\nlayout: post\ntitle: ${JSON.stringify(payload.title)}\ndate: ${payload.date}\n---\n{{RADAR_MARKDOWN}}`:'{{RADAR_HTML}}';
 const changes:any[]=[{kind:'create',path:f.articlePath,expectedSha:null,content,edits:[]}];
 if(f===custom){const name='packages/field-notes/catalog/essays.json';const source=f.files.get(name)!;const record={urlPath:f.route,headline:payload.title,teaser:payload.meta,issued:payload.date,fileName:'reliable-publishing.html'};changes.push({kind:'edit',path:name,expectedSha:hash(source),content:null,edits:[{before:'[\n',after:'[\n  '+JSON.stringify(record)+',\n'}]});}
 const evidence=[{path:routePath,sha:hash(f.files.get(routePath)!),snippet:isAstro?'getStaticPaths':isJekyll?'permalink: /journal/:title/':'for(const e of entries)',role:'route'},{path:listingPath,sha:hash(f.files.get(listingPath)!),snippet:isAstro?'entries.map':isJekyll?'{% for post in site.posts %}':'entries.map',role:'listing'}];
 const plan={slug:payload.slug,articlePath:f.articlePath,route:f.route,summary:'Follow existing routing and listing contract.',changes,evidence};
 const review={approved:true,summary:'Final content enters existing routes and listing.',issues:[],evidence:evidence.map(({sha,...e})=>e)};
 return {plan,review};
}
function responses(f:Fixture,mutate?:(purpose:string,value:any)=>any){
 const c=contract(f);
 let lastProposal:any;
 mock.mockImplementation(async(_task,input:any)=>{
  const purpose=input.purpose;let value:any;
  if(purpose==='github.integration.discover')value={paths:[...f.files.keys()].filter(name=>!name.startsWith('.github/')&&!name.startsWith('.env')),complete:true,summary:'Read the existing loader, routes, index and example article.'};
  else if(purpose==='github.integration.plan')value=c.plan;
  else if(purpose==='github.integration.repair')value=lastProposal||c.plan;
  else if(purpose==='github.integration.review')value=c.review;
  else throw new Error('Unexpected AI purpose '+purpose);
  const response=mutate?mutate(purpose,structuredClone(value)):value;
  if(purpose==='github.integration.plan')lastProposal=response;
  return {json:response,text:'',model:'qa-mocked',provider:'qa',citations:[]};
 });
}
beforeEach(()=>{mock.mockReset();});
describe('independent generalized repository acceptance',()=>{
 it.each(fixtures)('integrates $name using source observations',async f=>{
  responses(f);const snapshot=sources(f);const result=await planRepositoryPost(f.hint,payload,snapshot,{businessId:'qa-business'});
  expect(result.path).toBe(f.articlePath);expect(result.route).toBe(f.route);expect(result.draft).toBe(true);expect(result.review.runtimeVerified).toBe(false);
  expect(result.files.find(file=>file.path===f.articlePath)?.content).toContain(f===custom?payload.html:payload.markdown);expect(result.files.every(file=>!file.content.includes('{{RADAR_'))).toBe(true);
  expect(mock.mock.calls.map(([,input])=>input.purpose)).toContain('github.integration.review');
  const temp=process.env.QA_GENERAL_TEMP;if(temp){const id=f===astro?'astro':f===jekyll?'jekyll':'custom';for(const [name,source]of f.files){const dest=path.join(temp,'artifacts',id,name);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,source);}for(const file of result.files){const dest=path.join(temp,'artifacts',id,file.path);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,file.content);}results.push({fixture:id,paths:result.files.map(f=>f.path),route:result.route});await fs.writeFile(path.join(temp,'plans.json'),JSON.stringify(results,null,2));}
 });
 it('rejects content-only changes when semantic reviewer finds no discovery path',async()=>{
  responses(custom,(purpose,value)=>purpose==='github.integration.review'?{...value,approved:false,issues:['The article has no catalog entry and is invisible in the website.']}:purpose==='github.integration.plan'?{...value,changes:value.changes.slice(0,1)}:value);
  await expect(planRepositoryPost(custom.hint,payload,sources(custom),{businessId:'qa-business'})).rejects.toMatchObject({http:422,kind:'config'});
 });
 it.each(['.github/workflows/deploy.yml','.env.local','package.json','package-lock.json','terraform/main.tf','../../outside.html'])('rejects proposed protected/path-escape edit %s',async name=>{
  responses(custom,(purpose,value)=>purpose==='github.integration.plan'?{...value,changes:[...value.changes,{kind:'create',path:name,expectedSha:null,content:'unauthorized',edits:[]}]}:value);
  await expect(planRepositoryPost(custom.hint,payload,sources(custom),{businessId:'qa-business'})).rejects.toMatchObject({http:422,kind:'config'});
 });
 it('rejects stale exact-source edit evidence',async()=>{
  responses(custom,(purpose,value)=>{if(purpose==='github.integration.plan')value.changes[1].expectedSha='stale';return value;});
  await expect(planRepositoryPost(custom.hint,payload,sources(custom),{businessId:'qa-business'})).rejects.toMatchObject({http:422,kind:'config'});
 });
 it('rejects invented listing evidence and article body replacement',async()=>{
  responses(custom,(purpose,value)=>{if(purpose==='github.integration.plan')value.evidence[1].snippet='the site automatically discovers every file';return value;});
  await expect(planRepositoryPost(custom.hint,payload,sources(custom),{businessId:'qa-business'})).rejects.toMatchObject({http:422,kind:'config'});
  responses(custom,(purpose,value)=>{if(purpose==='github.integration.plan')value.changes[0].content='Replacement article written by the model';return value;});
  await expect(planRepositoryPost(custom.hint,payload,sources(custom),{businessId:'qa-business'})).rejects.toMatchObject({http:422,kind:'config'});
 });
 it('rejects reviewer approvals with invented final-source evidence',async()=>{
  responses(custom,(purpose,value)=>{if(purpose==='github.integration.review')value.evidence[1].snippet='nonexistent rendered article';return value;});
  await expect(planRepositoryPost(custom.hint,payload,sources(custom),{businessId:'qa-business'})).rejects.toMatchObject({http:422,kind:'config'});
 });
 it('treats repository injection text as data and preserves protected source',async()=>{
  responses(custom);const original=custom.files.get('.github/workflows/deploy.yml');const result=await planRepositoryPost(custom.hint,payload,sources(custom),{businessId:'qa-business'});
  expect(result.files.map(f=>f.path)).not.toContain('.github/workflows/deploy.yml');expect(custom.files.get('.github/workflows/deploy.yml')).toBe(original);
  const calls=mock.mock.calls.map(([,input])=>input as any);expect(calls.some(input=>String(input.system).toLowerCase().includes('untrusted'))).toBe(true);
 });
 it('rejects retry identity changes even when the model approves its plan',async()=>{
  responses(custom);
  await expect(planRepositoryPost(custom.hint,payload,sources(custom),{businessId:'qa-business',retry:{slug:'the-original-slug',articlePath:'packages/field-notes/articles/the-original-slug.html'}})).rejects.toMatchObject({http:422,kind:'config'});
 });
 it('rejects replacing an existing symlink with a source edit',async()=>{
  responses(custom);const snapshot=sources(custom);snapshot.entries.find(e=>e.path==='packages/field-notes/catalog/essays.json')!.mode='120000';
  await expect(planRepositoryPost(custom.hint,payload,snapshot,{businessId:'qa-business'})).rejects.toMatchObject({http:422,kind:'config'});
 });
 it('rejects creation below an existing regular file ancestor',async()=>{
  responses(custom,(purpose,value)=>purpose==='github.integration.plan'?{...value,changes:[...value.changes,{kind:'create',path:'packages/field-notes/articles/existing-note.html/child.md',expectedSha:null,content:'Unrelated child',edits:[]}]}:value);
  await expect(planRepositoryPost(custom.hint,payload,sources(custom),{businessId:'qa-business'})).rejects.toMatchObject({http:422,kind:'config'});
 });
 it('rejects ancestor/descendant conflicts among proposed new files',async()=>{
  responses(custom,(purpose,value)=>purpose==='github.integration.plan'?{...value,changes:[...value.changes,{kind:'create',path:'packages/field-notes/articles/conflict',expectedSha:null,content:'A file',edits:[]},{kind:'create',path:'packages/field-notes/articles/conflict/child.md',expectedSha:null,content:'A child',edits:[]}]}:value);
  await expect(planRepositoryPost(custom.hint,payload,sources(custom),{businessId:'qa-business'})).rejects.toMatchObject({http:422,kind:'config'});
 });
 it('rejects overlapping source edits that could bypass whole-file preservation',async()=>{
  responses(custom,(purpose,value)=>{if(purpose==='github.integration.plan'){const source=custom.files.get('packages/field-notes/catalog/essays.json')!;value.changes[1].edits=[{before:'[\n',after:'[\n '},{before:source.replace('[\n','[\n '),after:'[\n]\n'}];}return value;});
  await expect(planRepositoryPost(custom.hint,payload,sources(custom),{businessId:'qa-business'})).rejects.toMatchObject({http:422,kind:'config'});
 });
 it.each(['.','..'])('rejects dot-only article identity %s',async slug=>{
  responses(custom,(purpose,value)=>purpose==='github.integration.plan'?{...value,slug}:value);
  await expect(planRepositoryPost(custom.hint,payload,sources(custom),{businessId:'qa-business'})).rejects.toMatchObject({http:422,kind:'config'});
 });
 it('rejects route traversal semantics',async()=>{
  responses(custom,(purpose,value)=>purpose==='github.integration.plan'?{...value,route:'/reading/../admin/'}:value);
  await expect(planRepositoryPost(custom.hint,payload,sources(custom),{businessId:'qa-business'})).rejects.toMatchObject({http:422,kind:'config'});
 });
 it('refreshes a standalone HTML article while retaining its route and original issued date',async()=>{
  const oldPath='packages/field-notes/articles/existing-note.html';const registry='packages/field-notes/catalog/essays.json';
  responses(custom,(purpose,value)=>{if(purpose==='github.integration.plan'){value.slug='existing-note';value.articlePath=oldPath;value.route='/reading/existing-note/';value.changes=[{kind:'edit',path:oldPath,expectedSha:hash(custom.files.get(oldPath)!),content:null,edits:[{before:custom.files.get(oldPath),after:'{{RADAR_HTML}}'}]},{kind:'edit',path:registry,expectedSha:hash(custom.files.get(registry)!),content:null,edits:[{before:'"headline":"Existing field note"',after:'"headline":'+JSON.stringify(payload.title)}]}];}return value;});
  const result=await planRepositoryPost(custom.hint,{...payload,mode:'refresh',slug:'a-new-proposed-title',refreshUrl:'https://fixture.example/reading/existing-note/?utm_source=qa'},sources(custom),{businessId:'qa-business'});
  expect(result.path).toBe(oldPath);expect(result.slug).toBe('existing-note');expect(result.route).toBe('/reading/existing-note/');
  expect(result.files.find(f=>f.path===oldPath)?.content).toBe(payload.html);const records=JSON.parse(result.files.find(f=>f.path===registry)!.content);expect(records).toHaveLength(1);expect(records[0].issued).toBe('2026-11-01');
 });
 it('rejects refresh that moves the original public article route',async()=>{
  responses(custom);
  await expect(planRepositoryPost(custom.hint,{...payload,mode:'refresh',refreshUrl:'https://fixture.example/reading/existing-note/'},sources(custom),{businessId:'qa-business'})).rejects.toMatchObject({http:422,kind:'config'});
 });
 it('allows retry body equality without another registration',async()=>{
  const files=new Map(custom.files);files.set(custom.articlePath,payload.html);const fixture={...custom,files};
  responses(custom,(purpose,value)=>{if(purpose==='github.integration.discover')value.paths.push(custom.articlePath);if(purpose==='github.integration.plan')value.changes=[{kind:'edit',path:custom.articlePath,expectedSha:hash(payload.html),content:null,edits:[{before:payload.html,after:'{{RADAR_HTML}}'}]}];return value;});
  const result=await planRepositoryPost(custom.hint,payload,sources(fixture),{businessId:'qa-business',retry:{slug:payload.slug,articlePath:custom.articlePath}});
  expect(result.files).toEqual([{path:custom.articlePath,content:payload.html}]);
 });
 it('rejects malformed generated JSON before reviewer approval can override it',async()=>{
  responses(custom,(purpose,value)=>{if(purpose==='github.integration.plan')value.changes[1].edits[0].after='[\n BROKEN JSON';return value;});
  await expect(planRepositoryPost(custom.hint,payload,sources(custom),{businessId:'qa-business'})).rejects.toMatchObject({http:422,kind:'config'});
 });
 it('rejects malformed generated TypeScript before reviewer approval can override it',async()=>{
  responses(custom,(purpose,value)=>purpose==='github.integration.plan'?{...value,changes:[...value.changes,{kind:'create',path:'packages/field-notes/pages/extra.tsx',expectedSha:null,content:'export const invalid = ;',edits:[]}]}:value);
  await expect(planRepositoryPost(custom.hint,payload,sources(custom),{businessId:'qa-business'})).rejects.toMatchObject({http:422,kind:'config'});
 });
 it('repairs one exact-evidence mistake without weakening source validation',async()=>{
  responses(custom,(purpose,value)=>{if(purpose==='github.integration.plan')value.evidence[0].snippet='wrong source quote';if(purpose==='github.integration.repair')value.evidence[0].snippet='for(const e of entries)';return value;});
  const result=await planRepositoryPost(custom.hint,payload,sources(custom),{businessId:'qa-business'});expect(result.draft).toBe(true);expect(mock.mock.calls.map(([,input])=>input.purpose)).toEqual(['github.integration.discover','github.integration.plan','github.integration.repair','github.integration.review']);
 });
 it('can inspect CI ordering as source evidence without editing the workflow',async()=>{
  responses(custom,(purpose,value)=>{if(purpose==='github.integration.discover')value.paths.push('.github/workflows/deploy.yml');return value;});
  const snapshot=sources(custom);const result=await planRepositoryPost(custom.hint,payload,snapshot,{businessId:'qa-business'});expect(snapshot.read).toHaveBeenCalledWith('.github/workflows/deploy.yml');expect(result.files.some(f=>f.path.startsWith('.github/'))).toBe(false);
 });
 it('repairs an independently identified missing catalog entry and obtains a fresh review',async()=>{
  let reviews=0;responses(custom,(purpose,value)=>{if(purpose==='github.integration.plan')value.changes=value.changes.slice(0,1);if(purpose==='github.integration.review'&&reviews++===0)return {...value,approved:false,issues:['The catalog entry is missing, so readers cannot discover this article.']};if(purpose==='github.integration.repair')return contract(custom).plan;return value;});
  const result=await planRepositoryPost(custom.hint,payload,sources(custom),{businessId:'qa-business'});expect(result.files.some(f=>f.path==='packages/field-notes/catalog/essays.json')).toBe(true);const purposes=mock.mock.calls.map(([,input])=>input.purpose);expect(purposes.filter(p=>p==='github.integration.repair')).toHaveLength(1);expect(purposes.filter(p=>p==='github.integration.review')).toHaveLength(2);expect(purposes.length).toBeLessThanOrEqual(8);
 });
 it('does not grant a second correction after deterministic repair has already been used',async()=>{
  responses(custom,(purpose,value)=>{if(purpose==='github.integration.plan')value.evidence[0].snippet='not exact';if(purpose==='github.integration.repair')return contract(custom).plan;if(purpose==='github.integration.review')return {...value,approved:false,issues:['Still not complete.']};return value;});
  await expect(planRepositoryPost(custom.hint,payload,sources(custom),{businessId:'qa-business'})).rejects.toMatchObject({http:422,kind:'config'});expect(mock.mock.calls.filter(([,input])=>input.purpose==='github.integration.repair')).toHaveLength(1);
 });
});
describe('independent exact source-bound elision citations',()=>{
 const first='The first independently unique source anchor.';
 const second='The second independently unique source anchor.';
 const third='The third independently unique source anchor.';
 const fourth='The fourth independently unique source anchor.';
 const fifth='The fifth independently unique source anchor.';
 const source='prefix\n'+first+'\nactual intervening source\n'+second+'\nactual later source\n'+third+'\nanother real gap\n'+fourth+'\nlast gap\n'+fifth+'\nsuffix';
 it('retains ordinary exact contiguous source quotes',()=>{expect(resolveQuote(source,first)).toBe(first);});
 it.each(['...','…'])('returns actual full source bytes for explicit multiline %s elision',marker=>{expect(resolveQuote(source,first+'\n'+marker+'\n'+second)).toBe(first+'\nactual intervening source\n'+second);});
 it('accepts four exact fragments and returns every actual intervening byte',()=>{expect(resolveQuote(source,[first,second,third,fourth].join('\n...\n'))).toBe(source.slice(source.indexOf(first),source.indexOf(fourth)+fourth.length));});
 it.each([
  ['invented fragment',first+'\n...\nThis invented source anchor never exists.'],
  ['reordered fragments',second+'\n...\n'+first],
  ['short fragment','first\n...\n'+second],
  ['five fragments',[first,second,third,fourth,fifth].join('\n...\n')],
  ['inline ellipsis',first+' ... '+second],
  ['unknown gap marker',first+'\n⋯\n'+second],
  ['internal whitespace rewriting',first.replace('first independently','first  independently')+'\n...\n'+second],
 ])('rejects %s instead of inventing a supporting quote',(_name,quote)=>{expect(resolveQuote(source,quote)).toBeNull();});
 it('rejects nonunique fragments even if one plausible order exists',()=>{expect(resolveQuote(source+'\n'+first,first+'\n...\n'+second)).toBeNull();});
 it('rejects overlapping fragments',()=>{expect(resolveQuote('abcdefghijklmnopqrs','abcdefghijklmnop\n...\ndefghijklmnopqrs')).toBeNull();});
 it('applies the8000byte limit to the full resolved span, includingUTF8bytes',()=>{expect(resolveQuote(first+'é'.repeat(4000)+second,first+'\n...\n'+second)).toBeNull();});
 it('preserves exact literal ellipsis text actually present in source',()=>{const exact=first+'\n...\n'+second;expect(resolveQuote(exact,exact)).toBe(exact);});
});
