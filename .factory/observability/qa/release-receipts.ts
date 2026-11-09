import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

if (!process.env.DATABASE_URL?.includes('radar_observability_release_qa')) throw new Error('Use the isolated release QA database only');
process.env.RADAR_FAILURE_ALERTS = 'on';
process.env.RADAR_DEV_STUBS = '0';
process.env.RESEND_API_KEY = 'qa-never-real-key';
process.env.MAIL_FROM = 'Radar QA <qa@example.com>';
process.env.RADAR_BILLING = 'off';
const calls: { key: string; body: string }[] = [];
let status = 200;
let receipt = 'qa-immediate-receipt';
globalThis.fetch = async (_input, init) => {
  calls.push({ key: String((init?.headers as Record<string,string>)['Idempotency-Key']), body: String(init?.body) });
  return Response.json(status === 200 ? { id: receipt } : { error: 'DO NOT PERSIST RAW PROVIDER BODY' }, { status });
};
const { pool } = await import('../../../src/server/db');
const { persistAndDeliverAlert } = await import('../../../src/server/observability/delivery');
const { runJobNow } = await import('../../../src/server/jobs/queue');
await import('../../../src/server/observability/jobs');
const makeEvent = () => ({ id: randomUUID(), timestamp: new Date().toISOString(), environment: 'qa', service: 'worker', rootOperation: 'qa.release.receipt', context: { source: 'system' as const, operation: 'qa.release.receipt' }, error: { name: 'Error', message: 'Marked isolated QA transport probe' }, hint: 'No production action' });
const ids: string[] = [];
try {
  const immediate = makeEvent();
  await persistAndDeliverAlert(immediate, 'qa-release/' + immediate.id);
  const first = await pool.query("SELECT id,status,result FROM jobs WHERE kind='observability.alert' AND payload->'event'->>'id'=$1", [immediate.id]);
  ids.push(first.rows[0].id);
  assert.equal(first.rows[0].status, 'done');
  assert.equal(first.rows[0].result.providerMessageId, receipt);
  const queued = makeEvent(); status = 503;
  await persistAndDeliverAlert(queued, 'qa-release/' + queued.id);
  const second = await pool.query("SELECT id,status,error,payload FROM jobs WHERE kind='observability.alert' AND payload->'event'->>'id'=$1", [queued.id]);
  ids.push(second.rows[0].id);
  assert.equal(second.rows[0].status, 'queued');
  assert(!second.rows[0].error.includes('DO NOT PERSIST'));
  status = 200; receipt = 'qa-queued-receipt';
  await pool.query("UPDATE jobs SET attempts=1,status='running' WHERE id=$1", [second.rows[0].id]);
  await runJobNow(second.rows[0].id);
  const final = await pool.query('SELECT status,result FROM jobs WHERE id=$1', [second.rows[0].id]);
  assert.equal(final.rows[0].status, 'done');
  assert.equal(final.rows[0].result.providerMessageId, receipt);
  assert.deepEqual(calls[1], calls[2]);
  console.log('PASS: immediate receipt persisted; queued receipt persisted after recovery; immutable payload/key and safe transport error preserved. No external requests.');
} finally {
  if (ids.length) await pool.query('DELETE FROM jobs WHERE id=ANY($1::uuid[])', [ids]);
  await pool.end();
}
