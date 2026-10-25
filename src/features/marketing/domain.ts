// Website field on the marketing pages (UPDATE-2026-10-25 §2). Mirrors the prototype's home.js `clean`, which differs from
// the shared cleanDomain (lib/format) by also cutting at ? # and whitespace. Keep the two separate: the API and onboarding use
// the shared one.
export const SITE_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
export const SITE_ERROR = 'Enter your website, like yourcompany.com';
export const SITE_NOTE = '3-day free trial, then $50/month.';

/** trim, lowercase, strip http(s):// and www., cut at the first / ? # or whitespace. */
export const cleanSite = (v: string) => v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#\s]/)[0];

/** The /start URL for a typed website, or null when it isn't a valid domain. */
export function startHref(raw: string) {
  const d = cleanSite(raw);
  return SITE_RE.test(d) ? '/start?domain=' + encodeURIComponent(d) : null;
}
