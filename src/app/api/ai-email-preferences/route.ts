import { RadarError } from '@/server/errors';
import { handle } from '@/server/http/handle';
import { disableDigestEmail } from '@/server/services/visibility/digestPreferences';
export const runtime = 'nodejs';
/** RFC8058 bearer-token opt-out only. GET never changes preferences. */
const post = handle(async (request: Request) => {
  const invalid = () => new RadarError('This preference request isn’t valid.',400,'invalid');
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded' || Number(request.headers.get('content-length')) > 128) throw invalid();
  const reader = request.body?.getReader(); if (!reader) throw invalid();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try { for (;;) { const {done,value} = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 128) { await reader.cancel(); throw invalid(); } chunks.push(value); } } finally { reader.releaseLock(); }
  const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  if ([...form].length !== 1 || form.get('List-Unsubscribe') !== 'One-Click') throw invalid();
  const token = new URL(request.url).searchParams.get('token') || '';
  return new Response(null, { status: await disableDigestEmail(token) ? 204 : 400, headers: { 'cache-control':'no-store', 'referrer-policy':'no-referrer' } });
});
export async function POST(request: Request) { const response = await post(request); response.headers.set('Cache-Control','no-store'); response.headers.set('Referrer-Policy','no-referrer'); return response; }
