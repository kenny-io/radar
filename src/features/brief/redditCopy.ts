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

function closeReservedTab(tab: Window | null) {
  try { if (tab && !tab.closed) tab.close(); } catch { /* The browser may already have discarded the tab. */ }
}

/** Reserve a tab during the gesture; external navigation waits for both copying and saving. */
export async function copyRedditReply(text: string, url: string | undefined, persist: () => Promise<boolean>): Promise<'opened' | 'copied' | 'save-failed' | 'open-needed'> {
  const destination = redditCommentsUrl(url);
  // Start clipboard access before opening a tab can move focus away from Radar.
  const copying = copyPromptText(text);
  let tab: Window | null = null;
  if (destination) {
    try {
      tab = window.open('about:blank', '_blank');
      if (tab) tab.opener = null;
    } catch {
      closeReservedTab(tab);
      tab = null;
    }
  }
  try {
    await copying;
    if (!await persist()) { closeReservedTab(tab); return 'save-failed'; }
    if (!destination) return 'copied';
    try {
      if (!tab || tab.closed) return 'open-needed';
      tab.location.replace(destination);
      return 'opened';
    } catch {
      closeReservedTab(tab);
      return 'open-needed';
    }
  } catch (error) {
    closeReservedTab(tab);
    throw error;
  }
}
