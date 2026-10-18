import { crawlSite } from '../src/server/services/analysis/crawl';
const t=Date.now();
crawlSite(process.argv[2]||'fieldnote.app', n=>console.log('pages',n, Date.now()-t)).then(r=>{console.log(r.pages.length, r.pages.filter(p=>p.kind==='article').length); process.exit(0)}).catch(e=>{console.error('ERR',e);process.exit(1)});
