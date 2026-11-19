import { sql } from 'drizzle-orm';
import { pool } from '@/server/db';
export type Tx = { query?:any; execute?:any };
/** Parameterized bridge for the existing pack Drizzle transaction and independent PG stage transactions. */
export async function query<T=any>(tx:Tx,text:string,values:any[]=[]):Promise<{rows:T[];rowCount:number|null}>{
 values=values.map(v=>Array.isArray(v)?JSON.stringify(v):v);
 if(typeof tx.query==='function')return tx.query(text,values);
 const parts:any[]=[];let at=0;for(const m of text.matchAll(/\$(\d+)/g)){parts.push(sql.raw(text.slice(at,m.index)),sql`${values[Number(m[1])-1]}`);at=m.index!+m[0].length;}parts.push(sql.raw(text.slice(at)));
 return tx.execute!(sql.join(parts,sql.raw('')));
}
export async function transaction<T>(fn:(tx:Tx)=>Promise<T>):Promise<T>{const tx=await pool.connect();try{await tx.query('BEGIN');const value=await fn(tx);await tx.query('COMMIT');return value;}catch(e){await tx.query('ROLLBACK');throw e;}finally{tx.release();}}
