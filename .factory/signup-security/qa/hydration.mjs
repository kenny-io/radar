import{chromium}from'playwright';import fs from'node:fs/promises';import assert from'node:assert/strict';
const base='http://localhost:3810',results=[];const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 for(const path of['/signup','/signin']){
  const c=await b.newContext({viewport:{width:1440,height:900}}),p=await c.newPage();let release;const gate=new Promise(r=>release=r);let blocked=0,posts=0;
  await p.route('**/_next/static/**/*.js',async r=>{blocked++;await gate;await r.continue();});p.on('request',r=>{if(r.method()==='POST')posts++;});
  try{
   await p.goto(base+path,{waitUntil:'commit'});const label=path==='/signup'?'Create account':'Sign in',submit=p.getByRole('button',{name:label,exact:true});await submit.waitFor();assert(await submit.isDisabled());for(const input of await p.locator('input').all())assert(await input.isDisabled());assert(await p.getByRole('button',{name:'Continue with Google',exact:true}).isDisabled());
   release();await p.waitForFunction(label=>[...document.querySelectorAll('button')].some(x=>x.textContent===label&&!x.disabled),label);await p.unroute('**/_next/static/**/*.js');
   const first=p.getByRole('textbox',{name:path==='/signup'?'Name':'Work email',exact:true});await first.focus();await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement?.getAttribute('aria-label')),path==='/signup'?'Work email':'Password');await submit.click();await p.getByText('Enter a valid email',{exact:true}).waitFor();assert.equal(posts,0);results.push({path,pass:true,blockedScripts:blocked,disabledBeforeHydration:true,keyboardOrder:true,invalidInputsNoPost:true});
  }finally{release();await c.close();}
 }
}finally{await b.close();await fs.writeFile('.data/signup-security/qa/hydration-results.json',JSON.stringify({base,results},null,2));console.log(JSON.stringify(results));}
