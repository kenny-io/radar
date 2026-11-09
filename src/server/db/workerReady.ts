import { setTimeout as pause } from 'node:timers/promises';
import { pool } from './index';

interface ReadyOptions {
  probe?: () => Promise<unknown>;
  now?: () => number;
  pause?: (ms: number, signal?: AbortSignal) => Promise<void>;
  timeoutMs?: number;
  signal?: AbortSignal;
  log?: (message: string) => void;
}

/** Web predeploy owns migrations. A faster worker rollout must not claim jobs against an older schema. */
export async function waitForWorkerSchema(options: ReadyOptions = {}): Promise<void> {
  const query = { text: `SELECT
    p.onboarding, p.education, p.daily_brief, p.calendar_reminders, p.article_social,
    p.daily_brief_since, p.calendar_reminders_since, p.article_social_since,
    e.id, e.source_ref, e.resolved_at, e.resolved_reason, e.lifecycle_email_id,
    m.payload_enc, m.claim_token, ed.next_lesson, ed.pending_email_id, u.email_verified_at, g.guide_id, g.first_observed_at, g.pending_email_id, g.source_business_id, b.autopilot, c.autopilot_activation_id, sp.autopilot_activation_id, o.sender_meta
    FROM user_email_preferences p CROSS JOIN engagement_events e CROSS JOIN lifecycle_emails m CROSS JOIN education_enrollments ed CROSS JOIN users u CROSS JOIN lifecycle_guide_states g CROSS JOIN businesses b CROSS JOIN calendar_entries c CROSS JOIN social_pubs sp CROSS JOIN outbox_emails o LIMIT 0`, query_timeout: 5000 };
  const probe = options.probe || (() => pool.query(query));
  const now = options.now || Date.now;
  const sleep = options.pause || (async (ms, signal) => { await pause(ms, undefined, { signal }); });
  const deadline = now() + (options.timeoutMs ?? 120_000);
  let announced = false;
  for (;;) {
    if (options.signal?.aborted) throw new Error('Worker startup stopped');
    try { await probe(); return; }
    catch {
      if (!announced) {
        (options.log || console.error)('[worker] waiting for database migrations before processing jobs');
        announced = true;
      }
    }
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error('Worker database schema is not ready; restart after web migrations complete');
    await sleep(Math.min(2000, remaining), options.signal);
  }
}
