import fs from'node:fs';import {spawn}from'node:child_process';
const mode=process.argv[2]||'rate';if(!['rate','widget','missing-widget'].includes(mode))throw new Error('Unknown local QA mode');
const saved=JSON.parse(fs.readFileSync('.data/signup-security/local-env.json','utf8'));
const port=mode==='rate'?'3810':'3811';const flag=mode==='rate'?'0':'1';
const env={...process.env,...saved,NODE_ENV:'development',APP_URL:'http://localhost:'+port,RADAR_SIGNUP_TURNSTILE:flag,RADAR_DEV_STUBS:mode==='rate'?'1':'0',TURNSTILE_SITE_KEY:mode==='widget'?'qa-client-widget-key':'',TURNSTILE_SECRET_KEY:mode==='widget'?'qa-never-send-secret':'',RESEND_API_KEY:mode==='rate'?'':'qa-never-send-mail-key',NEXT_DIST_DIR:mode==='rate'?'.next-signup-qa':'.next-signup-widget-qa'};
const child=spawn('./node_modules/.bin/next',['dev','-p',port],{env,stdio:'inherit'});child.on('exit',code=>process.exit(code??1));
