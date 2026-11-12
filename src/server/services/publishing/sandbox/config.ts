// Rollout switch and validated configuration for the sandbox publisher (.factory/sandbox-publisher/architecture.md §9).
//   RADAR_PUBLISH_SANDBOX              unset, empty or `off` = off everywhere (the planner, unchanged). `all` = every business.
//                                      Otherwise a comma-separated list of business ids (case-insensitive). `off` anywhere wins.
//   RADAR_PUBLISH_SANDBOX_MODEL        catalogue id of an Anthropic model, default claude-opus-5.5.
//   RADAR_PUBLISH_SANDBOX_MAX_USD      per-run spend cap carried in the capability, default 6.
//   RADAR_PUBLISH_SANDBOX_MAX_CALLS    per-run model-call cap carried in the capability, default 200.
//   RADAR_PUBLISH_SANDBOX_TRANSCRIPT_DIR   development and QA only; ignored in production.
// These are read at call time, so a deploy-time change and tests both see the current value. The credentials and
// endpoints (DAYTONA_API_KEY, RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID, RADAR_PUBLISH_MODEL_PROXY_URL,
// RADAR_PUBLISH_CAPABILITY_SECRET) come from src/server/env.ts.
// Pure: this module reports nothing and contacts nothing. On `unconfigured` the caller reports the variable names and
// uses the planner; no value of any variable ever appears in the result's `missing` list.
import { aiFind } from '@/lib/constants';
import { env } from '@/server/env';
import {
  CAPABILITY_SECRET_MIN_LENGTH, MODEL_PROXY_BASE_PATH, SANDBOX_ATTEMPT_MS, SANDBOX_DEFAULT_MAX_CALLS, SANDBOX_DEFAULT_MAX_USD,
  SANDBOX_DEFAULT_MODEL, type SandboxPublisher, type SandboxPublisherConfig,
} from './types';
export type { SandboxPublisher, SandboxPublisherConfig, SandboxPublisherDisabled } from './types';

const read = (name: string) => (process.env[name] || '').trim();

/** A snapshot is referenced only by its immutable UUID, never by a name that can be repointed. */
const SNAPSHOT_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** https, no credentials, no query or hash, path ending in /model. Daytona restricts host names, not paths, so the host
 *  must be the proxy's own. */
function modelProxyUrl(value: string): URL | null {
  if (/[?#]/.test(value)) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname.endsWith(MODEL_PROXY_BASE_PATH) ? url : null;
}

/** The same resolution the AI client applies to a catalogue id (apiId in ai/index.ts, which is not exported): an
 *  AI_MODEL_MAP override, else the Anthropic API spelling of the version (claude-opus-5.5 is claude-opus-5-5). */
function anthropicApiId(catalogueId: string): string {
  let overrides: unknown = null;
  try { overrides = JSON.parse(process.env.AI_MODEL_MAP || '{}'); } catch { /* ignored, as the AI client does */ }
  const mapped = overrides && typeof overrides === 'object' ? (overrides as Record<string, unknown>)[catalogueId] : null;
  return typeof mapped === 'string' && mapped ? mapped : catalogueId.replace(/\.(\d+)$/, '-$1');
}

/** A plain positive decimal, or the default when unset. null when set to anything else. */
function positive(name: string, fallback: number, integer: boolean): number | null {
  const raw = read(name);
  if (!raw) return fallback;
  if (!(integer ? /^\d+$/ : /^\d+(?:\.\d+)?$/).test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Which engine publishes to GitHub for this business. Anything but a complete, valid configuration is `enabled: false`. */
export function sandboxPublisher(businessId: string): SandboxPublisher {
  const listed = read('RADAR_PUBLISH_SANDBOX').toLowerCase().split(',').map(word => word.trim()).filter(Boolean);
  if (!listed.length || listed.includes('off')) return { enabled: false, reason: 'off' };
  if (!listed.includes('all') && !listed.includes(businessId.toLowerCase())) return { enabled: false, reason: 'not-listed' };

  const missing: string[] = [];
  if (!env.daytonaKey.trim()) missing.push('DAYTONA_API_KEY');
  const snapshotId = env.publishSandboxSnapshotId.trim();
  if (!SNAPSHOT_UUID.test(snapshotId)) missing.push('RADAR_PUBLISH_SANDBOX_SNAPSHOT_ID');
  const proxyUrl = modelProxyUrl(env.publishModelProxyUrl.trim());
  if (!proxyUrl) missing.push('RADAR_PUBLISH_MODEL_PROXY_URL');
  // Used exactly as set, so the worker and the model proxy sign and verify with the same bytes.
  if (env.publishCapabilitySecret.length < CAPABILITY_SECRET_MIN_LENGTH) missing.push('RADAR_PUBLISH_CAPABILITY_SECRET');
  const catalogueId = read('RADAR_PUBLISH_SANDBOX_MODEL') || SANDBOX_DEFAULT_MODEL;
  if (aiFind(catalogueId)?.p !== 'Anthropic') missing.push('RADAR_PUBLISH_SANDBOX_MODEL');
  const maxUsd = positive('RADAR_PUBLISH_SANDBOX_MAX_USD', SANDBOX_DEFAULT_MAX_USD, false);
  if (maxUsd === null) missing.push('RADAR_PUBLISH_SANDBOX_MAX_USD');
  const maxCalls = positive('RADAR_PUBLISH_SANDBOX_MAX_CALLS', SANDBOX_DEFAULT_MAX_CALLS, true);
  if (maxCalls === null) missing.push('RADAR_PUBLISH_SANDBOX_MAX_CALLS');
  if (missing.length || !proxyUrl || maxUsd === null || maxCalls === null) return { enabled: false, reason: 'unconfigured', missing };

  const config: SandboxPublisherConfig = {
    enabled: true,
    daytonaKey: env.daytonaKey.trim(),
    snapshotId,
    proxyUrl,
    capabilitySecret: env.publishCapabilitySecret,
    model: { catalogueId, apiId: anthropicApiId(catalogueId) },
    maxUsd,
    maxCalls,
    attemptMs: SANDBOX_ATTEMPT_MS,
    transcriptDir: env.isProd ? null : read('RADAR_PUBLISH_SANDBOX_TRANSCRIPT_DIR') || null,
  };
  return config;
}
