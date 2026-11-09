import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const settings=JSON.parse(await fs.readFile('.data/autopilot/local-env.json','utf8'));assert.equal(new URL(settings.DATABASE_URL).pathname,'/radar_autopilot_release_qa');const child=spawn(process.execPath,['node_modules/vitest/vitest.mjs','run',...process.argv.slice(2)],{stdio:'inherit',env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,...settings}});child.on('exit',code=>{process.exitCode=code??1});
