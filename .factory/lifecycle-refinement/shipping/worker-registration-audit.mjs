// Read-only source/config admission audit. Imports definitions only; does not start/tick a scheduler or dispatcher.
import {execFileSync} from 'node:child_process';
const code=`await import('./src/server/jobs/all.ts');
const expected=['lifecycle.work-updates','lifecycle.weekly-education','lifecycle.guides','visibility.weeklyDigest','visibility.nightly'];
const names=(globalThis.__radarCron||[]).map(h=>h.name);
console.log(JSON.stringify({commit:process.env.RAILWAY_GIT_COMMIT_SHA,education:process.env.RADAR_EDUCATION_EMAILS,stubs:process.env.RADAR_DEV_STUBS,appUrl:process.env.APP_URL,hasSender:!!process.env.MAIL_FROM,hasResend:!!process.env.RESEND_API_KEY,hasSecret:!!process.env.RADAR_SECRET_KEY,expectedCrons:expected,allExpectedRegistered:expected.every(n=>names.includes(n))}));process.exit(0);`;
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const output=execFileSync('railway',['ssh','--service','worker','--environment','production','--','node --import tsx --input-type=module -e '+quote(code)],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
process.stdout.write(output);
