import { pgTable, text, uuid, timestamp, jsonb, integer, boolean, doublePrecision, date, primaryKey, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const id = () => uuid('id').primaryKey().defaultRandom();
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  passwordHash: text('password_hash'),
  googleSub: text('google_sub'),
  /** Settings → Account → Appearance */
  appearance: text('appearance').$type<'system' | 'light' | 'dark'>().notNull().default('system'),
  createdAt: created(),
}, t => [uniqueIndex('users_email_uq').on(t.email), uniqueIndex('users_google_uq').on(t.googleSub)]);

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // sha256 of the cookie token
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: created(),
});

export const businesses = pgTable('businesses', {
  id: id(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  domain: text('domain').notNull(),
  status: text('status').$type<'onboarding' | 'active'>().notNull().default('onboarding'),
  timezone: text('timezone').notNull().default('America/New_York'),
  rev: integer('rev').notNull().default(1),
  profile: jsonb('profile').$type<any>().notNull(),
  edited: jsonb('edited').$type<Record<string, true>>().notNull().default({}),
  site: jsonb('site').$type<any>().notNull().default({}),
  kwSuggestions: jsonb('kw_suggestions').$type<any[]>().notNull().default([]),
  ai: jsonb('ai').$type<any>().notNull().default({}),
  calendarSettings: jsonb('calendar_settings').$type<any>().notNull().default({}),
  calendarGeneratedAt: timestamp('calendar_generated_at', { withTimezone: true }),
  blog: jsonb('blog').$type<any>().notNull().default({}),
  socialAuto: jsonb('social_auto').$type<any>().notNull().default({}),
  socialImg: jsonb('social_img').$type<any>(),
  briefSettings: jsonb('brief_settings').$type<any>().notNull().default({}),
  briefSetup: boolean('brief_setup').notNull().default(false),
  backlinks: jsonb('backlinks').$type<any>().notNull().default({}),
  createdAt: created(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const members = pgTable('members', {
  id: id(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').$type<'Owner' | 'Admin' | 'Editor' | 'Viewer'>().notNull(),
  status: text('status').$type<'active' | 'invited'>().notNull().default('active'),
  tokenHash: text('token_hash'),
  invitedAt: timestamp('invited_at', { withTimezone: true }),
  createdAt: created(),
}, t => [uniqueIndex('members_biz_email_uq').on(t.businessId, t.email), index('members_user_idx').on(t.userId)]);

export const crawlPages = pgTable('crawl_pages', {
  id: id(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  path: text('path').notNull(),
  title: text('title').notNull().default(''),
  kind: text('kind').$type<'article' | 'page'>().notNull().default('page'),
  h1: text('h1').notNull().default(''),
  description: text('description').notNull().default(''),
  text: text('text').notNull().default(''),
  links: jsonb('links').$type<string[]>().notNull().default([]),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('crawl_biz_url_uq').on(t.businessId, t.url)]);

export const gscConnections = pgTable('gsc_connections', {
  businessId: uuid('business_id').primaryKey().references(() => businesses.id, { onDelete: 'cascade' }),
  status: text('status').$type<'none' | 'skipped' | 'syncing' | 'connected' | 'error'>().notNull().default('none'),
  property: text('property'),
  progress: doublePrecision('progress').notNull().default(0),
  tokensEnc: text('tokens_enc'),
  lastSyncedThrough: date('last_synced_through'),
  backfillCursor: jsonb('backfill_cursor').$type<any>(),
  error: text('error'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** kind: 'date' (key=''), 'query' (key=query), 'page' (key=page url), 'qpage' (key=page url + '\t' + query; last-28-day aggregate stored on the window's last date) */
export const gscRows = pgTable('gsc_rows', {
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'date' | 'query' | 'page' | 'qpage'>().notNull(),
  date: date('date').notNull(),
  key: text('key').notNull().default(''),
  clicks: integer('clicks').notNull(),
  impressions: integer('impressions').notNull(),
  ctr: doublePrecision('ctr').notNull(),
  position: doublePrecision('position').notNull(),
}, t => [primaryKey({ columns: [t.businessId, t.kind, t.date, t.key] }), index('gsc_rows_lookup').on(t.businessId, t.kind, t.date)]);

export const calendarEntries = pgTable('calendar_entries', {
  id: text('id').primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  kw: text('kw').notNull(),
  type: text('type').notNull(),
  vol: integer('vol'),
  kd: integer('kd'),
  date: date('date').notNull(),
  mode: text('mode').$type<'new' | 'refresh'>().notNull().default('new'),
  url: text('url'),
  measured: jsonb('measured').$type<any>(),
  audience: text('audience').notNull().default(''),
  relevance: text('relevance').notNull().default(''),
  dest: text('dest'),
  status: text('status').notNull().default('proposed'),
  publishError: jsonb('publish_error').$type<any>(),
  publishedUrl: text('published_url'),
  publishAttempts: integer('publish_attempts').notNull().default(0),
  /** publishing area: the remote draft created for this entry ({ connId, id, url }) so retries reuse it instead of duplicating */
  publishRemote: jsonb('publish_remote').$type<any>(),
  createdAt: created(),
}, t => [index('cal_biz_date').on(t.businessId, t.date), index('cal_status').on(t.status, t.date)]);

export const articles = pgTable('articles', {
  entryId: text('entry_id').primaryKey().references(() => calendarEntries.id, { onDelete: 'cascade' }),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  data: jsonb('data').$type<any>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const connections = pgTable('connections', {
  id: id(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  url: text('url').notNull(),
  target: text('target'),
  targetId: text('target_id'),
  fields: jsonb('fields').$type<Record<string, string>>().notNull().default({}),
  credentialsEnc: text('credentials_enc'),
  secretEnc: text('secret_enc'),
  status: text('status').$type<'ok' | 'error'>().notNull().default('ok'),
  lastError: text('last_error'),
  createdAt: created(),
});

export const socialPacks = pgTable('social_packs', {
  id: text('id').primaryKey(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  data: jsonb('data').$type<any>().notNull(),
  createdAt: created(),
}, t => [index('packs_biz').on(t.businessId, t.createdAt)]);

export const briefDays = pgTable('brief_days', {
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  scannedAt: text('scanned_at').notNull(),
  items: jsonb('items').$type<any[]>().notNull().default([]),
  candidates: jsonb('candidates').$type<any[]>().notNull().default([]),
  /** Per-platform scan outcome for the day: threads read (all scans), so the page can say where nothing fit. */
  stats: jsonb('stats').$type<Record<string, { read: number }>>().notNull().default({}),
}, t => [primaryKey({ columns: [t.businessId, t.date] })]);

export const aiPrompts = pgTable('ai_prompts', {
  id: id(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  prompt: text('prompt').notNull(),
  source: text('source').$type<'keyword' | 'user'>().notNull(),
  createdAt: created(),
});

export const aiResults = pgTable('ai_results', {
  id: id(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  promptId: uuid('prompt_id').notNull().references(() => aiPrompts.id, { onDelete: 'cascade' }),
  engine: text('engine').notNull(),
  date: date('date'),
  status: text('status').$type<'mentioned' | 'not-mentioned' | 'not-collected'>().notNull().default('not-collected'),
  pos: integer('pos'),
  cites: jsonb('cites').$type<string[]>().notNull().default([]),
  resp: text('resp'),
  raw: jsonb('raw').$type<any>(),
  error: text('error'),
  collectedAt: timestamp('collected_at', { withTimezone: true }),
  /** Last time a collection was attempted (success or failure) — drives the "collecting" state during a run. */
  attemptedAt: timestamp('attempted_at', { withTimezone: true }),
}, t => [uniqueIndex('ai_results_pe_uq').on(t.promptId, t.engine)]);

export const suggestions = pgTable('suggestions', {
  id: id(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  data: jsonb('data').$type<any>().notNull(),
  state: text('state').$type<'open' | 'calendar' | 'dismissed'>().notNull().default('open'),
  createdAt: created(),
});

export const proposals = pgTable('proposals', {
  id: id(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  direction: text('direction').$type<'in' | 'out'>().notNull(),
  partnerBusinessId: uuid('partner_business_id').references(() => businesses.id, { onDelete: 'set null' }),
  data: jsonb('data').$type<any>().notNull(),
  decision: text('decision').$type<'approved' | 'rejected' | 'auto'>(),
  note: text('note'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: created(),
}, t => [index('proposals_biz').on(t.businessId, t.direction)]);

export const liveLinks = pgTable('live_links', {
  id: id(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  proposalId: uuid('proposal_id'),
  fromUrl: text('from_url').notNull(),
  toUrl: text('to_url').notNull(),
  anchor: text('anchor').notNull(),
  rel: text('rel').notNull(),
  since: date('since').notNull(),
  status: text('status').$type<'live' | 'lost' | 'removal' | 'removed'>().notNull().default('live'),
  removalRequestedAt: timestamp('removal_requested_at', { withTimezone: true }),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
});

export const jobs = pgTable('jobs', {
  id: id(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  ref: text('ref'),
  payload: jsonb('payload').$type<any>().notNull().default({}),
  status: text('status').$type<'queued' | 'running' | 'done' | 'failed'>().notNull().default('queued'),
  progress: jsonb('progress').$type<any>(),
  result: jsonb('result').$type<any>(),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lockedBy: text('locked_by'),
  singletonKey: text('singleton_key'),
  createdAt: created(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, t => [
  index('jobs_claim').on(t.status, t.runAt),
  index('jobs_biz').on(t.businessId, t.createdAt),
  uniqueIndex('jobs_singleton_uq').on(t.singletonKey).where(sql`status in ('queued','running')`),
]);

export const notifications = pgTable('notifications', {
  id: id(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }),
  userId: uuid('user_id'),
  payload: jsonb('payload').$type<{ msg: string; tone?: string; action?: { label: string; href: string } }>().notNull(),
  createdAt: created(),
}, t => [index('notif_biz').on(t.businessId, t.createdAt)]);

export const featureRequests = pgTable('feature_requests', {
  id: id(),
  userId: uuid('user_id').notNull(),
  businessId: uuid('business_id'),
  text: text('text').notNull(),
  createdAt: created(),
});

export const oauthStates = pgTable('oauth_states', {
  state: text('state').primaryKey(),
  userId: uuid('user_id'),
  businessId: uuid('business_id'),
  provider: text('provider').notNull(),
  data: jsonb('data').$type<any>().notNull().default({}),
  createdAt: created(),
});

export const outboxEmails = pgTable('outbox_emails', {
  id: id(),
  to: text('to').notNull(),
  subject: text('subject').notNull(),
  text: text('text').notNull(),
  html: text('html'),
  status: text('status').$type<'queued' | 'sent' | 'failed' | 'logged'>().notNull().default('queued'),
  error: text('error'),
  createdAt: created(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
});

export const aiCalls = pgTable('ai_calls', {
  id: id(),
  businessId: uuid('business_id'),
  task: text('task').notNull(),
  purpose: text('purpose'),
  model: text('model').notNull(),
  provider: text('provider').notNull(),
  latencyMs: integer('latency_ms'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costUsd: doublePrecision('cost_usd'),
  ok: boolean('ok').notNull(),
  error: text('error'),
  createdAt: created(),
});

export const keywordCache = pgTable('keyword_cache', {
  market: text('market').notNull(),
  language: text('language').notNull(),
  kw: text('kw').notNull(),
  vol: integer('vol'),
  kd: integer('kd'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.market, t.language, t.kw] })]);

/** Idempotency marks for scheduled work ("brief scan for biz X on date D already queued"). */
export const cronMarks = pgTable('cron_marks', {
  key: text('key').primaryKey(),
  createdAt: created(),
});

/** Impact log: one row per thing Radar did for a founder (append-only, used for reporting). Props hold counts, ids,
 *  platforms and URLs, never drafted text. Deleting a business or user detaches its events (anonymized counts remain). */
export const events = pgTable('events', {
  id: id(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'set null' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  ref: text('ref'),
  props: jsonb('props').$type<Record<string, any>>().notNull().default({}),
  createdAt: created(),
}, t => [index('events_kind_at').on(t.kind, t.createdAt), index('events_biz_at').on(t.businessId, t.createdAt)]);

/** Social channels (architecture.md §3): one connected account per channel per business. Tokens are encrypted
 *  ({access_token, refresh_token?, expires_at, refresh_expires_at?, scope, stub?}) and never leave the server. */
export const socialAccounts = pgTable('social_accounts', {
  id: id(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  ch: text('ch').$type<'x' | 'li_profile' | 'li_page'>().notNull(),
  /** X user id | LinkedIn person id (the profile app's OIDC sub) | LinkedIn organization id */
  remoteId: text('remote_id').notNull(),
  name: text('name').notNull(),
  handle: text('handle'),
  tokensEnc: text('tokens_enc').notNull(),
  /** Access token expiry (plain, for the refresh sweep). */
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  expired: boolean('expired').notNull().default(false),
  expiredAt: timestamp('expired_at', { withTimezone: true }),
  connectedBy: uuid('connected_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: created(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('social_accounts_biz_ch_uq').on(t.businessId, t.ch)]);

/** A post Radar scheduled or sent, keyed by its stable id (sid = 's:{packId}:{platform}' | 'b:{day}:{itemId}'). One row per sid
 *  for life; every write after a claim is conditional on attempt_key, so a post is never sent twice. */
export const socialPubs = pgTable('social_pubs', {
  id: id(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  sid: text('sid').notNull(),
  src: text('src').$type<'pack' | 'brief'>().notNull(),
  platform: text('platform').$type<'x' | 'linkedin'>().notNull(),
  kind: text('kind').$type<'post' | 'reply'>().notNull().default('post'),
  acctId: uuid('acct_id').references(() => socialAccounts.id, { onDelete: 'set null' }),
  ch: text('ch').$type<'x' | 'li_profile' | 'li_page'>().notNull(),
  acctLabel: text('acct_label').notNull(),
  status: text('status').$type<'scheduled' | 'sending' | 'posted' | 'failed'>().notNull(),
  /** Wall clock in businesses.timezone; due_at is derived from it. */
  date: date('date').notNull(),
  time: text('time').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  attemptKey: uuid('attempt_key'),
  /** 'media' | 'create' while sending (only 'create' failures have an unknown outcome) */
  stage: text('stage').$type<'media' | 'create'>(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  retryAt: timestamp('retry_at', { withTimezone: true }),
  /** Snapshot at claim: { text, media: [{ url, bytes, type }], manual } (for verify) */
  payload: jsonb('payload').$type<any>(),
  remoteId: text('remote_id'),
  remoteUrl: text('remote_url'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  err: text('err'),
  errCode: text('err_code'),
  /** Provider status/body excerpt: logs only, never shown, never in events. */
  errDetail: text('err_detail'),
  auto: boolean('auto').notNull().default(false),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: created(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('social_pubs_biz_sid_uq').on(t.businessId, t.sid), index('social_pubs_due').on(t.status, t.dueAt), index('social_pubs_acct').on(t.acctId, t.status)]);
