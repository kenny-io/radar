'use client';
// OPT-F0 stub, filled by E1 (idle spend): sends `app.seen` on mount, business switch and route change. .factory/first-five-optimizations/architecture.md §2.1.

/** At most one ping per 10 minutes per tab. */
export function useSeenPing(bid: string | null, pathname: string | null): void {}
