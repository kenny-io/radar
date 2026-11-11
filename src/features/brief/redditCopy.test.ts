import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyRedditReply, redditCommentsUrl } from './redditCopy';

afterEach(() => vi.unstubAllGlobals());

const permalink = 'https://www.reddit.com/r/startups/comments/abc123/finding_customers/';
const destination = `${permalink}#comments`;

describe('Reddit comment destinations', () => {
  it.each([
    permalink,
    '/r/startups/comments/abc123/finding_customers/',
    'https://old.reddit.com/r/startups/comments/abc123/finding_customers/xyz789/?context=3#other',
    'https://new.reddit.com/r/startups/comments/abc123/finding_customers/?utm_source=radar',
  ])('opens the whole thread comments from %s', value => {
    expect(redditCommentsUrl(value)).toBe(destination);
  });

  it.each([
    undefined, '', 'not a link', 'https://www.reddit.com/r/startups/',
    'https://www.reddit.com/r/startups/comments/',
    'https://reddit.com.evil.example/r/startups/comments/abc123/title/',
    'https://evil.example/r/startups/comments/abc123/title/',
    'https://reddit.com@evil.example/r/startups/comments/abc123/title/',
    'https://user:pass@reddit.com/r/startups/comments/abc123/title/',
    'http://www.reddit.com/r/startups/comments/abc123/title/',
    'https://www.reddit.com:8443/r/startups/comments/abc123/title/',
    'javascript:alert(1)', '//evil.example/r/startups/comments/abc123/title/',
  ])('does not navigate to %s', value => {
    expect(redditCommentsUrl(value)).toBeNull();
  });
});

describe('copying a Reddit reply', () => {
  const setup = () => {
    const order: string[] = [];
    const writeText = vi.fn(() => { order.push('clipboard'); return Promise.resolve(); });
    const replace = vi.fn(() => { order.push('navigate'); });
    const close = vi.fn();
    const assign = vi.fn();
    let opener: unknown = 'Radar';
    const tab = { closed: false, location: { replace }, close,
      get opener() { return opener; },
      set opener(value) { order.push('disown'); opener = value; },
    };
    const open = vi.fn(() => { order.push('open'); return tab; });
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('window', { location: { assign, replace: vi.fn() }, open });
    return { writeText, assign, replace, close, open, tab, order };
  };

  it('reserves and disowns the new tab synchronously after starting the exact clipboard write', async () => {
    const { writeText, replace, open, tab, order, assign } = setup();
    let copied!: () => void;
    let saved!: (ok: boolean) => void;
    writeText.mockImplementation(() => { order.push('clipboard'); return new Promise<void>(resolve => { copied = resolve; }); });
    const persist = vi.fn(() => { order.push('save'); return new Promise<boolean>(resolve => { saved = resolve; }); });
    const response = 'My edited reply\nwith its own formatting.';
    const action = copyRedditReply(response, permalink, persist);
    expect(writeText).toHaveBeenCalledWith(response);
    expect(open).toHaveBeenCalledExactlyOnceWith('about:blank', '_blank');
    expect(tab.opener).toBeNull();
    expect(order).toEqual(['clipboard', 'open', 'disown']);
    expect(persist).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    copied();
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce());
    expect(replace).not.toHaveBeenCalled();
    saved(true);
    await expect(action).resolves.toBe('opened');
    expect(replace).toHaveBeenCalledExactlyOnceWith(destination);
    expect(order).toEqual(['clipboard', 'open', 'disown', 'save', 'navigate']);
    expect(assign).not.toHaveBeenCalled();
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it('closes the reserved tab without saving when clipboard permission is denied', async () => {
    const { writeText, replace, close } = setup();
    const denied = new Error('Clipboard permission denied');
    writeText.mockRejectedValue(denied);
    const persist = vi.fn().mockResolvedValue(true);
    await expect(copyRedditReply('Reply', permalink, persist)).rejects.toBe(denied);
    expect(persist).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it('cleans up without saving when clipboard access is unavailable', async () => {
    const { replace, close } = setup();
    vi.stubGlobal('navigator', {});
    const persist = vi.fn().mockResolvedValue(true);
    await expect(copyRedditReply('Reply', permalink, persist)).rejects.toThrow('Clipboard unavailable');
    expect(persist).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes the reserved tab but keeps the copied reply when saving fails', async () => {
    const { writeText, replace, close, assign } = setup();
    await expect(copyRedditReply('Reply', permalink, async () => false)).resolves.toBe('save-failed');
    expect(writeText).toHaveBeenCalledWith('Reply');
    expect(replace).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it('cleans up the blank tab if persistence unexpectedly rejects', async () => {
    const { close, replace } = setup();
    const failed = new Error('Save failed');
    await expect(copyRedditReply('Reply', permalink, async () => { throw failed; })).rejects.toBe(failed);
    expect(close).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([undefined, 'https://evil.example/r/startups/comments/abc123/title/'])('copies and saves without reserving a tab when its destination is %s', async url => {
    const { writeText, assign, open } = setup();
    const persist = vi.fn().mockResolvedValue(true);
    await expect(copyRedditReply('Reply', url, persist)).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('Reply');
    expect(persist).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it.each(['blocked', 'throws'])('retains copied/saved state and requests a fresh opening gesture when opening a tab %s', async kind => {
    const { open, assign, writeText, replace } = setup();
    if (kind === 'blocked') open.mockReturnValue(null as never);
    else open.mockImplementation(() => { throw new Error('Popup unavailable'); });
    const persist = vi.fn().mockResolvedValue(true);
    await expect(copyRedditReply('Reply', permalink, persist)).resolves.toBe('open-needed');
    expect(writeText).toHaveBeenCalledWith('Reply');
    expect(persist).toHaveBeenCalledOnce();
    expect(assign).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('handles rejected clipboard access even when popup creation throws synchronously', async () => {
    const { open, writeText, assign } = setup();
    const denied = new Error('Clipboard denied');
    writeText.mockRejectedValue(denied);
    open.mockImplementation(() => { throw new Error('Popup unavailable'); });
    const persist = vi.fn();
    await expect(copyRedditReply('Reply', permalink, persist)).rejects.toBe(denied);
    expect(persist).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('requests a fresh opening gesture if the user closes the reserved tab while copying', async () => {
    const { tab, replace, close, assign } = setup();
    const persist = vi.fn(async () => { tab.closed = true; return true; });
    await expect(copyRedditReply('Reply', permalink, persist)).resolves.toBe('open-needed');
    expect(persist).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('closes the reserved tab and requests a fresh gesture if its navigation throws', async () => {
    const { replace, close, assign } = setup();
    replace.mockImplementation(() => { throw new Error('Navigation unavailable'); });
    const persist = vi.fn().mockResolvedValue(true);
    await expect(copyRedditReply('Reply', permalink, persist)).resolves.toBe('open-needed');
    expect(persist).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(assign).not.toHaveBeenCalled();
  });

  it('discards a tab that cannot safely have its opener cleared, without losing the copy', async () => {
    const { tab, close, replace, assign } = setup();
    Object.defineProperty(tab, 'opener', { set() { throw new Error('Cannot disown tab'); } });
    const persist = vi.fn().mockResolvedValue(true);
    await expect(copyRedditReply('Reply', permalink, persist)).resolves.toBe('open-needed');
    expect(persist).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('retains the original clipboard error if closing the blank tab also throws', async () => {
    const { close, writeText } = setup();
    const denied = new Error('Clipboard denied');
    writeText.mockRejectedValue(denied);
    close.mockImplementation(() => { throw new Error('Already discarded'); });
    await expect(copyRedditReply('Reply', permalink, vi.fn())).rejects.toBe(denied);
  });
});
