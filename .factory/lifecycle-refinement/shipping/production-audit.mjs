import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const code=readFileSync(new URL('./production-audit-query.cjs',import.meta.url),'utf8');
const quote=s=>"'"+s.replaceAll("'", "'\\''")+"'";
const output=execFileSync('railway',['ssh','--service','web','--environment','production','--','node -e '+quote(code)],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
process.stdout.write(output);
