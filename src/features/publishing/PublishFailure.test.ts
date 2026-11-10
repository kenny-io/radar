import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const M = vi.hoisted(() => ({ act: vi.fn(), toast: vi.fn() }));
vi.mock('@/client/app', () => ({ useApp: () => ({ act: M.act, toast: M.toast }) }));
import { PublishFailure } from './PublishFailure';
import { PUBLISH_FAILURE_MESSAGE } from '@/lib/publishingFailure';

describe('publication failure banner', () => {
  it('shows saved-article copy and the explicit report action, with a secondary editor retry', () => {
    const html = renderToStaticMarkup(React.createElement(PublishFailure, { entryId: 'entry-1', onRetry: () => {} }));
    expect(html).toContain(PUBLISH_FAILURE_MESSAGE);
    expect(html).toContain('Report issue to the team'); expect(html).toContain('Retry');
    expect(html).toContain('btn-primary'); expect(html).toContain('btn-secondary');
    expect(html).not.toContain('repository'); expect(html).not.toContain('422'); expect(html).not.toContain('GitHub');
    expect(M.act).not.toHaveBeenCalled();
  });
  it('lets viewers report without displaying a publication retry', () => {
    const html = renderToStaticMarkup(React.createElement(PublishFailure, { entryId: 'entry-1' }));
    expect(html).toContain('Report issue to the team'); expect(html).not.toContain('Retry');
    expect(M.act).not.toHaveBeenCalled();
  });
});
