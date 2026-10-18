'use client';
// CONTRACT (owned by the performance/GSC area): connect flow — button → Google OAuth popup → "Finding your properties…" → radio list → connect.
// bid: the business to connect (the onboarding business during onboarding). onConnected receives the chosen property after the server has saved it and queued the backfill.
export interface GscConnectProps { bid: string; domain: string; compact?: boolean; onConnected: (property: string) => void }
export function GscConnect(_p: GscConnectProps): any { return null; }
