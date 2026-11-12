/**
 * Build and register the Daytona snapshot every sandbox publishing attempt starts from, then print its immutable UUID.
 *
 *   DAYTONA_API_KEY=... node scripts/operations/build-publisher-snapshot.mjs
 *   node scripts/operations/build-publisher-snapshot.mjs --dry-run      (no key, no network: prints the plan)
 *
 * The image is sandbox/publisher/Dockerfile: the pinned Claude Agent SDK and node-tar under an unprivileged user.
 * It contains no credential and no Radar code; the runner scripts are uploaded per run. Rebuild only when the
 * Dockerfile, package.json or package-lock.json in sandbox/publisher changes.
 *
 * The snapshot name is `radar-publisher-<12 hex>`, a digest of exactly those three files, so the same inputs always
 * name the same snapshot; RADAR_PUBLISH_SNAPSHOT_NAME overrides it. A snapshot that already exists under the name
 * and is active is reused, not rebuilt. Radar refers to a snapshot only by UUID: set the printed value as
 * RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID on the worker.
 *
 * Credentials: DAYTONA_API_KEY is read from the process environment only. The Daytona CLI's stored login is never
 * read, the API URL is pinned so an ambient variable cannot redirect the key, and the SDK is constructed in an empty
 * working directory because it would otherwise also read DAYTONA_* values from .env and .env.local there.
 *
 * Output: build logs and progress on stderr; on success the snapshot UUID alone on stdout. Exit code 0 on success.
 */

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DAYTONA_API_URL = 'https://app.daytona.io/api';
const SNAPSHOT_RESOURCES = Object.freeze({ cpu: 2, memory: 4, disk: 8 });
const SNAPSHOT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const SNAPSHOT_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/u;
/** Everything the image may copy from this repository. Anything else in the build context fails the build. */
const IMAGE_INPUTS = Object.freeze(['Dockerfile', 'package.json', 'package-lock.json']);

const publisherDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'sandbox', 'publisher');
const dockerfile = join(publisherDirectory, 'Dockerfile');
const log = (text) => process.stderr.write(`${text}\n`);

/** `radar-publisher-<digest of the image inputs>`, or the validated override. */
async function resolveSnapshotName() {
  const override = process.env.RADAR_PUBLISH_SNAPSHOT_NAME?.trim();
  if (override) {
    if (!SNAPSHOT_NAME.test(override)) throw new Error('RADAR_PUBLISH_SNAPSHOT_NAME is not a valid snapshot name.');
    return override;
  }
  const digest = createHash('sha256');
  for (const name of IMAGE_INPUTS) {
    digest.update(`${name}\0`);
    digest.update(await readFile(join(publisherDirectory, name)));
    digest.update('\0');
  }
  return `radar-publisher-${digest.digest('hex').slice(0, 12)}`;
}

/** Fail before anything is uploaded if the Dockerfile would send more than the manifest and the lockfile. */
function requireMinimalContext(image) {
  const allowed = new Set(IMAGE_INPUTS.filter((name) => name !== 'Dockerfile').map((name) => join(publisherDirectory, name)));
  const sources = image.contextList.map((context) => resolve(context.sourcePath));
  const unexpected = sources.filter((source) => !allowed.has(source));
  if (unexpected.length > 0 || sources.length !== allowed.size) {
    throw new Error('The publisher image may copy only package.json and package-lock.json from sandbox/publisher.');
  }
  return sources;
}

/**
 * Replace SDK errors with a stable message. Provider failures can carry request, account or credential-adjacent
 * data, and this script's output is pasted into tickets and CI logs.
 */
function providerStatus(error) {
  const source = Object(error);
  // DaytonaError carries statusCode; a raw HTTP client error carries response.status.
  const status = source.statusCode ?? Object(source.response).status;
  return Number.isInteger(status) ? status : null;
}

function safeProviderError(operation, error) {
  const status = providerStatus(error);
  if (operation === 'create' && status === 403) {
    return new Error('Snapshot creation was denied. Grant this Daytona API key snapshot write access, then run again.');
  }
  return new Error(`Daytona snapshot ${operation} failed${status === null ? '' : ` (HTTP ${status})`}.`);
}

/** The identity fields of a provider snapshot, or an error when it is not the active snapshot that was asked for. */
function requireActiveSnapshot(candidate, expectedName) {
  const snapshot = Object(candidate);
  if (
    typeof snapshot.id !== 'string' ||
    !SNAPSHOT_ID.test(snapshot.id) ||
    snapshot.name !== expectedName ||
    snapshot.state !== 'active'
  ) {
    throw new Error('The Daytona snapshot identity is invalid or the snapshot is not active.');
  }
  return { id: snapshot.id, name: expectedName };
}

async function main() {
  const isDryRun = process.argv.slice(2).includes('--dry-run');
  const unknown = process.argv.slice(2).filter((argument) => argument !== '--dry-run');
  if (unknown.length > 0) throw new Error('Usage: node scripts/operations/build-publisher-snapshot.mjs [--dry-run]');

  const name = await resolveSnapshotName();
  if (!SNAPSHOT_NAME.test(name)) throw new Error('The snapshot name is invalid.');
  const { Daytona, Image } = await import('@daytona/sdk');
  const image = Image.fromDockerfile(dockerfile);
  const context = requireMinimalContext(image);

  if (isDryRun) {
    log(`Snapshot name: ${name}`);
    log(`Dockerfile: ${dockerfile}`);
    log(`Build context: ${context.map((source) => source.slice(publisherDirectory.length + 1)).join(', ')}`);
    log(`Resources: ${JSON.stringify(SNAPSHOT_RESOURCES)}`);
    log('Dry run: nothing was uploaded and Daytona was not contacted.');
    return;
  }

  const apiKey = process.env.DAYTONA_API_KEY?.trim();
  if (!apiKey) throw new Error('DAYTONA_API_KEY is not set. Export the key for the Daytona organization Radar uses.');

  // The SDK's own environment reader also parses .env and .env.local in the working directory. An empty directory
  // leaves it nothing to find, so the key and endpoint below are the only ones in play.
  const isolatedDirectory = await mkdtemp(join(tmpdir(), 'radar-publisher-snapshot-'));
  process.chdir(isolatedDirectory);
  const daytona = new Daytona({ apiKey, apiUrl: DAYTONA_API_URL });
  let primaryError = null;
  try {
    let existing = null;
    try {
      existing = await daytona.snapshot.get(name);
    } catch (error) {
      if (providerStatus(error) !== 404) throw safeProviderError('lookup', error);
    }

    let created;
    if (existing) {
      created = requireActiveSnapshot(existing, name);
      log(`Snapshot ${name} already exists and is active; reusing it.`);
    } else {
      log(`Building snapshot ${name} from ${dockerfile}`);
      let built;
      try {
        built = await daytona.snapshot.create(
          { name, image, resources: { ...SNAPSHOT_RESOURCES } },
          { timeout: 0, onLogs: (chunk) => log(chunk) },
        );
      } catch (error) {
        throw safeProviderError('create', error);
      }
      created = requireActiveSnapshot(built, name);
    }

    // Re-read by UUID so the printed identity never rests only on the build response or on name resolution.
    let observed;
    try {
      observed = requireActiveSnapshot(await daytona.snapshot.get(created.id), name);
    } catch (error) {
      throw error instanceof Error && error.message.startsWith('The Daytona snapshot identity')
        ? error
        : safeProviderError('read', error);
    }
    if (observed.id !== created.id) throw new Error('The Daytona snapshot identity changed on re-read.');

    log(`Snapshot active: ${observed.name}`);
    log(`Set RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID=${observed.id} on the worker.`);
    process.stdout.write(`${observed.id}\n`);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    let cleanupError = null;
    try {
      await daytona[Symbol.asyncDispose]();
    } catch {
      cleanupError = new Error('Daytona client cleanup failed.');
    }
    await rm(isolatedDirectory, { recursive: true, force: true }).catch(() => {});
    // Cleanup must not replace the primary error; on success a cleanup failure still fails the command.
    if (!primaryError && cleanupError) throw cleanupError;
  }
}

try {
  await main();
} catch (error) {
  // Provider responses were replaced with fixed strings above; what remains is this script's own messages and
  // local validation errors.
  process.stderr.write(`${error instanceof Error ? error.message : 'Snapshot build failed.'}\n`);
  process.exitCode = 1;
}
