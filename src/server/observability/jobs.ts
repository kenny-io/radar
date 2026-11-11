import { defineJob } from '../jobs/queue';
import { ALERT_JOB_KIND, deliverAlert, type AlertEnvelope } from './delivery';

defineJob<AlertEnvelope>({
  kind: ALERT_JOB_KIND, maxAttempts: 100,
  backoffMs: attempt => Math.min(15 * 60_000, 30_000 * Math.pow(2, Math.min(attempt, 5))),
  run: async ({ payload }) => ({ accepted: true, ...await deliverAlert(payload) }),
});
