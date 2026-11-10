import { describe, expect, it } from 'vitest';
import { publicPublishError, publicPublishingJob, PUBLISH_FAILURE_MESSAGE } from './publishingFailure';

describe('public publication failure projection', () => {
  const raw = { http: 422, platform: 'GitHub', source: 'radar', message: 'Raw provider status', hint: 'Private repository failure', diagnostic: { code: 'plan-empty', path: 'private/source.ts', reason: 'Private reason' } };
  it('returns generic entry errors without mutating the stored diagnostics', () => {
    expect(publicPublishError(raw)).toEqual({ http: 0, message: PUBLISH_FAILURE_MESSAGE });
    expect(publicPublishError(null)).toBeNull(); expect(raw.diagnostic.path).toBe('private/source.ts');
  });
  it.each([
    { status: 'done', result: { status: 'failed', error: raw } },
    { status: 'failed', result: { detail: 'Private thrown error' } },
    { status: 'queued', error: 'Private transient error', result: null },
  ])('projects publishing job internals safely for workspace, polling and SSE', scenario => {
    const job = publicPublishingJob({ id: 'job-1', kind: 'publish.entry', error: 'Private error', progress: { debug: 'Private debug' }, ...scenario });
    expect(job.error).toBe(PUBLISH_FAILURE_MESSAGE);
    expect(job.progress).toBeNull();
    expect(JSON.stringify(job)).not.toContain('Private'); expect(JSON.stringify(job)).not.toContain('plan-empty');
  });
  it('preserves successful publication URLs and leaves other job contracts intact', () => {
    expect(publicPublishingJob({ kind: 'publish.entry', status: 'done', result: { status: 'published', url: 'https://example.test/post', private: 'drop' } })).toMatchObject({ result: { status: 'published', url: 'https://example.test/post' } });
    const job = { kind: 'article.draft', status: 'failed', error: 'Existing draft message', result: { detail: 'Existing detail' } };
    expect(publicPublishingJob(job)).toBe(job);
  });
});
