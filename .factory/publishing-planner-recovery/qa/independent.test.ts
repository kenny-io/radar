import {beforeEach,describe,it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({run:vi.fn()}));
vi.mock('@/server/ai',()=>({ai:{run:mock.run}}));
import {planRepositoryPost,RepositorySourceTooLargeError} from '@/server/services/publishing/connectors/nextjs-agent';
import {PublishError,publishingDiagnosticText} from '@/server/services/publishing/http';
const article:any={entryId:'qa',title:'QA article',slug:'qa',html:'<p>Complete unchanged article body.</p>',markdown:'Complete unchanged article body.',blocks:[],meta:'QA',keyword:'qa',date:'2026-11-10',image:null,canonical:null,mode:'new',refreshUrl:null,sources:[],videos:[],author:'QA'};
const route='export const route = post => `/news/${post.slug}`;';
const listing='export const listing = allPosts.filter(post => post.published);';
const file='site/content/qa.html';
const large='src/generated/website-pages.json';
const files=new Map([['site/router.mjs',route+'\n'+listing],['tools/build.mjs','await generate(); await build();'],['site/registry.json','{"posts": [], "keep": true}']]);
const sha=(path:string)=>'pinned-'+path;
const evidence=()=>[{path:'site/router.mjs',sha:sha('site/router.mjs'),snippet:route,role:'route'},{path:'site/router.mjs',sha:sha('site/router.mjs'),snippet:listing,role:'listing'}];
const proposal=():any=>({slug:'qa',articlePath:file,route:'/news/qa',summary:'QA',changes:[{kind:'create',path:file,expectedSha:null,content:'{{RADAR_HTML}}',edits:[]},{kind:'edit',path:'site/registry.json',expectedSha:sha('site/registry.json'),content:null,edits:[{before:'"posts": []',after:'"posts": [{"slug":"qa","published":true}]'}]}],evidence:evidence()});
const review=()=>({approved:true,summary:'Source-grounded integration.',issues:[],evidence:evidence().map(({sha,...rest})=>rest)});
function snapshot(extra:any[]=[],read?:any){return {entries:[...files.keys()].map(path=>({path,type:'blob',mode:'100644',sha:sha(path)})).concat(extra),read:read||vi.fn(async(path:string)=>files.get(path)!)};}
function respond(options:{plan?:any;repair?:any;inspect?:any;discover?:(prompt:any,n:number)=>any}={}){let n=0;mock.run.mockImplementation(async(_:any,req:any)=>({json:req.purpose.endsWith('discover')?(options.discover?.(JSON.parse(req.prompt),n++)||{paths:[...files.keys()],complete:true,summary:'Read authored route and registry.'}):req.purpose.endsWith('review')?(options.inspect||review()):req.purpose.endsWith('repair')?(options.repair||options.plan||proposal()):(options.plan||proposal())}));}
async function rejected(s:any=snapshot()){try{await planRepositoryPost('',article,s,{businessId:'qa'});throw Error('Unexpected accepted plan');}catch(e){expect(e).toBeInstanceOf(PublishError);return e as PublishError;}}
beforeEach(()=>{mock.run.mockReset();});
describe('Independent publishing acceptance probes',()=>{
 it('recovers an oversized generated request without fetching or observing its bytes',async()=>{const read=vi.fn(async(path:string)=>{if(path===large)throw Error('Oversized download attempted');return files.get(path)!});respond({discover:(p,n)=>n===0?{paths:[large,...files.keys()],complete:true,summary:'Need generated and authored source.'}:{paths:[],complete:true,summary:'Authored chain suffices.'}});const result=await planRepositoryPost('',article,snapshot([{path:large,type:'blob',sha:sha(large),size:846266}],read),{businessId:'qa'});expect(read.mock.calls.some(([p])=>p===large)).toBe(false);expect(result.files.find(f=>f.path===file)?.content).toBe(article.html);for(const [,req] of mock.run.mock.calls.slice(1)){const p=JSON.parse(req.prompt);expect(p.unavailableSources[0]).toMatchObject({path:large,size:846266,limit:100000});expect(p.observed.some((f:any)=>f.path===large)).toBe(false);}});
 it('underreported tree sizes still reject a multi-byte oversized file without exposing partial content',async()=>{const read=vi.fn(async(path:string)=>path===large?'é'.repeat(50001):files.get(path)!);respond({discover:(_,n)=>({paths:n?[]:[large],complete:false,summary:'Mandatory registry unavailable.'})});const err=await rejected(snapshot([{path:large,type:'blob',sha:sha(large),size:1}],read));expect(err.detail).toContain('100002 bytes');expect(err.detail).toContain('100000 bytes');expect(JSON.stringify(mock.run.mock.calls)).not.toContain('éé');expect(read).toHaveBeenCalledTimes(1);});
 it('does not recover unrelated auth/network/stale-read errors',async()=>{for(const error of [new PublishError(401,'Unauthorized','api.github.com'),new PublishError(0,'Connection reset','api.github.com','network'),new PublishError(409,'Snapshot SHA changed','api.github.com','config')]){mock.run.mockReset();respond();const s=snapshot([],vi.fn(async()=>{throw error}));expect(await rejected(s)).toBe(error);expect(mock.run).toHaveBeenCalledTimes(1);}});
 it('will not trust an oversized error for a different pinned SHA',async()=>{respond({discover:()=>({paths:[large],complete:false,summary:'Read'})});const err=new RepositorySourceTooLargeError(large,'wrong-sha',120000);expect(await rejected(snapshot([{path:large,type:'blob',sha:sha(large)}],vi.fn(async()=>{throw err})))).toBe(err);});
 it('never approves a proposal citing unavailable source',async()=>{const plan=proposal();plan.evidence[0]={path:large,sha:sha(large),snippet:'not actually read',role:'route'};respond({plan,discover:(_,n)=>({paths:n?[]:[large,...files.keys()],complete:true,summary:'Authored inputs read.'})});const err=await rejected(snapshot([{path:large,type:'blob',sha:sha(large),size:120000}]));expect(err.http).toBe(422);expect(mock.run.mock.calls.some(([,r])=>r.purpose==='github.integration.review')).toBe(false);});
 it.each([['empty',0,undefined],['files',13,12],['edits',81,80],['output',800000,750000]])('reports host counted %s rejection distinctly',async(kind,count,limit)=>{const plan=proposal();if(kind==='empty')plan.changes=[];if(kind==='files')plan.changes=Array.from({length:13},(_,n)=>({...plan.changes[0],path:`new/${n}.html`}));if(kind==='edits')plan.changes[1].edits=Array.from({length:81},()=>({before:'a',after:'b'}));if(kind==='output')plan.changes[0].content='{{RADAR_HTML}}'+'a'.repeat(count-article.html.length);respond({plan});const err=await rejected();const all=JSON.stringify(err.diagnostic);expect(all).toContain(String(count));if(limit)expect(all).toContain(String(limit));expect(err.source).toBe('radar');expect(err.detail).not.toContain('empty or exceeds');});
 it('keeps review provenance when repair returns an empty plan',async()=>{respond({inspect:{...review(),approved:false,issues:['Required manual registry entry is missing; route is orphaned.']},repair:{...proposal(),changes:[]}});const err=await rejected();const text=err.detail+' '+JSON.stringify(err.diagnostic);expect(text).toContain('Required manual registry');expect(text).toMatch(/no changes|empty/i);expect(mock.run.mock.calls.filter(([,r])=>r.purpose.endsWith('repair'))).toHaveLength(1);});
 it('redacts model text credentials and bounds diagnostic output',()=>{const samples=['Bearer QA_PRIVATE_AUTH_VALUE','api_key=QA_PRIVATE_API_KEY','https://user:QA_PRIVATE_URL_VALUE@example.test/a?token=SECRET','ghp_'+'Q'.repeat(36),'github_pat_'+'R'.repeat(50),'-----BEGIN PRIVATE KEY-----\nQA_PRIVATE_PEM_VALUE\n-----END PRIVATE KEY-----','```const qa = "QA_PRIVATE_SOURCE_VALUE";```'];for(const value of samples){const text=publishingDiagnosticText(value);expect(text).not.toMatch(/QA_PRIVATE_|ghp_Q|github_pat_R/);}expect(publishingDiagnosticText('x'.repeat(5000))).toHaveLength(300);});
});

describe('Independent deadline probes',()=>{
 it('a late read-only model result cannot resume planning after the absolute deadline',async()=>{
  vi.useFakeTimers();
  try{
   let resolve:any;
   mock.run.mockImplementation(()=>new Promise(r=>{resolve=r}));
   const run=planRepositoryPost('',article,snapshot(),{businessId:'qa',deadlineAt:Date.now()+50});
   const rejection=expect(run).rejects.toMatchObject({source:'radar',diagnostic:{code:'publishing-deadline',stage:'discovery'}});
   await vi.advanceTimersByTimeAsync(51);await rejection;
   resolve({json:{paths:[...files.keys()],complete:true,summary:'Late result'}});
   await vi.advanceTimersByTimeAsync(1);
   expect(mock.run).toHaveBeenCalledTimes(1);
  }finally{vi.useRealTimers();}
 });
});
