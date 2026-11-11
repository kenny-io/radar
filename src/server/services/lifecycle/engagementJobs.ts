import { defineCron } from '@/server/jobs/cron';
import { collectWorkUpdates } from './engagement';
defineCron('lifecycle.work-updates', async now => { await collectWorkUpdates(now); });

import { collectEducation } from './education';
defineCron('lifecycle.weekly-education', async now => { await collectEducation(now); });

import { collectGuides } from './guides';
defineCron('lifecycle.guides', async now => { await collectGuides(now); });

import { collectAiReports } from '../visibility/digest';
defineCron('visibility.weeklyDigest', async now => { const result = await collectAiReports(now); if (result.queued || result.failed) console.info('[visibility.weeklyDigest]',result); });
