// Delete a business: what the server and the client must agree on (.factory/delete-business/architecture.md §9.1).
export const DELETE_RETENTION_DAYS = 7;
export const DELETE_RETENTION_HOURS = 168;
/** DEL-2: trimmed and case-insensitive, nothing else (no scheme or www stripping). */
export const domainMatches = (typed: string, domain: string) => typed.trim().toLowerCase() === domain.trim().toLowerCase();
/** sessionStorage key for a toast that must survive a full navigation: JSON `{ msg: string; tone?: 'ok' | 'warn' | 'bad' }`. */
export const FLASH_KEY = 'radar.flash';
