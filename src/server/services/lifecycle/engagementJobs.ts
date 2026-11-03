import { defineCron } from '@/server/jobs/cron';
import { collectWorkUpdates } from './engagement';
defineCron('lifecycle.work-updates', async now => { await collectWorkUpdates(now); });
