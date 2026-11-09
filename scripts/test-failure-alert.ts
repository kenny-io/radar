// Explicit operational smoke test. No AI call or deliberate production failure.
import '../src/worker/env';
import { randomUUID } from 'node:crypto';
import { failureAlertsEnabled, sanitizeDiagnostic, type FailureEvent } from '../src/server/observability/failures';
import { persistAndDeliverAlert } from '../src/server/observability/delivery';
import { pool } from '../src/server/db';

async function main() {
  if (!failureAlertsEnabled()) throw new Error('Failure email is disabled. Enable RADAR_FAILURE_ALERTS for this runtime and turn development stubs off.');
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) throw new Error('Configure RESEND_API_KEY and a verified MAIL_FROM before running this test.');
  const id = randomUUID();
  const event: FailureEvent = {
    id, timestamp: new Date().toISOString(),
    environment: sanitizeDiagnostic(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'development'),
    service: sanitizeDiagnostic(process.env.RAILWAY_SERVICE_NAME || 'operational-smoke-test'),
    context: { source: 'system', operation: 'observability.smoke', ref: id }, rootOperation: 'observability.smoke',
    error: { name: 'SyntheticTest', message: 'TEST ONLY: Radar failure alert delivery verification. No customer action or AI provider failed.' },
    hint: 'Confirm this clearly marked test email arrived. No incident remediation is needed.',
  };
  await persistAndDeliverAlert(event, `radar-failure-smoke/${id}`);
  const { rows } = await pool.query("SELECT status,result FROM jobs WHERE kind='observability.alert' AND payload->'event'->>'id'=$1", [id]);
  if (rows[0]?.status !== 'done') throw new Error(`Test alert ${id} was not confirmed accepted. Inspect observability.alert jobs and delivery logs; it may be queued for retry.`);
  console.log(`Test alert ${id}: Resend accepted the email${rows[0]?.result?.providerMessageId ? ` (message ${rows[0].result.providerMessageId})` : ''}. Confirm inbox receipt separately.`);
}

main().catch(error => { console.error(sanitizeDiagnostic(error?.message || 'Failure alert smoke test failed')); process.exitCode = 1; }).finally(() => pool.end());
