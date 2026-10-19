console.log('start');
import { db, pool, schema } from '../src/server/db';
console.log('db imported');
db.select().from(schema.users).limit(1).then(r=>{console.log('users',r.length); return pool.end();}).catch(e=>console.error('E',e));
