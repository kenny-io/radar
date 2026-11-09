import fs from'node:fs';
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{const raw=typeof input==='string'?input:input instanceof URL?input.toString():input.url;const u=new URL(raw);let provider,status,body;
if(u.hostname==='openrouter.ai'&&u.pathname==='/api/v1/images'){provider='openrouter';status=402;body={error:{code:402,message:'Insufficient credits'}}}
else if(u.hostname==='api.openai.com'&&u.pathname==='/v1/images/generations'){provider='openai';status=429;body={error:{type:'insufficient_quota',code:'insufficient_quota',message:'No credits remaining'}}}
else if(u.hostname==='api.x.ai'&&u.pathname==='/v1/images/generations'){provider='xai';status=403;body={error:{message:'All credits used or monthly spending limit reached'}}}
if(provider){fs.appendFileSync(process.env.QA_PROVIDER_LOG,JSON.stringify({provider,status,at:new Date().toISOString()})+'\n');return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})}
if(['localhost','127.0.0.1','[::1]'].includes(u.hostname))return originalFetch(input,init);
throw new Error('QA blocked external fetch: '+u.hostname+u.pathname)};
