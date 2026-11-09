import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const target='.factory/autopilot/release-qa/fingerprint.json';
const checking=process.argv.includes('--check');
const previous=checking?JSON.parse(await fs.readFile(target,'utf8')):null;
const command=args=>execFileSync('git',args,{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const paths=checking?Object.keys(previous.files):[...new Set([...command(['diff','--name-only','HEAD','--','src','drizzle']),...command(['ls-files','--others','--exclude-standard','--','src','drizzle'])])];
const files={};for(const path of paths.sort())files[path]=crypto.createHash('sha256').update(await fs.readFile(path)).digest('hex');
const fingerprint=crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex');
if(checking){const changed=Object.keys(files).filter(path=>files[path]!==previous.files[path]);console.log(JSON.stringify({fingerprint,unchanged:changed.length===0,changed}));process.exitCode=changed.length?1:0}else{await fs.writeFile(target,JSON.stringify({at:new Date().toISOString(),head:command(['rev-parse','HEAD'])[0],fingerprint,files},null,2));console.log(fingerprint)}
