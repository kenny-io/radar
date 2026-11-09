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
    const writeText = vi.fn().mockResolvedValue(undefined);
    const assign = vi.fn();
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('window', { location: { assign }, open: vi.fn(() => { throw new Error('Popups blocked'); }) });
    return { writeText, assign };
  };

  it('waits for the exact edited response to copy, then persistence, before redirecting without a popup', async () => {
    const { writeText, assign } = setup();
    let copied!: () => void;
    let saved!: (ok: boolean) => void;
    writeText.mockImplementation(() => new Promise<void>(resolve => { copied = resolve; }));
    const persist = vi.fn(() => new Promise<boolean>(resolve => { saved = resolve; }));
    const response = 'My edited reply\nwith its own formatting.';
    const action = copyRedditReply(response, permalink, persist);
    expect(writeText).toHaveBeenCalledWith(response);
    expect(persist).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    copied();
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce());
    expect(assign).not.toHaveBeenCalled();
    saved(true);
    await expect(action).resolves.toBe('opened');
    expect(assign).toHaveBeenCalledExactlyOnceWith(destination);
    expect(window.open).not.toHaveBeenCalled();
  });

  it('does not mark copied or navigate when clipboard permission is denied', async () => {
    const { writeText, assign } = setup();
    const denied = new Error('Clipboard permission denied');
    writeText.mockRejectedValue(denied);
    const persist = vi.fn().mockResolvedValue(true);
    await expect(copyRedditReply('Reply', permalink, persist)).rejects.toBe(denied);
    expect(persist).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('does not mark copied or navigate when clipboard access is unavailable', async () => {
    const { assign } = setup();
    vi.stubGlobal('navigator', {});
    const persist = vi.fn().mockResolvedValue(true);
    await expect(copyRedditReply('Reply', permalink, persist)).rejects.toThrow('Clipboard unavailable');
    expect(persist).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('keeps the copied reply in Radar if saving its state fails', async () => {
    const { writeText, assign } = setup();
    await expect(copyRedditReply('Reply', permalink, async () => false)).resolves.toBe('save-failed');
    expect(writeText).toHaveBeenCalledWith('Reply');
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([undefined, 'https://evil.example/r/startups/comments/abc123/title/'])('still copies and saves when its destination is %s', async url => {
    const { writeText, assign } = setup();
    const persist = vi.fn().mockResolvedValue(true);
    await expect(copyRedditReply('Reply', url, persist)).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('Reply');
    expect(persist).toHaveBeenCalledOnce();
    expect(assign).not.toHaveBeenCalled();
  });
});
