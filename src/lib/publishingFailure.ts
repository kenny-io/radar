import type { ArticlePublishError } from './types';

export const PUBLISH_FAILURE_MESSAGE = 'Radar is unable to publish this post. Your article is saved.';
export const REPORT_ISSUE_LABEL = 'Report issue to the team';
export const REPORT_ISSUE_ERROR = 'Radar couldn’t send your report. Please try again.';

/** Technical publishing failures stay in server storage for the explicit team report. */
export function publicPublishError(error: unknown): ArticlePublishError | null {
  return error ? { http: 0, message: PUBLISH_FAILURE_MESSAGE } : null;
}

/** Publishing jobs cross workspace, polling and SSE boundaries; other job contracts are unchanged. */
export function publicPublishingJob<T extends { kind: string; status: string; error?: unknown; result?: unknown; progress?: unknown }>(job: T): T {
  if (job.kind !== 'publish.entry') return job;
  const result = job.result as { status?: string; url?: string } | null | undefined;
  const failed = job.status === 'failed' || result?.status === 'failed';
  return {
    ...job,
    error: job.error || failed ? PUBLISH_FAILURE_MESSAGE : null,
    ...(job.progress === undefined ? {} : { progress: null }),
    ...(job.result === undefined ? {} : { result: failed ? { status: 'failed', error: publicPublishError(true) }
      : result?.status === 'published' ? { status: 'published', url: result.url }
        : result?.status === 'retry' || result?.status === 'skipped' ? { status: result.status } : null }),
  };
}
