import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
const runtime='.data/multiplatform-release-qa';
for(const [name,args] of [['setup',['.factory/multiplatform-publishing/release-qa/setup.mjs']],['browser',['.factory/multiplatform-publishing/release-qa/browser.mjs']],['flows',['--import','tsx','.factory/multiplatform-publishing/release-qa/flows.mjs']],['integration',['--import','tsx','.factory/multiplatform-publishing/release-qa/integration.mjs']],['api',['.factory/multiplatform-publishing/release-qa/api.mjs']]]){
  const chunks=[];const code=await new Promise(resolve=>{const p=spawn(process.execPath,args,{env:process.env});p.stdout.on('data',b=>chunks.push(b));p.stderr.on('data',b=>chunks.push(b));p.on('close',resolve)});await fs.writeFile(runtime+'/'+name+'-final.log',Buffer.concat(chunks));console.log(JSON.stringify({check:name,exitCode:code}));if(code)process.exitCode=1;
}
