// Shared types — the contract between server and client.
// Shapes mirror 02-system.md §1 and the prototype's per-business state ("B").

export type Role = 'Owner' | 'Admin' | 'Editor' | 'Viewer';

export type Appearance = 'system' | 'light' | 'dark';
export interface User { id: string; name: string; email: string; appearance?: Appearance }

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
  publishError: { http: number; message: string; platform?: string; hint?: string } | null; publishedUrl: string | null;
}
export interface CalendarState { entries: CalendarEntry[]; settings: CalendarSettings; generatedAt: string | null }

export type Block = ['p' | 'h2' | 'h3', string] | ['ul', string[]];
export type ImageStyle = 'branded' | 'illustration' | 'photography' | 'infographic';
export interface VideoRef { id: string; title: string; channel: string; dur: string; views: string; why: string }
export interface Source { title: string; url: string; use: string; removed?: boolean; /** research notes (facts quoted from the source) — statistics in the draft must appear here */ notes?: string[] }
export interface ArticleBodyImage {
  id: string;
  /** Stable section identity plus the original heading index as a rename fallback. Empty heading = a headingless body. */
  after: { heading: string; occurrence: number; block: number };
  url: string; alt: string; prompt: string; seed: number;
}
export interface Article {
  entryId: string; generated: boolean; body: Block[];
  brief: { angle: string; outline: string[]; words: 900 | 1400 | 2200 };
  seo: { title: string; meta: string; slug: string };
  img: { style: ImageStyle; seed: number; prompt: string; /** Explicit custom requests require a model on later regenerations. */ modelRequired?: boolean; alt: string; url: string | null; /** `${style}:${seed}` the stored url was rendered for (stale url → render the template live) */ urlKey?: string | null };
  videos: string[]; videoMeta: VideoRef[]; sources: Source[];
  /** claim spans tied to sources: [blockIndex, text, sourceIndex] — used to flag claims when a source is removed */
  claims: { block: number; text: string; source: number }[];
  /** ISO time the last draft job finished (content area) */
  draftedAt?: string | null;
  /** Optional for articles created before inline illustrations were supported. */
  bodyImages?: ArticleBodyImage[];
  bodyImagesGeneratedAt?: string;
  /** when videoMeta (YouTube suggestions) was fetched */
  videoFetchedAt?: string | null;
}

export type ConnType = 'wordpress' | 'ghost' | 'webflow' | 'notion' | 'wix' | 'shopify' | 'wpcom' | 'webhook' | 'framer' | 'nextjs';
/** Connection as the client sees it — never contains secrets. */
export interface ConnectionPublic { id: string; type: ConnType; url: string; target: string | null; targetId?: string | null; f: Record<string, string>; secretHint?: string | null; status: 'ok' | 'error'; lastError?: string | null }
export interface BlogState { conns: ConnectionPublic[]; defaultId: string | null; mode: 'review' | 'autopilot'; autopilotAckAt: string | null; paused: boolean; tz: string; time: string; /** platforms this deployment can connect (OAuth apps configured) */ available?: string[] }

export type Platform = 'linkedin' | 'x' | 'facebook' | 'reddit' | 'quora';
export type PackStyle = ImageStyle | 'custom';
export interface SocialPost {
  text: string; style: PackStyle; seed: number; imageUrl: string | null; copiedAt: number | null; v: number;
  /** Size and type of the file at `imageUrl`, recorded when Radar renders it (social channels). Absent on older posts: the server checks the real file. */
  imageMeta?: MediaMeta | null;
  /** User direction for this platform, reused by Regenerate. */
  imagePrompt?: string;
  /** Latest in-flight image request; prevents stale renders replacing a newer image. */
  imageRequest?: string;
  /** Radar re-encoded the image to fit the platform's limits (Compress images). */
  compressed?: boolean;
  /** Publishing state from Radar (projected from `social_pubs` when `social.publishing`). Absent/null = never scheduled or posted by Radar. */
  pub?: Pub | null;
}
export interface SocialPack {
  id: string; name: string; source: { kind: 'idea' | 'url' | 'article' | 'suggest'; label: string; ref?: string | null };
  created: string; style: PackStyle; custom?: string; voice?: string; auto: boolean; posts: Partial<Record<Platform, SocialPost>>;
}
export interface SocialAuto {
  on: boolean; freq: 'daily' | 'custom'; days: string[]; platforms: Platform[]; style: ImageStyle; time: string;
  /** When a pack is ready: 'library' (default, also when absent) or 'schedule' (X and LinkedIn posts for the next day at `time`). Omitted from the workspace while publishing is off (absent = 'library'), and never acted on. */
  post?: 'library' | 'schedule';
}

/* ── Social channels (UPDATE-2026-10-23-social-channels; .factory/social-channels/architecture.md) ── */
/** A connectable account slot. One account per channel per business. */
export type SocialChannel = 'x' | 'li_profile' | 'li_page';
/** Connected account as the client sees it. Tokens never leave the server. */
export interface SocialAccount {
  id: string; ch: SocialChannel;
  /** X: display name. LinkedIn profile: member name. LinkedIn page: page name. */
  name: string;
  /** '@handle' (X only). */
  handle?: string | null;
  /** Token refresh failed, or (LinkedIn profile: no refresh token) the 60-day token reached its expiry: posts are held until the user reconnects. */
  expired?: boolean;
  /** When access ends without a reconnect (ISO). Set for LinkedIn profiles (60-day token, no refresh) and pages (365-day refresh token); absent for X (auto-refreshed). */
  expiresAt?: string | null;
}
/** Size and MIME type of an image file Radar would upload. */
export interface MediaMeta { bytes: number; type: string }
export type PubStatus = 'scheduled' | 'sending' | 'posted' | 'failed';
/** Why a pub failed (drives copy; `unknown` must not say "Nothing was published"). */
export type PubErrCode = 'rejected' | 'duplicate' | 'too_long' | 'media' | 'rate_limit' | 'unavailable' | 'auth' | 'quota' | 'unknown' | 'stale';
/** A post Radar scheduled or sent (handoff §1 `Pub`, plus server-computed fields). */
export interface Pub {
  status: PubStatus;
  /** Where it goes. Packs: the post's platform key. Brief: the item's platform when it was scheduled/posted (pinned; `pl` can't change while scheduled). */
  platform: 'x' | 'linkedin';
  /** YYYY-MM-DD and HH:MM in the business time zone (B.tz). Scheduled/sending: when it goes out. Posted: when it went out. Failed: when it was meant to go out. */
  date: string; time: string;
  /** The absolute instant of date+time in B.tz (ISO). Lock and past checks use this, never local clocks. */
  dueAt: string;
  /** SocialAccount.id; null after that account was disconnected (history only). */
  acct: string | null;
  /** Account label at send/schedule time ("@fieldnote", "Maya Chen", "Fieldnote · Page"), for history after a disconnect. */
  acctLabel?: string;
  /** User-facing error (failed only). One sentence, no trailing "Nothing was published." */
  err?: string | null;
  code?: PubErrCode | null;
  /** Posted: epoch ms. */
  at?: number | null;
  /** Posted: the live post URL (View on {Platform}). */
  url?: string | null;
  /** Daily Brief items only: posted or scheduled by Radar (not "I posted it"). */
  direct?: boolean;
  /** Server-computed: scheduled and its account is expired, so it is on hold. Never locked while held. */
  held?: boolean;
}
export interface SocialPage { id: string; name: string; followers: number | null }

export type BriefPlatform = 'reddit' | 'x' | 'linkedin' | 'hn' | 'quora';
/** Who a brief item is drafted for: the founder's personal account, or the company account (shown by business name). */
export type BriefAccount = 'founder' | 'company';
export interface BriefSettings { platforms: BriefPlatform[]; time: string; mention: 'asked' | 'relevant' | 'never'; /** Default both. */ accounts?: BriefAccount[] }
/** 'scheduled' is projected on read (never stored): the item has a scheduled or sending `pub`. It leaves the to-do list and counts.briefOpen. */
export type BriefItemState = 'open' | 'copied' | 'posted' | 'skipped' | 'expired' | 'scheduled';
export interface BriefItem {
  id: string; kind: 'reply' | 'post';
  /** Missing = 'founder' (items from before company drafting). */
  acct?: BriefAccount;
  plat?: BriefPlatform; where?: string; who?: string; url?: string; eng?: string; postedAt?: string; title: string; body?: string;
  replyTo?: { who: string; text: string } | null; asks?: boolean; fresh?: boolean;
  /** The community's rules forbid self-promotion: Radar drafted no mention variant (mention === help). */
  noMention?: boolean;
  /** The community's rules couldn't be read (found by search) */
  rulesUnknown?: boolean;
  plats?: BriefPlatform[]; pl?: BriefPlatform | null;
  tag: string; why: string;
  drafts: Record<string, string>; edits: Record<string, string>; mention: boolean; st: BriefItemState;
  /** Posts only: images Radar made for the post (Add visuals). null/absent = text only. */
  img?: BriefImages | null;
  /** Posted/scheduled by Radar (projected from `social_pubs` when `social.publishing`; always `direct: true`). */
  pub?: Pub | null;
}
export interface BriefImages {
  style: import('./imageOptions').StyleKey; seed: number;
  /** How many images (1–4; posts from before exact counts may have up to 5). */
  n: number;
  /** One per image, filled in as each one finishes; null while generating or if it failed. */
  urls: (string | null)[]; status: 'generating' | 'ready' | 'failed';
  /** Request identity survives remove/re-add races; jobId lets the UI recover from expired jobs. */
  request?: string; jobId?: string;
  /** Custom direction, retained for retries. */
  prompt?: string;
  /** User-safe failure detail for unavailable generation or a failed custom set. */
  error?: string;
  /** Custom image sets replace the current complete set only after every new image is stored. */
  pending?: { style: import('./imageOptions').StyleKey; seed: number; n: number; prompt: string };
  /** Parallel to `urls`: size/type recorded when each image is rendered (absent on older items). */
  meta?: (MediaMeta | null)[];
}
export interface BriefDay { date: string; scannedAt: string; items: BriefItem[]; stats?: Partial<Record<BriefPlatform, { read: number }>> }
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
  /** Server time when this workspace was built (ISO). Clients may use it to correct clock skew for lock/past checks. */
  now?: string;
  profile: Profile; edited: Edited;
  gsc: GscState;
  calendar: CalendarState;
  articles: Record<string, Article>;
  blog: BlogState;
  social: {
    packs: SocialPack[]; auto: SocialAuto; /** Last image setting used for social posts (Daily Brief included); the next default. */ img: import('./imageOptions').ImageSettings | null;
    /** Feature flag RADAR_SOCIAL_PUBLISHING for this business. Absent/false: no accounts, no pubs, and the UI is exactly as before this update. */
    publishing?: boolean;
    /** Connected accounts, at most one per channel (publishing only). */
    accounts?: SocialAccount[];
    /** Channels this deployment can connect: its OAuth app is configured (all three with RADAR_DEV_STUBS=1). */
    channels?: SocialChannel[];
  };
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
  /** Onboarding draft state (step, saved). Present on every workspace; meaningful while status = 'onboarding'. */
  onboarding?: OnboardingState;
}

/** `access: false` = the owner has no trialing/active subscription (billing on): hidden from the switcher, never current. Absent = true. */
export interface BusinessSummary { id: string; name: string; domain: string; brand: Pick<Brand, 'logo' | 'primary' | 'secondary'>; status: 'onboarding' | 'active'; role: Role; access?: boolean }

export interface Me { user: User; businesses: BusinessSummary[]; currentId: string | null }

/** RPC */
export interface ActResponse<T = any> { ok: boolean; data?: T; workspace?: Workspace; error?: string; code?: string }

// ── Gating, anonymous onboarding, trial billing (.factory/marketing-trial-gating/architecture.md §5) ──
export type SubStatus = 'none' | 'incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'unpaid' | 'canceled' | 'paused';
/** 'domain' / 'analyzing' are derived from jobs, as before. */
export type DraftStep = 'review' | 'gsc' | 'save';
export interface OnboardingState { step?: DraftStep; savedAt?: string; tz?: string; committedAt?: string }
export interface DraftSummary {
  id: string; domain: string; name: string;
  brand: Pick<Brand, 'logo' | 'primary' | 'secondary'>;
  step: DraftStep | null; savedAt: string | null; analyzed: boolean;
}
/** Signup pending variant (AC-S2). */
export type PendingProfile = Pick<DraftSummary, 'name' | 'domain' | 'brand'>;
/** The signed-in user's persisted billing account, independent of the selected business or billing gate. */
export interface BillingOverview {
  provider: 'stripe' | 'stub' | 'none';
  enforced: boolean;
  status: SubStatus | 'comp';
  priceCents: number;
  currency: 'usd';
  interval: 'month';
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canManage: boolean;
  everSubscribed: boolean;
}
export interface BillingState {
  /** false → billing off for this user; /start-trial redirects */
  enforced: boolean;
  provider: 'stripe' | 'stub' | 'none';
  /** ownAccess */
  access: boolean;
  status: SubStatus | 'comp';
  /** 'none' when access */
  mode: 'trial' | 'restart' | 'none';
  needsRestart: boolean;
  /** ISO: the subscription's trial_end, else the pending one, else a server preview (now + 3 days) */
  trialEnd: string | null;
  trialEndIsPreview: boolean;
  /** ISO, for the restart success copy */
  currentPeriodEnd: string | null;
  /** 100 for a trial; an open invoice's amount_due or PRICE_CENTS for a restart */
  dueTodayCents: number;
  priceCents: number; trialDays: number;
  /** drives "Back to your profile" (AC-G8) */
  hasDraft: boolean;
  draft: DraftSummary | null;
}
/** The publishable key is read on the server and passed as a prop (not NEXT_PUBLIC_*). */
export interface TrialPageProps { state: BillingState; publishableKey: string | null }
export interface OnboardingStageProps {
  /** 'none' = /start before the first POST /api/b */
  actor: 'guest' | 'user' | 'none';
  user: { name: string } | null;
  draft: DraftSummary | null;
  /** SaveStep label: true → "Save profile & open dashboard" */
  saveCommits: boolean;
  /** cleaned and validated ?domain= */
  autoDomain: string | null;
}
export interface AuthResult { ok: true; next: string }
