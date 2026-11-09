import type { SupportRequest, SupportResponse } from '@/lib/support';
import type { BizRow } from '@/server/workspace';
import { enforce, HOUR, DAY } from '@/server/abuse/rateLimit';
import { RadarError } from '@/server/errors';
import { answerSupport } from './answer';
import { sendSupportMail } from './mail';

export async function supportRequest(user: { id: string; name: string; email: string }, biz: BizRow, input: SupportRequest): Promise<SupportResponse> {
  const mode = input.kind === 'ask' ? 'ask' : 'mail';
  const limited = () => new RadarError(mode === 'ask' ? 'You’ve asked several questions. Please try again later, or choose Email support.' : 'You’ve sent several support requests. Please try again later.', 429, 'rate_limited');
  await enforce([
    { key: `support:${mode}:user:${user.id}`, limit: mode === 'ask' ? 30 : 5, windowSec: HOUR, error: limited },
    { key: `support:${mode}:user:${user.id}`, limit: mode === 'ask' ? 100 : 10, windowSec: DAY, error: limited },
    { key: `support:${mode}:business:${biz.id}`, limit: mode === 'ask' ? 100 : 15, windowSec: HOUR, error: limited },
  ]);
  return input.kind === 'ask' ? answerSupport(biz, input) : sendSupportMail(user, biz, input);
}
