import { env } from '@/server/env';
import type { BriefPlatform } from '@/lib/types';
import { hasRedditApi, redditSource } from './reddit';
import { hasXApi, xSource } from './x';
import { hnSource } from './hn';
import { webSource } from './web';
import { stubSource } from './stub';
import type { Source } from './types';

/** The source used for each platform. Missing Reddit/X credentials fall back to web search (logged divergence). */
export function sourceFor(plat: BriefPlatform): Source {
  if (env.devStubs) return stubSource(plat);
  if (plat === 'reddit') return hasRedditApi() ? redditSource : webSource('reddit');
  if (plat === 'x') return hasXApi() ? xSource : webSource('x');
  if (plat === 'hn') return hnSource;
  return webSource(plat);
}
export * from './types';
