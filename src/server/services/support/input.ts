import { z } from 'zod';
import type { SupportRequest } from '@/lib/support';
import { MAX_HISTORY, MESSAGE_MAX, HISTORY_TEXT_MAX } from '@/lib/support';
import { RadarError } from '@/server/errors';

export const MAX_SUPPORT_BYTES = 32 * 1024;
const common = {
  message: z.string().trim().min(1).max(MESSAGE_MAX),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().trim().min(1).max(HISTORY_TEXT_MAX) }).strict()).max(MAX_HISTORY),
  page: z.enum(['dashboard', 'brief', 'calendar', 'article', 'social', 'performance', 'backlinks', 'profile', 'settings']),
};
export const SupportBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ask'), ...common }).strict(),
  z.object({ kind: z.literal('handoff'), ...common, requestId: z.uuid() }).strict(),
]);

/** Read at most 32KiB, including requests without a trustworthy Content-Length. */
export async function readSupportRequest(req: Request): Promise<SupportRequest> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new RadarError('Send your support question as JSON.', 400, 'invalid');
  const tooLarge = () => new RadarError('This conversation is too long. Start a new chat or shorten your message.', 413, 'too_large');
  if (Number(req.headers.get('content-length')) > MAX_SUPPORT_BYTES) throw tooLarge();
  const reader = req.body?.getReader();
  if (!reader) throw new RadarError('Add a support question.', 400, 'invalid');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_SUPPORT_BYTES) { await reader.cancel(); throw tooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new RadarError('This question could not be read. Please try again.', 400, 'invalid'); }
  return SupportBody.parse(value);
}
