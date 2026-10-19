import { env } from '@/server/env';
import type { BriefPlatform } from '@/lib/types';
import { hasRedditApi, redditSource } from './reddit';
import { hasXApi, xSource } from './x';
import { hnSource } from './hn';
import { webSource } from './web';
import { hasSearchApi, searchSource } from './search';
import { stubSource } from './stub';
import type { Source } from './types';

/** The source used for each platform. Without Reddit/X credentials (and always for LinkedIn and Quora) Radar searches
 *  the platform's domain: Perplexity's Search API when configured, else the research model's web search (DIVERGENCES). */
export function sourceFor(plat: BriefPlatform): Source {
  if (env.devStubs) return stubSource(plat);
  if (plat === 'hn') return hnSource;
  if (plat === 'reddit' && hasRedditApi()) return redditSource;
  if (plat === 'x' && hasXApi()) return xSource;
  return hasSearchApi() ? searchSource(plat) : webSource(plat);
}
export * from './types';
