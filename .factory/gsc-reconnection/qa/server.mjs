import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
const {environment}=JSON.parse(await fs.readFile('.factory/gsc-reconnection/qa/fixture.json','utf8'));
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-p','3846'],{env:environment,stdio:'inherit'});
child.on('exit',code=>{process.exitCode=code??1});process.on('SIGTERM',()=>child.kill('SIGTERM'));
