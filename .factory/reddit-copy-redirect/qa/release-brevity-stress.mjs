import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {cleanReply,cleanBrand,hasDisclosure,namesBusiness} from '../../../src/server/services/brief/rules.ts';
let cases=0;const results=[];
const count=t=>t.trim().split(/\s+/).filter(Boolean).length;
const concise=t=>{assert(t.trim());const p=t.split(/\n\s*\n/);assert(p.length<=3);assert(count(t)<=150);for(const x of p)assert(count(x)<=50);};
for(const plat of ['reddit','x','linkedin','hn','quora'])for(const n of [1,2,3,4,8])for(const sentences of [1,4,12])for(const disclosureAt of ['first','last','missing']) {
 const ctx={plat,name:'Thally',domain:'thally.io'};const advice=Array(sentences).fill('Ask users which setup step confused them and test that one first.').join(' ');let paras=Array(n).fill(advice);
 if(disclosureAt==='first')paras.unshift('Full disclosure, I work on Thally.');if(disclosureAt==='last')paras.push('Full disclosure, I work on Thally.');
 const raw=paras.join('\n\n');const mention=cleanReply(raw,'mention',ctx),help=cleanReply(raw,'help',ctx),brand=cleanBrand(raw,ctx,'');
 for(const text of [mention,help,brand]){concise(text);if(plat==='x')assert(text.length<=280);}
 assert(hasDisclosure(mention));assert(namesBusiness(mention,'Thally'));if(plat==='reddit')assert(!/https?:\/\//.test(mention));cases++;
}
results.push({name:'Generated reply shape/disclosure stress',pass:true,syntheticInputs:cases,outputs:cases*3});console.log(JSON.stringify(results));await fs.writeFile('.factory/reddit-copy-redirect/qa/release-brevity-stress-results.json',JSON.stringify({results},null,2));
