import { eq } from 'drizzle-orm';
import { db,schema } from '@/server/db';
import { env } from '@/server/env';
import { RadarError } from '@/server/errors';
export async function mediaEnabled(bid:string):Promise<boolean>{
 const values=(process.env.RADAR_SOCIAL_MEDIA_GENERATION||'').toLowerCase().split(',').map(v=>v.trim()).filter(Boolean);
 if(env.devStubs)return true; if(!values.length||values.includes('off'))return false; if(values.includes('all')||values.includes(bid.toLowerCase()))return true;
 if(!values.some(v=>v.includes('@')))return false;
 const [b]=await db.select({email:schema.users.email}).from(schema.businesses).innerJoin(schema.users,eq(schema.users.id,schema.businesses.ownerId)).where(eq(schema.businesses.id,bid));
 return !!b&&values.includes(b.email.toLowerCase());
}
export async function requireMedia(bid:string){if(!await mediaEnabled(bid))throw new RadarError('Explainer generation is not enabled for this workspace yet.',404,'media_disabled');}
export const limit=(name:string,def:number)=>{const n=Number(process.env[name]||def);return Number.isFinite(n)&&n>0?n:def;};
export const speechRate=()=>limit('ELEVENLABS_USD_PER_1000_CHARS',0.08);
