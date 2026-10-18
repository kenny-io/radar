// OAuth flows for integrations (Search Console, blog connectors). Opened in a popup; the callback posts a message to the opener.
import type { User } from '@/lib/types';
export interface OAuthStartCtx { user: User; bid: string; state: string; redirectUri: string; params: URLSearchParams }
export interface OAuthCallbackCtx { user: User | null; bid: string; data: any; redirectUri: string; params: URLSearchParams }
export interface OAuthProvider {
  /** Minimum role to start the flow. */
  role?: 'Editor' | 'Admin';
  /** Return the provider authorize URL. Store anything you need later in `data` (merged into the state row). */
  start: (ctx: OAuthStartCtx) => Promise<{ url: string; data?: any }>;
  /** Exchange the code, persist tokens (encrypted). Return a small public result for the opener. */
  callback: (ctx: OAuthCallbackCtx) => Promise<{ ok: boolean; result?: any; error?: string }>;
}
const g = globalThis as unknown as { __radarOAuth?: Map<string, OAuthProvider> };
const reg = (g.__radarOAuth ??= new Map());
export function defineOAuth(name: string, p: OAuthProvider) { reg.set(name, p); }
export const oauthProvider = (name: string) => reg.get(name);
