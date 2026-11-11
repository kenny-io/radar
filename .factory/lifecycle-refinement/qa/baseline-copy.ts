import {writeFile,mkdir} from 'node:fs/promises';
import {load} from 'cheerio';
import {renderLifecycle} from './before-source/lifecycle/templates';
import {EDUCATION_LESSONS} from './before-source/lifecycle/educationContent';
const out='.factory/lifecycle-refinement/qa/before-previews';await mkdir(out,{recursive:true});
const base='https://radar.example.test';
const source={name:'Alex',businessName:'Paper & Pixel',businessId:'11111111-1111-4111-8111-111111111111',trialEnd:'2026-11-15T12:00:00Z',periodEnd:'2026-12-01T12:00:00Z',amountCents:5000,currency:'USD',invoiceNumber:'QA-001',resetUrl:base+'/reset-password#token=qa-only-invalid'};
const entries:any[]=[];
function add(id:string,type:any,data:any){const mail=renderLifecycle(type,data,{appUrl:base,unsubscribeUrl:base+'/email-preferences?token=qa-only-invalid'});const $=load(mail.html);entries.push({id,type,subject:mail.subject,text:mail.text,headings:$('h1,h2').toArray().map(e=>$(e).text()),actions:$('a').toArray().map(e=>({label:$(e).text(),href:$(e).attr('href')})),html:mail.html});}
for(const type of ['welcome','founder_note','password_reset','trial_started','trial_ending','invoice_paid','payment_failed','cancellation_scheduled','subscription_ended'])add(type,type,source);
add('welcome-profile','welcome',{...source,profileAnalyzed:true});
const kinds=['brief_reply','calendar_review','article_social','social_publish'];
const sections=kinds.map((kind,i)=>({eventId:`00000000-0000-4000-8000-00000000000${i}`,kind,businessId:source.businessId,businessName:source.businessName,ref:kind==='brief_reply'?'2026-11-09':'qa-ref',count:2,title:'A useful article'}));
for(const section of sections)add('work-'+section.kind,'work_update',{...source,workSections:[section]});
add('work-combined','work_update',{...source,workSections:sections.slice(0,3)});
for(const lesson of EDUCATION_LESSONS)add(lesson,'weekly_education',{...source,education:{version:1,lesson,businessId:source.businessId,context:{businessName:source.businessName,offering:'design tools',audience:'independent studios',keyword:'design tools for small studios',gscConnected:false,access:'workspace'}}});
for(const e of entries){await writeFile(out+'/'+e.id+'.html',e.html);await writeFile(out+'/'+e.id+'.txt',e.subject+'\n\n'+e.text);}
await writeFile(out+'/catalog.json',JSON.stringify({sourceHead:'f616862c7dcefb1aabec9155972466f7b3aeaf36',scope:'Actual baseline pure lifecycle renderer variants, not a claim of all legacy families; other baseline builders preserved as source.',entries},null,2)+'\n');console.log(JSON.stringify({baselineVariants:entries.length}));
