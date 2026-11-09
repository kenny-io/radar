import { copyPromptText } from '@/lib/promptClipboard';

const REDDIT_HOSTS = new Set(['reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com', 'np.reddit.com', 'm.reddit.com']);

/** Only thread permalinks can become automatic destinations; strip comment IDs and tracking. */
export function redditCommentsUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, 'https://www.reddit.com');
    if (url.protocol !== 'https:' || !REDDIT_HOSTS.has(url.hostname) || url.port || url.username || url.password) return null;
    const thread = url.pathname.match(/^\/((?:r\/[a-z0-9_]+\/)?comments\/[a-z0-9]+(?:\/[^/]+)?)(?:\/.*)?$/i);
    return thread ? `https://www.reddit.com/${thread[1]}/#comments` : null;
  } catch {
    return null;
  }
}

/** Navigation must never interrupt either the clipboard write or saving the user's edited reply. */
export async function copyRedditReply(text: string, url: string | undefined, persist: () => Promise<boolean>): Promise<'opened' | 'copied' | 'save-failed'> {
  await copyPromptText(text);
  if (!await persist()) return 'save-failed';
  const destination = redditCommentsUrl(url);
  if (!destination) return 'copied';
  window.location.assign(destination);
  return 'opened';
}
