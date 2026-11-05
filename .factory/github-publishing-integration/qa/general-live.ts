// Bounded live-provider experiment. Credentials are read only from an ephemeral external file.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {astro,custom,payload} from './general-fixtures';
const credentialsPath=process.argv[2];const temp=process.env.QA_GENERAL_TEMP!;
assert(credentialsPath&&temp,'Ephemeral credentials file and QA_GENERAL_TEMP required');
const credentials=JSON.parse(await fs.readFile(credentialsPath,'utf8'));
for(const [name,value]of Object.entries(credentials))if(/^(OPENROUTER_API_KEY|OPEN_ROUTER_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|XAI_API_KEY|OPENROUTER_MODEL_MAP|AI_MODEL_MAP)$/.test(name)&&typeof value==='string')process.env[name]=value;
if(process.env.QA_DIRECT_ANTHROPIC==='1'){delete process.env.OPENROUTER_API_KEY;delete process.env.OPEN_ROUTER_API_KEY;delete process.env.OPENAI_API_KEY;delete process.env.XAI_API_KEY;}
process.env.DATABASE_URL='postgres://postgres@127.0.0.1:1/qa_no_database';
process.env.RADAR_DEV_STUBS='0';
let requests=Number(process.env.QA_REQUESTS_USED||0),halted=false,diagnostics=0;
const requestLimit=Number(process.env.QA_PROVIDER_LIMIT||10);
const networkCalls:any[]=[],blockedHosts=new Set<string>();
const actualFetch=globalThis.fetch;
globalThis.fetch=async(input:any,init:any={})=>{
 const url=new URL(typeof input==='string'?input:input.url||String(input));
 if(!['openrouter.ai','api.openai.com','api.anthropic.com','api.x.ai'].includes(url.hostname))throw new Error('QA blocked unrelated external request');
 if(halted||blockedHosts.has(url.hostname)||++requests>requestLimit)throw new Error('QA live-provider request budget stopped');
 const started=Date.now();
 try{const response=await actualFetch(input,{...init,signal:init.signal?AbortSignal.any([init.signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000)});networkCalls.push({host:url.hostname,status:response.status,elapsedMs:Date.now()-started});if([400,401,402,403,404,408,422,429].includes(response.status))blockedHosts.add(url.hostname);return response;}catch(error){halted=true;networkCalls.push({host:url.hostname,status:'network-or-timeout',elapsedMs:Date.now()-started});throw error;}
};
const originalWarn=console.warn,originalError=console.error;
console.warn=()=>{diagnostics++;};console.error=()=>{diagnostics++;};
const {ai}=await import('../../../src/server/ai');
const {pool}=await import('../../../src/server/db');
const originalRun=ai.run;let calls=0;const modelCalls:any[]=[];const captured:any[]=[];
ai.run=async(task:any,input:any,options:any)=>{assert(++calls<=10,'AI call budget exceeded');const result=await originalRun(task,input,{...options,businessId:undefined,retries:0});modelCalls.push({purpose:input.purpose,model:result.model,provider:result.provider});captured.push({purpose:input.purpose,prompt:JSON.parse(input.prompt),response:result.json});await fs.writeFile(path.join(temp,'live-synthetic-responses.json'),JSON.stringify(captured,null,2));return result;};
const plannerSha256=crypto.createHash('sha256').update(await fs.readFile('src/server/services/publishing/connectors/nextjs-agent.ts')).digest('hex');
const {planRepositoryPost}=await import('../../../src/server/services/publishing/connectors/nextjs-agent');
const results:any[]=[];
let destinations:any[]=[astro,custom];
if(process.env.QA_FINAL_DESTINATIONS==='1')destinations=[astro,{name:'Actual pinned Thally',hint:'src/app/blog',id:'thally',root:'',files:new Map(),entries:JSON.parse(await fs.readFile('/tmp/radar-github-qa.UeAb7d/tree.json','utf8')).tree,sourceRoot:path.join(temp,'thally-pristine')}];
if(process.env.QA_THALLY_ONLY==='1')destinations=destinations.filter(fixture=>fixture.id==='thally');
try{
 for(const fixture of destinations){
  if(halted)break;
  const started=Date.now();const id=fixture.id||(fixture===astro?'astro':'custom');
  const snapshot=fixture.sourceRoot?{entries:fixture.entries,read:async(name:string)=>fs.readFile(path.join(fixture.sourceRoot,name),'utf8')}:{entries:[...fixture.files].map(([path,source]:[string,string])=>({path,type:'blob',mode:'100644',sha:crypto.createHash('sha1').update(source).digest('hex')})),read:async(name:string)=>{assert(fixture.files.has(name));return fixture.files.get(name)!;}};
  try{
   const result=await planRepositoryPost(fixture.hint,payload,snapshot,{businessId:undefined as any});
   if(fixture.sourceRoot)await fs.cp(fixture.sourceRoot,path.join(temp,'live-artifacts',id),{recursive:true});
   else for(const [name,source]of fixture.files){const dest=path.join(temp,'live-artifacts',id,name);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,source);}
   for(const file of result.files){const dest=path.join(temp,'live-artifacts',id,file.path);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,file.content);}
   await fs.writeFile(path.join(temp,`live-plan-${id}.json`),JSON.stringify(result,null,2));
   results.push({fixture:id,status:'planned',paths:result.files.map(f=>f.path),articlePath:result.path,route:result.route,draft:result.draft,runtimeVerified:result.review.runtimeVerified,elapsedMs:Date.now()-started});
  }catch(error:any){results.push({fixture:id,status:'failed-safely',http:error.http||null,kind:error.kind||null,reason:error.http===422?String(error.detail).slice(0,600):'Provider/planning call did not complete; diagnostics suppressed',elapsedMs:Date.now()-started});}
 }
 const evidence={results,plannerSha256AtLoad:plannerSha256,providerRequestsIncludingPriorAttempt:requests,providerRequestLimit:requestLimit,aiCalls:calls,modelCalls,networkCalls,halted,blockedHosts:[...blockedHosts],diagnosticsSuppressed:diagnostics,localRouting:process.env.QA_DIRECT_ANTHROPIC==='1'?'Child omitted documented unavailable OpenRouter/OpenAI routes; existing configured Anthropic model route unchanged':'Existing configured production failover',scope:'Read-only local/snapshot source, real configured provider through production ai.run; DB connection isolated to unreachable loopback; no GitHub or remote publishing writes. Intermediate/private source remains temporary only.'};
 const output=process.env.QA_THALLY_ONLY==='1'?'general-live-thally-final-result.json':process.env.QA_FINAL_DESTINATIONS==='1'?'general-live-final-result.json':'general-live-result.json';await fs.writeFile('.factory/github-publishing-integration/qa/'+output,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
}finally{await pool.end();console.warn=originalWarn;console.error=originalError;}
