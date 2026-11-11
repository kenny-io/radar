/** Shared support contract. Transcripts are memory-only in the client. */
export const MAX_HISTORY = 12;
export const MESSAGE_MAX = 2000;
export const HISTORY_TEXT_MAX = 4000;
export interface SupportMessage { role: 'user' | 'assistant'; text: string }
export type SupportPage = 'dashboard' | 'brief' | 'calendar' | 'article' | 'social' | 'performance' | 'backlinks' | 'profile' | 'settings';
export type SupportRequest =
  | { kind: 'ask'; message: string; history: SupportMessage[]; page: SupportPage }
  | { kind: 'handoff'; message: string; history: SupportMessage[]; page: SupportPage; requestId: string };
export type SupportResponse =
  | { kind: 'answer'; reply: string; needsHuman: boolean }
  | { kind: 'handoff'; delivered: boolean; reference: string };
