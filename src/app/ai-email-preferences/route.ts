import { assertAuthOrigin } from '@/server/auth/requests';
import { RadarError } from '@/server/errors';
import { disableDigestEmail, readDigestPreferencesToken } from '@/server/services/visibility/digestPreferences';

export const runtime = 'nodejs';
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const page = (content: string, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Email preferences · Radar</title></head><body style="font-family:system-ui;max-width:36rem;margin:3rem auto;padding:1rem;line-height:1.6"><main><h1>Email preferences</h1>${content}</main></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" } });
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get('saved') === '1') return page('<p>Weekly AI recommendation reports are turned off for this business. Your other email and research study preferences are unchanged.</p>');
  const token = url.searchParams.get('token') || '';
  if (!readDigestPreferencesToken(token)) return page('<p>This preference link is invalid. Open Email preferences from a recent weekly AI recommendation report.</p>', 400);
  return page(`<p>Turn off weekly AI recommendation reports for the business in this email. Your other email and research study preferences are unchanged.</p><form method="post" action="/ai-email-preferences"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit" style="font:inherit;padding:12px 18px">Turn off weekly AI reports</button></form>`);
}
export async function POST(request: Request) {
  let form: URLSearchParams;
  try {
    assertAuthOrigin(request);
    form = await preferenceForm(request);
  } catch (error) {
    if (error instanceof RadarError) return page(`<p>${escapeHtml(error.userMessage)}</p>`, error.status);
    throw error;
  }
  const token = form.get('token');
  if (typeof token !== 'string' || !await disableDigestEmail(token)) return page('<p>This preference link is invalid or the business owner has changed. Open Email preferences from a recent report.</p>', 400);
  return new Response(null, { status: 303, headers: { location: '/ai-email-preferences?saved=1', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

/** A fixed, small HTML form; enforce the cap while streaming even without Content-Length. */
async function preferenceForm(request: Request): Promise<URLSearchParams> {
  const maxBytes = 2048;
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') {
    throw new RadarError('Submit the email preferences form.', 415, 'unsupported_media_type');
  }
  const oversized = () => new RadarError('This request is too large.', 413, 'payload_too_large');
  if (Number(request.headers.get('content-length')) > maxBytes) throw oversized();
  const reader = request.body?.getReader();
  if (!reader) throw new RadarError('This preference form is invalid.', 400, 'invalid');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw oversized(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  if ([...form.keys()].some(key => key !== 'token') || form.getAll('token').length !== 1) {
    throw new RadarError('This preference form is invalid.', 400, 'invalid');
  }
  return form;
}
