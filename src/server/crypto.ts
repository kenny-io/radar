import crypto from 'node:crypto';
import { env } from './env';

function key(): Buffer {
  const k = env.secretKey;
  if (!k) {
    if (env.isProd) throw new Error('RADAR_SECRET_KEY is required in production');
    return crypto.createHash('sha256').update('radar-dev-only-key').digest();
  }
  return crypto.createHash('sha256').update(k).digest();
}
/** AES-256-GCM. Used for OAuth tokens and CMS credentials at rest. */
export function encrypt(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}
export function decrypt<T = any>(blob: string | null | undefined): T | null {
  if (!blob) return null;
  const [v, iv, tag, data] = blob.split('.');
  if (v !== 'v1') return null;
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8'));
}
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const hmacSha256 = (secret: string, body: string) => crypto.createHmac('sha256', secret).update(body).digest('hex');
export const shortId = (prefix = '') => prefix + crypto.randomBytes(6).toString('base64url');
