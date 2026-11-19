// Reservations are conservative: unknown/failed dispatches retain the reserved ceiling until the day ends.
import { query, type Tx } from './db';
import { RadarError } from '@/server/errors';
import { limit } from './config';
export async function reserveBudget(tx:Tx,bid:string,units:{usd:number;characters?:number;narrations?:number}) {
 const day=new Date();day.setUTCHours(0,0,0,0);
 const checks:[string,number,number][]=[['global:usd',Math.ceil(units.usd*1e6),limit('RADAR_MEDIA_GLOBAL_USD_DAY',30)*1e6],[bid+':usd',Math.ceil(units.usd*1e6),limit('RADAR_MEDIA_BUSINESS_USD_DAY',3)*1e6]];
 if(units.characters)checks.push(['global:chars',units.characters,limit('RADAR_MEDIA_GLOBAL_CHARS_DAY',100000)],[bid+':chars',units.characters,limit('RADAR_MEDIA_BUSINESS_CHARS_DAY',20000)]);
 if(units.narrations)checks.push(['global:narrations',units.narrations,limit('RADAR_MEDIA_GLOBAL_NARRATIONS_DAY',30)],[bid+':narrations',units.narrations,limit('RADAR_MEDIA_BUSINESS_NARRATIONS_DAY',3)]);
 for(const [key,n,max]of checks.sort((a,b)=>a[0].localeCompare(b[0]))){
  const r=await query(tx,`INSERT INTO rate_limits(key,window_start,count) VALUES($1,$2,$3) ON CONFLICT(key,window_start) DO UPDATE SET count=rate_limits.count+EXCLUDED.count WHERE rate_limits.count+EXCLUDED.count<=$4 RETURNING count`,['media:'+key,day,n,max]);
  if(!r.rowCount||n>max)throw new RadarError('Today’s explainer generation allowance is used. Try again tomorrow.',429,'media_budget');
 }
}
