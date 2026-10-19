// Shared types — the contract between server and client.
// Shapes mirror 02-system.md §1 and the prototype's per-business state ("B").

export type Role = 'Owner' | 'Admin' | 'Editor' | 'Viewer';

export interface User { id: string; name: string; email: string }

export type Intent = 'Commercial' | 'Informational';
export type KwSource = 'site' | 'gsc' | 'competitor' | 'user';
export interface Keyword { kw: string; intent: Intent; vol: number | null; kd: number | null; src: KwSource; priority: boolean }
export interface KeywordSuggestion { kw: string; intent: Intent; vol: number | null; kd: number | null; src: KwSource; why: string }

export interface Brand {
  /** url (uploaded / detected file) | 'detected' (brand-colored tile) | null (not found) */
  logo: string | null;
  /** true when the user uploaded the logo themselves (Re-analyze never replaces it) */
  logoUploaded?: boolean;
  primary: string; secondary: string; voice: string; language: string; markets: string[];
}
export interface Profile {
  domain: string;
  business: { name: string; description: string; offerings: string[]; industry: string; positioning: string; differentiators: string[] };
  audience: { segments: string[]; buyers: string[]; needs: string[]; competitors: string[] };
  keywords: { list: Keyword[] };
  brand: Brand;
}
export type Edited = Record<string, true>;

export type GscStatus = 'none' | 'skipped' | 'syncing' | 'connected' | 'error';
export interface GscState { status: GscStatus; property: string | null; progress: number; lastSyncedThrough: string | null; error: string | null }

export type Cadence = 'daily' | 'weekdays' | 'custom';
export interface CalendarSettings { market: string; language: string; start: string; cadence: Cadence; perWeek: number }
export type EntryType = 'How-to' | 'Guide' | 'Comparison' | 'Listicle' | 'Explainer' | 'Template';
export type EntryStatus = 'proposed' | 'approved' | 'drafting' | 'draft' | 'review' | 'scheduled' | 'publishing' | 'published' | 'failed';
export interface Measured { impr: number; clicks: number; pos: number }
export interface CalendarEntry {
  id: string; title: string; kw: string; type: EntryType; vol: number | null; kd: number | null; date: string;
  mode: 'new' | 'refresh'; url: string | null; measured: Measured | null;
  audience: string; relevance: string; dest: string | null; status: EntryStatus;
  publishError: { http: number; message: string; platform?: string } | null; publishedUrl: string | null;
}
export interface CalendarState { entries: CalendarEntry[]; settings: CalendarSettings; generatedAt: string | null }

export type Block = ['p' | 'h2' | 'h3', string] | ['ul', string[]];
export type ImageStyle = 'branded' | 'illustration' | 'photography' | 'infographic';
export interface VideoRef { id: string; title: string; channel: string; dur: string; views: string; why: string }
export interface Source { title: string; url: string; use: string; removed?: boolean; /** research notes (facts quoted from the source) — statistics in the draft must appear here */ notes?: string[] }
export interface Article {
  entryId: string; generated: boolean; body: Block[];
  brief: { angle: string; outline: string[]; words: 900 | 1400 | 2200 };
  seo: { title: string; meta: string; slug: string };
  img: { style: ImageStyle; seed: number; prompt: string; alt: string; url: string | null; /** `${style}:${seed}` the stored url was rendered for (stale url → render the template live) */ urlKey?: string | null };
  videos: string[]; videoMeta: VideoRef[]; sources: Source[];
  /** claim spans tied to sources: [blockIndex, text, sourceIndex] — used to flag claims when a source is removed */
  claims: { block: number; text: string; source: number }[];
  /** ISO time the last draft job finished (content area) */
  draftedAt?: string | null;
  /** when videoMeta (YouTube suggestions) was fetched */
  videoFetchedAt?: string | null;
}

export type ConnType = 'wordpress' | 'ghost' | 'webflow' | 'notion' | 'wix' | 'shopify' | 'wpcom' | 'webhook' | 'framer' | 'nextjs';
/** Connection as the client sees it — never contains secrets. */
export interface ConnectionPublic { id: string; type: ConnType; url: string; target: string | null; targetId?: string | null; f: Record<string, string>; secretHint?: string | null; status: 'ok' | 'error'; lastError?: string | null }
export interface BlogState { conns: ConnectionPublic[]; defaultId: string | null; mode: 'review' | 'autopilot'; autopilotAckAt: string | null; paused: boolean; tz: string; time: string; /** platforms this deployment can connect (OAuth apps configured) */ available?: string[] }

export type Platform = 'linkedin' | 'x' | 'facebook' | 'reddit' | 'quora';
export type PackStyle = ImageStyle | 'custom';
export interface SocialPost { text: string; style: PackStyle; seed: number; imageUrl: string | null; copiedAt: number | null; v: number }
export interface SocialPack {
  id: string; name: string; source: { kind: 'idea' | 'url' | 'article' | 'suggest'; label: string; ref?: string | null };
  created: string; style: PackStyle; custom?: string; voice?: string; auto: boolean; posts: Partial<Record<Platform, SocialPost>>;
}
export interface SocialAuto { on: boolean; freq: 'daily' | 'custom'; days: string[]; platforms: Platform[]; style: ImageStyle; time: string }

export type BriefPlatform = 'reddit' | 'x' | 'linkedin' | 'hn' | 'quora';
export interface BriefSettings { platforms: BriefPlatform[]; time: string; mention: 'asked' | 'relevant' | 'never' }
export type BriefItemState = 'open' | 'copied' | 'posted' | 'skipped' | 'expired';
export interface BriefItem {
  id: string; kind: 'reply' | 'post';
  plat?: BriefPlatform; where?: string; who?: string; url?: string; eng?: string; postedAt?: string; title: string; body?: string;
  replyTo?: { who: string; text: string } | null; asks?: boolean; fresh?: boolean;
  /** The community's rules forbid self-promotion: Radar drafted no mention variant (mention === help). */
  noMention?: boolean;
  plats?: BriefPlatform[]; pl?: BriefPlatform | null;
  tag: string; why: string;
  drafts: Record<string, string>; edits: Record<string, string>; mention: boolean; st: BriefItemState;
}
export interface BriefDay { date: string; scannedAt: string; items: BriefItem[] }
export interface BriefState { setup: boolean; settings: BriefSettings; days: Record<string, BriefDay> }

export type AiEngine = 'ChatGPT' | 'Perplexity' | 'Gemini' | 'Claude' | 'Grok';
export interface AiPrompt { id: string; prompt: string; source: 'keyword' | 'user' }
export interface AiResult { id: string; promptId: string; prompt: string; engine: AiEngine; date: string | null; status: 'mentioned' | 'not-mentioned' | 'not-collected'; pos: number | null; cites: string[]; resp: string | null; collecting?: boolean }

export interface BacklinkPrefs { topics: string[]; max: 2 | 4 | 8; excludeCompetitors: boolean; outbound: boolean; qualify: boolean; autoApprove: boolean; minAuth: 30 | 50 | 70 }
export interface Proposal {
  id: string; direction: 'in' | 'out'; partnerBusinessId: string | null; partner: string; domain: string; about: string; fit: string; auth: number | null;
  page: string; pageTitle?: string; before: string; anchor: string; after: string; target: string; rel: string; disclosure: string;
  /** outbound only: the user's page (path) the sentence lives on */
  yourPage?: string; sentence?: string;
  decision: 'approved' | 'rejected' | 'auto' | null; note?: string | null;
}
export interface LiveLink { id: string; from: string; to: string; anchor: string; rel: string; since: string; status: 'live' | 'lost' | 'removal' | 'removed'; lastCheckedAt: string | null }
export interface BacklinksState { joined: boolean; prefs: Partial<BacklinkPrefs>; inbound: Proposal[]; outbound: Proposal[]; live: LiveLink[] }

export interface AiPrefs { writing: string; research: string }
export interface Member { id: string; userId: string | null; name: string | null; email: string; role: Role; status: 'active' | 'invited'; you: boolean }

export interface JobSummary { id: string; kind: string; status: 'queued' | 'running' | 'done' | 'failed'; progress: any; error: string | null; createdAt: string; ref: string | null }

export interface SiteStats { pages: number | null; articles: number | null; ranking: number | null; analyzedAt: string | null }

/** Per-business workspace — the client's "B". Loaded by GET /api/b/:bid/workspace. */
export interface Workspace {
  id: string; rev: number; role: Role; status: 'onboarding' | 'active';
  /** "today" in the business timezone, YYYY-MM-DD */
  today: string; tz: string;
  profile: Profile; edited: Edited;
  gsc: GscState;
  calendar: CalendarState;
  articles: Record<string, Article>;
  blog: BlogState;
  social: { packs: SocialPack[]; auto: SocialAuto };
  brief: BriefState;
  backlinks: BacklinksState;
  ai: AiPrefs;
  team: Member[];
  site: SiteStats;
  jobs: JobSummary[];
  /** Search Console query rows (last 28 days with data) for each profile keyword — exact, then normalized match. Empty when not connected. */
  measured: Record<string, { q: string; clicks: number; impr: number; ctr: number; pos: number } | null>;
  /** Suggested keywords (competitor gaps, GSC positions 20–40, profile needs) */
  kwSuggestions: KeywordSuggestion[];
  /** Server-computed counts for the sidebar and dashboard */
  counts: { briefOpen: number; review: number; backlinksPending: number; highSuggestions: number };
}

export interface BusinessSummary { id: string; name: string; domain: string; brand: Pick<Brand, 'logo' | 'primary' | 'secondary'>; status: 'onboarding' | 'active'; role: Role }

export interface Me { user: User; businesses: BusinessSummary[]; currentId: string | null }

/** RPC */
export interface ActResponse<T = any> { ok: boolean; data?: T; workspace?: Workspace; error?: string; code?: string }
