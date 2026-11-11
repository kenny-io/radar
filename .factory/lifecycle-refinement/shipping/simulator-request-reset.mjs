import {readFileSync,writeFileSync} from 'node:fs';
const file=new URL('../../../.data/email-release-simulator.json',import.meta.url),fixture=JSON.parse(readFileSync(file,'utf8'));
if(fixture.origin!=='https://radar.thally.io'||!/^delivered\+radar-email-release-[a-f0-9-]+@resend\.dev$/.test(fixture.email)||fixture.email.split('@')[0].length>64)throw new Error('Valid production simulator fixture required');
if(fixture.resetRequestedAt)throw new Error('Reset already requested; do not replay');
fixture.resetRequestedAt=new Date().toISOString();writeFileSync(file,JSON.stringify(fixture),{mode:0o600});
const r=await fetch(fixture.origin+'/api/auth/forgot-password',{method:'POST',headers:{'Content-Type':'application/json','Origin':fixture.origin},body:JSON.stringify({email:fixture.email})});
const body=await r.json();console.log(JSON.stringify({simulator:true,requestedAt:fixture.resetRequestedAt,status:r.status,ok:body.ok===true,genericResponse:typeof body.message==='string'&&body.message.includes('If a password account exists')}));
if(!r.ok)process.exitCode=1;
