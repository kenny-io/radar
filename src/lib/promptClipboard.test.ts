import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyPromptText } from './promptClipboard';

afterEach(() => vi.unstubAllGlobals());

describe('prompt clipboard writes', () => {
  it('stays pending until the browser confirms the exact prompt was copied', async () => {
    let confirm!: () => void;
    const writeText = vi.fn(() => new Promise<void>(resolve => { confirm = resolve; }));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    let finished = false;
    const copy = copyPromptText('Full implementation prompt\nwith exact values').then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(writeText).toHaveBeenCalledWith('Full implementation prompt\nwith exact values');
    confirm();
    await copy;
    expect(finished).toBe(true);
  });
  it('propagates an asynchronous browser denial so the UI can show manual recovery', async () => {
    const denied = new Error('NotAllowedError');
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(denied) } });
    await expect(copyPromptText('prompt')).rejects.toBe(denied);
  });
  it('fails truthfully when the browser clipboard API is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    await expect(copyPromptText('prompt')).rejects.toThrow('Clipboard unavailable');
    vi.stubGlobal('navigator', undefined);
    await expect(copyPromptText('prompt')).rejects.toThrow('Clipboard unavailable');
  });
});
