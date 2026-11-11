import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {renderLifecycle} from '@/server/services/lifecycle/templates';
const out='.factory/lifecycle-emails/qa/journey-alignment';await mkdir(out,{recursive:true});
const variants:Record<string,string>={welcome_analyzed:await readFile('.factory/lifecycle-emails/previews/welcome.html','utf8'),workspace_open:await readFile('.factory/lifecycle-emails/previews/workspace_ready.html','utf8'),welcome_direct:renderLifecycle('welcome',{name:'Alex',profileAnalyzed:false},{appUrl:'https://radar.thally.io'}).html,founder_actual:await readFile('.factory/lifecycle-emails/previews/founder_note.html','utf8')};
for(const name of ['password_reset','trial_started','trial_ending','invoice_paid','payment_failed','cancellation_scheduled','subscription_ended'])variants[name]=await readFile(`.factory/lifecycle-emails/previews/${name}.html`,'utf8');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const page=await browser.newPage();const checks=[];
try{
 for(const width of [390,600]){
  for(const [name,html] of Object.entries(variants)){
   const frame=await browser.newPage({viewport:{width,height:1000}});
   await frame.setContent(html);await frame.evaluate(()=>scrollTo(0,0));await frame.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const data=await frame.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,h1:document.querySelectorAll('h1').length,links:[...document.querySelectorAll('a')].map(a=>a.href),text:document.body.innerText}));
   const pass=!data.overflow&&data.h1===1&&data.links.every(u=>u.startsWith('https://radar.thally.io/')||u.startsWith('mailto:'));
   checks.push({name,width,pass,...data});if(!pass)throw Error(`Preview failed:${name}@${width}`);
   if(['welcome_analyzed','workspace_open','welcome_direct','founder_actual'].includes(name))await frame.screenshot({path:`${out}/${name}-${width}.png`});
   await frame.close();
  }
 }
 await page.setViewportSize({width:1240,height:800});const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('"','&quot;');
 await page.setContent(`<html><head><style>body{margin:0;background:#f5f5f2}main{display:grid;grid-template-columns:600px 600px;gap:20px;padding:10px}iframe{border:0;width:600px;height:770px}</style></head><body><main><iframe title="Welcome after website analysis" srcdoc="${escape(variants.welcome_analyzed)}"></iframe><iframe title="Workspace activation" srcdoc="${escape(variants.workspace_open)}"></iframe></main></body></html>`);
 await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(150);await page.screenshot({path:`${out}/welcome-workspace-desktop.png`});
 await page.setContent(`<html><head><style>body{margin:0;background:#f5f5f2}main{display:grid;grid-template-columns:600px 600px;gap:20px;padding:10px}iframe{border:0;width:600px;height:770px}</style></head><body><main><iframe title="Welcome after website analysis" srcdoc="${escape(variants.welcome_analyzed)}"></iframe><iframe title="Founder reason supplied by owner" srcdoc="${escape(variants.founder_actual)}"></iframe></main></body></html>`);
 await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(150);await page.screenshot({path:`${out}/welcome-founder-desktop.png`});
}finally{await browser.close();await writeFile(`${out}/results.json`,JSON.stringify({environment:'local HTML in isolated Google Chrome only; no account/server/provider',checks,founder:'Owner reason provided: building is easier; reaching beyond an existing network remains substantial work. Latest founder message reviewed against that source.'},null,2)+'\n');}
console.log(JSON.stringify({passed:checks.filter(x=>x.pass).length,total:checks.length}));
