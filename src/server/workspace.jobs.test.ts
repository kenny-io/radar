// The job list inside the workspace must not carry article text once a draft has finished (first-five LS-2).
import { describe, expect, it } from 'vitest';
import { jobProgress } from './workspace';

const blocks = [{ t: 'p', text: 'x'.repeat(2000) }];
describe('jobProgress', () => {
  it('drops the streamed text of a finished draft and keeps the rest', () => {
    for (const status of ['done', 'failed'])
      expect(jobProgress({ kind: 'article.draft', status, progress: { blocks, partial: 'tail', stage: 'images', completed: 2, total: 2 } })).toEqual({ stage: 'images', completed: 2, total: 2 });
  });
  it('leaves a draft that is still running alone: an article opened mid-draft shows the stream so far', () => {
    for (const status of ['queued', 'running']) {
      const progress = { blocks, partial: 'tail', stage: 'writing' };
      expect(jobProgress({ kind: 'article.draft', status, progress })).toBe(progress);
    }
  });
  it('leaves other jobs and empty progress alone', () => {
    const progress = { blocks: 3, keep: true };
    expect(jobProgress({ kind: 'calendar.generate', status: 'failed', progress })).toBe(progress);
    expect(jobProgress({ kind: 'article.draft', status: 'done', progress: null })).toBeNull();
  });
});
