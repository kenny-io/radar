// Before the first real wipe of a deleted business (.factory/delete-business/architecture.md §11.4): prove that the
// storage Radar is configured with lets it list and delete, and that a kept file survives. The bucket credentials have
// only ever needed to upload; without list and delete permission every wipe fails closed and alerts each hour.
//
// It writes two small objects under a random id that belongs to no business, removes one while keeping the other, checks
// which is left, then removes the rest. It never touches a real business's files, and it needs no database.
// Usage, with the same environment as the worker (S3_BUCKET, S3_REGION, S3_ENDPOINT, S3_PUBLIC_URL, AWS credentials):
//   npx tsx scripts/check-storage-delete.ts
// Exit code 0 = storage can do what the wipe needs. Anything else: do not let a wipe run (RADAR_PURGE=off) until fixed.
import { randomUUID } from 'node:crypto';
import { env } from '../src/server/env';
import { deletePrefix, putObject } from '../src/server/services/storage';

async function main() {
  const id = randomUUID();
  const where = env.s3Bucket ? `bucket ${env.s3Bucket}` : `local folder ${env.storageDir}`;
  console.log(`Checking ${where} under the throwaway prefix ${id}/`);
  const keep = `${id}/check/keep.txt`, drop = `${id}/check/drop.txt`;
  try {
    await putObject(keep, Buffer.from('keep'), 'text/plain');
    await putObject(drop, Buffer.from('drop'), 'text/plain');
    const first = await deletePrefix(id, new Set([keep]));
    if (first.deleted !== 1 || first.kept !== 1) throw new Error(`Expected to delete 1 and keep 1, got deleted ${first.deleted}, kept ${first.kept}`);
    const second = await deletePrefix(id, new Set());
    if (second.deleted !== 1 || second.kept !== 0) throw new Error(`The kept object did not survive the first pass: deleted ${second.deleted}, kept ${second.kept}`);
    const third = await deletePrefix(id, new Set());
    if (third.deleted !== 0 || third.kept !== 0) throw new Error(`Objects are still listed after deleting them: deleted ${third.deleted}, kept ${third.kept}`);
    console.log('OK: list and delete work, and a kept object survives.');
    if (env.s3Bucket) console.log('Still to confirm by hand: whether the bucket keeps old versions (versioning), and what the CDN in front of it caches.');
  } catch (e) {
    // Leave nothing behind when the failure allows it.
    await deletePrefix(id, new Set()).catch(() => {});
    throw e;
  }
}
main().catch(e => { console.error('FAILED:', e?.message || e); process.exit(1); });
