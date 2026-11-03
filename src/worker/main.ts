import './env'; // must be first: loads .env / .env.local before anything reads process.env
// Radar worker: runs jobs and the minute scheduler. `npm run worker`
import '../server/jobs/all';
import { startWorker } from '../server/jobs/queue';
import { startScheduler } from '../server/jobs/cron';
import { startLifecycleDispatcher } from '../server/services/lifecycle/worker';
import { waitForWorkerSchema } from '../server/db/workerReady';

async function main() {
  await waitForWorkerSchema();
  const w = await startWorker();
  const s = startScheduler();
  const mail = startLifecycleDispatcher();
  console.log('[worker] started');
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; s.stop(); await Promise.all([mail.stop(), w.stop()]); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
main().catch(e => { console.error(e); process.exit(1); });
