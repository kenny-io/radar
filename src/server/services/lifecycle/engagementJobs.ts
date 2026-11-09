import { defineCron } from '@/server/jobs/cron';
import { collectWorkUpdates } from './engagement';
defineCron('lifecycle.work-updates', async now => { await collectWorkUpdates(now); });

import { collectEducation } from './education';
defineCron('lifecycle.weekly-education', async now => { await collectEducation(now); });
