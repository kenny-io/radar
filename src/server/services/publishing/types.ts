import type { Block, ConnType } from '@/lib/types';

/** Everything a connector needs. `creds` is the decrypted secret material (passwords, API keys, OAuth tokens) — server only. */
export interface ConnCtx {
  type: ConnType;
  fields: Record<string, string>;
  creds: Record<string, any>;
  target: string | null;
  targetId: string | null;
  /** Webhook signing secret (whsec_…) */
  secret?: string | null;
  bid: string;
  domain: string;
  businessName: string;
}
export interface Target { id: string; name: string; url?: string | null }

export interface PublishImage { url: string; alt: string; bytes: () => Promise<{ buf: Buffer; type: string; name: string }> }
export interface PublishPayload {
  entryId: string;
  title: string;
  slug: string;
  /** HTML body (videos embedded after the first section, sources as citations, approved outbound links applied) */
  html: string;
  /** Markdown/MDX body for Git-based blogs */
  markdown: string;
  /** The article blocks (for platforms with their own block format, e.g. Notion) */
  blocks: Block[];
  meta: string;
  /** The article's SEO title (Article → SEO), falling back to the title. Platforms with a meta-title field get it. */
  seoTitle?: string;
  keyword: string;
  /** The scheduled date (YYYY-MM-DD) */
  date: string;
  image: PublishImage | null;
  /** Canonical URL: the existing page for refresh entries, otherwise null (the platform's own URL is canonical). */
  canonical: string | null;
  mode: 'new' | 'refresh';
  /** Existing page URL for refresh entries */
  refreshUrl: string | null;
  sources: { title: string; url: string }[];
  videos: { id: string; title: string; channel: string; url: string }[];
  author: string;
}

/** The remote draft created before publishing (persisted on the entry so a retry reuses it). */
export interface RemoteDraft { id: string; url?: string | null; extra?: any; connId?: string }

export interface Connector {
  /** Picker options (CMS collection / database / site / blog). */
  targets?: (c: ConnCtx) => Promise<Target[]>;
  /** Create a draft post and delete it. Throws PublishError. */
  test: (c: ConnCtx) => Promise<void>;
  /** Create (or update, for refresh entries) a draft on the platform. */
  createDraft: (c: ConnCtx, p: PublishPayload) => Promise<RemoteDraft>;
  /** Make the draft live. Returns the public URL. */
  publish: (c: ConnCtx, p: PublishPayload, d: RemoteDraft) => Promise<{ url: string }>;
}

export const TEST_TITLE = 'Radar connection test';
export const TEST_HTML = '<p>Radar created this draft to test the connection. It is deleted right away.</p>';
