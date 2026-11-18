import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
const settings = JSON.parse(await fs.readFile('.data/multiplatform-release-qa/local-env.json','utf8'));
const [command,...args]=process.argv.slice(2);if(!command)throw Error('Provide a command');
const child=spawn(command,args,{stdio:'inherit',env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,...settings}});child.on('exit',code=>process.exitCode=code??1);
