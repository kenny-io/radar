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
    m.payload_enc, m.claim_token, ed.next_lesson, ed.pending_email_id, u.email_verified_at, g.guide_id, g.first_observed_at, g.pending_email_id, g.source_business_id, b.autopilot, c.autopilot_activation_id, sp.autopilot_activation_id, o.sender_meta, obs.series, obs.measured_at, vp.weekly_email, mt.entry_id,
    b.last_active_at, bd.acted_at, mb.activity_seen_at, ba.past_due_at
    FROM user_email_preferences p CROSS JOIN engagement_events e CROSS JOIN lifecycle_emails m CROSS JOIN education_enrollments ed CROSS JOIN users u CROSS JOIN lifecycle_guide_states g CROSS JOIN businesses b CROSS JOIN calendar_entries c CROSS JOIN social_pubs sp CROSS JOIN outbox_emails o CROSS JOIN ai_observations obs CROSS JOIN visibility_preferences vp CROSS JOIN ai_miss_topics mt CROSS JOIN brief_days bd CROSS JOIN members mb CROSS JOIN billing_accounts ba LIMIT 0`, query_timeout: 5000 };
  const probe = options.probe || (async () => {
    await pool.query(query);
    await pool.query("SELECT 'ai_observations_series_day'::regclass, 'ai_observations_business_day'::regclass, 'lifecycle_report_business_sent_idx'::regclass");
    // Guide IDs are a checked allowlist: identical columns from0015 alone cannot admit the new guide safely.
    const constraintQuery = { text: `SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid = 'lifecycle_guide_states'::regclass
      AND conname = 'lifecycle_guide_id_check' AND contype = 'c' AND convalidated`, query_timeout: 5000 };
    const constraint = await pool.query<{ definition: string }>(constraintQuery);
    const definition = constraint.rows[0]?.definition || '';
    if (!['article_workflow', 'search_refresh', 'autopilot_intro'].every(id => definition.includes(`'${id}'`)))
      throw new Error('Worker guide allowlist is not migrated');
  });
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
