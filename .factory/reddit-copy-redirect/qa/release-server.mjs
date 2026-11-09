import { spawn } from 'node:child_process';
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NODE_ENV:'development',DATABASE_URL:'postgres://postgres:radar@localhost:54329/radar_daily_social_release_qa',RADAR_DEV_STUBS:'1',RADAR_SOCIAL_PUBLISHING:'all',RADAR_BILLING:'off',RADAR_SECRET_KEY:'daily-social-qa-local-only',APP_URL:'http://localhost:3133',NEXT_DIST_DIR:'.next-reddit-copy-release-qa',NEXT_TELEMETRY_DISABLED:'1'};
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-p','3133'],{stdio:'inherit',env});
child.on('exit',code=>{process.exitCode=code??1});process.on('SIGTERM',()=>child.kill('SIGTERM'));
