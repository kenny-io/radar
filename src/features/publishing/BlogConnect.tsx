'use client';
// CONTRACT (owned by the publishing area): connect / edit a blog connection, including the first-connection Mode step.
// type: null (closed) | 'wordpress' (new connection of that platform) | { type, id?, step?: 'mode' } (edit / mode-only).
import type { ConnectionPublic } from '@/lib/types';
export interface BlogConnectProps { type: null | string | { type: string; id?: string | null; step?: 'mode' }; onClose: () => void; onSaved?: (c: ConnectionPublic) => void }
export function BlogConnect(_p: BlogConnectProps): any { return null; }
