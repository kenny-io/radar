import { repositoryPublishingError } from './http';

/** Calendar refreshes historically stored root-relative paths. Resolve them on the business site, never Radar. */
export function resolveRefreshUrl(value: string | null | undefined, domain: string): string {
  const invalid = (): never => {
    const reason = 'The refresh target must be an existing website URL or a path on your business website. Check the article’s refresh target before publishing.';
    throw repositoryPublishingError(reason, 'refresh-url-invalid');
  };
  const safeText = (text: string) => !!text && !/[\x00-\x20\x7f\\]/.test(text);
  const target = value || invalid();
  if (!safeText(target) || target.startsWith('//')) invalid();
  const relative = target.startsWith('/');
  if (!relative && !/^https?:\/\/[^/?#]+/i.test(target)) invalid();
  // URL() removes dot segments. Reject them in the original input before normalization loses that evidence.
  const rawPath = (relative ? target : target.replace(/^https?:\/\/[^/?#]*/i, '')).split(/[?#]/)[0];
  for (const segment of rawPath.split('/')) {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); } catch { return invalid(); }
    if (decoded === '.' || decoded === '..' || /[/\\\x00-\x1f\x7f]/.test(decoded)) invalid();
  }
  try {
    let base: URL | undefined;
    if (relative) {
      if (!safeText(domain) || domain.startsWith('//') || (domain.includes('://') && !/^https?:\/\//i.test(domain))) invalid();
      const origin = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
      if (!/^https?:\/\/[^/?#]+/i.test(origin)) invalid();
      base = new URL(origin);
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) invalid();
    }
    const url = new URL(target, base?.origin);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) invalid();
    // Preserve the supplied absolute URL verbatim, including query order and fragment routing.
    return relative ? url.href : target;
  } catch { return invalid(); }
}
