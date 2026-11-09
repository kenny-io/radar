import { z } from 'zod';
import { EDUCATION_LESSONS, type EducationLessonId } from './educationContent';
export const EDUCATION_DESTINATIONS: Record<EducationLessonId, string> = { ai_visibility: '/performance?tab=ai', daily_brief: '/brief', backlinks: '/backlinks', organic_search: '/calendar', social_marketing: '/social?generate=1' };
const Input = z.object({ lesson: z.enum(EDUCATION_LESSONS), businessId: z.string().uuid().optional() });
/** Shared narrow auth-return/landing parser; no generic email paths, duplicate parameters or arbitrary redirects. */
export function parseEducationLanding(value: string) {
  const url = new URL(value, 'http://localhost'), params = url.searchParams, keys = [...params.keys()];
  if (url.pathname !== '/email/learn' || url.hash || keys.some(k => !['lesson', 'businessId'].includes(k)) || new Set(keys).size !== keys.length) throw new Error('Invalid lesson link');
  return Input.parse({ lesson: params.get('lesson'), ...(params.has('businessId') ? { businessId: params.get('businessId') } : {}) });
}
export function isEducationLanding(value: string) {
  if (!value.startsWith('/email/learn?')) return false;
  try { parseEducationLanding(value); return true; } catch { return false; }
}
