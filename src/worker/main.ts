import './env'; // must be first: loads .env / .env.local before anything reads process.env
// Radar worker: runs jobs and the minute scheduler. `npm run worker`
import '../server/jobs/all';
import { startWorker } from '../server/jobs/queue';
import { startScheduler } from '../server/jobs/cron';

async function main() {
  const w = await startWorker();
  const s = startScheduler();
  console.log('[worker] started');
  const stop = async () => { s.stop(); await w.stop(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
main().catch(e => { console.error(e); process.exit(1); });
