import { z } from 'zod';
import { authBody, assertAuthOrigin } from '@/server/auth/requests';
import { handle, json } from '@/server/http/handle';
import { preferenceUser, stopOnboarding, workPreferenceUser, stopWorkUpdates, educationPreferenceUser, updateEducationPreference } from '@/server/services/lifecycle/preferences';
import { RadarError } from '@/server/errors';

/** RFC8058 providers POST a fixed form body. A purpose-scoped signed URL can only turn work updates off. */
async function oneClickBody(req: Request) {
  const invalid = () => new RadarError('This preference request isn’t valid.', 400, 'invalid');
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') throw invalid();
  if (Number(req.headers.get('content-length')) > 128) throw invalid();
  const reader = req.body?.getReader();
  if (!reader) throw invalid();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 128) { await reader.cancel(); throw invalid(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  if ([...params].length !== 1 || params.get('List-Unsubscribe') !== 'One-Click') throw invalid();
}
const post = handle(async (req: Request) => {
  const linkToken = new URL(req.url).searchParams.get('token');
  if (linkToken !== null) {
    if (linkToken.length > 256) return json({ ok: false, error: 'This preference link isn’t valid.' }, 400);
    const educationUser = educationPreferenceUser(linkToken);
    const uid = educationUser || workPreferenceUser(linkToken);
    if (!uid) return json({ ok: false, error: 'This preference link isn’t valid.' }, 400);
    await oneClickBody(req);
    if (educationUser) await updateEducationPreference(uid, false); else await stopWorkUpdates(uid);
    return json({ ok: true });
  }
  assertAuthOrigin(req);
  const { token } = z.object({ token: z.string().max(256) }).strict().parse(await authBody(req));
  const educationUser = educationPreferenceUser(token);
  if (educationUser) { await updateEducationPreference(educationUser, false); return json({ ok: true }); }
  const workUser = workPreferenceUser(token);
  if (workUser) { await stopWorkUpdates(workUser); return json({ ok: true }); }
  const uid = preferenceUser(token);
  if (!uid) return json({ ok: false, error: 'This preference link isn’t valid.' }, 400);
  await stopOnboarding(uid);
  return json({ ok: true });
});
export async function POST(req: Request) {
  const response = await post(req);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
