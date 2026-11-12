// The per-run model capability (.factory/sandbox-publisher/architecture.md §4): the only credential a publishing sandbox
// holds. It lets one run call the model proxy with one model, inside one spend and call budget, until one expiry.
//   rdrcap1.<base64url(JSON claims)>.<base64url(HMAC-SHA256(secret, 'rdrcap1.' + <the claims segment>))>
// The worker mints it and the model proxy verifies it with the same RADAR_PUBLISH_CAPABILITY_SECRET, used exactly as set.
// Pure: node:crypto only, no environment, database or logging. Nothing here may put a token or the secret in an error.
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  CAPABILITY_AUDIENCE, CAPABILITY_MAX_LENGTH, CAPABILITY_MAX_TTL_SEC, CAPABILITY_PREFIX, CAPABILITY_SECRET_MIN_LENGTH,
  type MintPublishCapability, type PublishCapabilityClaims, type VerifyPublishCapability,
} from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
/** A provider API id such as claude-opus-5-5: no spaces, no path, no header-breaking characters. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
/** Serialisation order; also the complete key set a verified capability may carry. */
const CLAIM_KEYS = ['v', 'aud', 'runId', 'bid', 'entryId', 'model', 'maxUsd', 'maxCalls', 'iat', 'exp'] as const;
const MAX_ID_LENGTH = 200;

const label = (value: unknown): value is string => typeof value === 'string' && value.length >= 1 && value.length <= MAX_ID_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);
const epochSeconds = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** Exactly the claim set, every field well formed. Time is not judged here. */
function isClaims(value: unknown): value is PublishCapabilityClaims {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  return keys.length === CLAIM_KEYS.length && CLAIM_KEYS.every(key => Object.prototype.hasOwnProperty.call(row, key))
    && row.v === 1
    && row.aud === CAPABILITY_AUDIENCE
    && typeof row.runId === 'string' && UUID.test(row.runId)
    && label(row.bid)
    && label(row.entryId)
    && typeof row.model === 'string' && MODEL_ID.test(row.model)
    && typeof row.maxUsd === 'number' && Number.isFinite(row.maxUsd) && row.maxUsd > 0
    && typeof row.maxCalls === 'number' && Number.isSafeInteger(row.maxCalls) && row.maxCalls >= 1
    && epochSeconds(row.iat) && epochSeconds(row.exp) && row.exp > row.iat;
}

const usableSecret = (secret: unknown): secret is string => typeof secret === 'string' && secret.length >= CAPABILITY_SECRET_MIN_LENGTH;
const sign = (signed: string, secret: string): Buffer => createHmac('sha256', secret).update(signed, 'utf8').digest();

/** Mint the capability for one run. `now` is epoch milliseconds; `exp` is epoch seconds (the attempt deadline plus its
 *  grace). Throws on a short secret, a malformed claim or an expiry that is not between now and the TTL cap, so a
 *  misconfigured worker fails before a sandbox exists rather than at the run's first model call. Messages name the
 *  problem only, never a value. */
export const mintPublishCapability: MintPublishCapability = (input, secret, now = Date.now()) => {
  if (!usableSecret(secret)) throw new Error('publish capability: signing secret is missing or too short');
  const iat = Math.floor(now / 1000);
  const claims = { v: 1, aud: CAPABILITY_AUDIENCE, runId: input.runId, bid: input.bid, entryId: input.entryId, model: input.model, maxUsd: input.maxUsd, maxCalls: input.maxCalls, iat, exp: input.exp };
  if (!isClaims(claims)) throw new Error('publish capability: claims are invalid');
  if (claims.exp - iat > CAPABILITY_MAX_TTL_SEC) throw new Error('publish capability: expiry is beyond the allowed lifetime');
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const token = `${CAPABILITY_PREFIX}.${payload}.${sign(`${CAPABILITY_PREFIX}.${payload}`, secret).toString('base64url')}`;
  if (token.length > CAPABILITY_MAX_LENGTH) throw new Error('publish capability: token is too long');
  return token;
};

/** The claims of an authentic, current capability, or null. Null covers every refusal alike (malformed, wrong prefix,
 *  bad signature, altered claims, another audience, expired, expiry beyond the TTL cap, over-long token, short secret),
 *  so a caller cannot learn which check failed. The signature is compared in constant time before the claims are read. */
export const verifyPublishCapability: VerifyPublishCapability = (token, secret, now = Date.now()) => {
  if (!usableSecret(secret) || typeof token !== 'string' || token.length > CAPABILITY_MAX_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [prefix, payload, supplied] = parts;
  if (prefix !== CAPABILITY_PREFIX || !BASE64URL.test(payload) || !BASE64URL.test(supplied)) return null;
  const expected = sign(`${prefix}.${payload}`, secret);
  const given = Buffer.from(supplied, 'base64url');
  // The length test leaks nothing: an HMAC-SHA256 digest is always 32 bytes. The re-encoding test refuses a second
  // spelling of the same signature bytes.
  if (given.byteLength !== expected.byteLength || !timingSafeEqual(given, expected) || given.toString('base64url') !== supplied) return null;
  let claims: unknown;
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!isClaims(claims)) return null;
  const nowSec = Math.floor(now / 1000);
  if (claims.exp <= nowSec || claims.exp > nowSec + CAPABILITY_MAX_TTL_SEC) return null;
  // A fresh object in the documented shape: nothing else from the token survives verification.
  return { v: 1, aud: CAPABILITY_AUDIENCE, runId: claims.runId, bid: claims.bid, entryId: claims.entryId, model: claims.model, maxUsd: claims.maxUsd, maxCalls: claims.maxCalls, iat: claims.iat, exp: claims.exp };
};
