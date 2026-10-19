CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid,
	"task" text NOT NULL,
	"purpose" text,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" double precision,
	"ok" boolean NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"prompt_id" uuid NOT NULL,
	"engine" text NOT NULL,
	"date" date,
	"status" text DEFAULT 'not-collected' NOT NULL,
	"pos" integer,
	"cites" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resp" text,
	"raw" jsonb,
	"error" text,
	"collected_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"entry_id" text PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brief_days" (
	"business_id" uuid NOT NULL,
	"date" date NOT NULL,
	"scanned_at" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "brief_days_business_id_date_pk" PRIMARY KEY("business_id","date")
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"status" text DEFAULT 'onboarding' NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"profile" jsonb NOT NULL,
	"edited" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"site" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"kw_suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"calendar_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"calendar_generated_at" timestamp with time zone,
	"blog" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"social_auto" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"brief_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"brief_setup" boolean DEFAULT false NOT NULL,
	"backlinks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kw" text NOT NULL,
	"type" text NOT NULL,
	"vol" integer,
	"kd" integer,
	"date" date NOT NULL,
	"mode" text DEFAULT 'new' NOT NULL,
	"url" text,
	"measured" jsonb,
	"audience" text DEFAULT '' NOT NULL,
	"relevance" text DEFAULT '' NOT NULL,
	"dest" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"publish_error" jsonb,
	"published_url" text,
	"publish_attempts" integer DEFAULT 0 NOT NULL,
	"publish_remote" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"type" text NOT NULL,
	"url" text NOT NULL,
	"target" text,
	"target_id" text,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credentials_enc" text,
	"secret_enc" text,
	"status" text DEFAULT 'ok' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crawl_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"url" text NOT NULL,
	"path" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'page' NOT NULL,
	"h1" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cron_marks" (
	"key" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"business_id" uuid,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_connections" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'none' NOT NULL,
	"property" text,
	"progress" double precision DEFAULT 0 NOT NULL,
	"tokens_enc" text,
	"last_synced_through" date,
	"backfill_cursor" jsonb,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_rows" (
	"business_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"date" date NOT NULL,
	"key" text DEFAULT '' NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"ctr" double precision NOT NULL,
	"position" double precision NOT NULL,
	CONSTRAINT "gsc_rows_business_id_kind_date_key_pk" PRIMARY KEY("business_id","kind","date","key")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid,
	"kind" text NOT NULL,
	"ref" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" jsonb,
	"result" jsonb,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"singleton_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "keyword_cache" (
	"market" text NOT NULL,
	"language" text NOT NULL,
	"kw" text NOT NULL,
	"vol" integer,
	"kd" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keyword_cache_market_language_kw_pk" PRIMARY KEY("market","language","kw")
);
--> statement-breakpoint
CREATE TABLE "live_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"proposal_id" uuid,
	"from_url" text NOT NULL,
	"to_url" text NOT NULL,
	"anchor" text NOT NULL,
	"rel" text NOT NULL,
	"since" date NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"removal_requested_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"token_hash" text,
	"invited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid,
	"user_id" uuid,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"business_id" uuid,
	"provider" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"text" text NOT NULL,
	"html" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"partner_business_id" uuid,
	"data" jsonb NOT NULL,
	"decision" text,
	"note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"google_sub" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_prompts" ADD CONSTRAINT "ai_prompts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_results" ADD CONSTRAINT "ai_results_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_results" ADD CONSTRAINT "ai_results_prompt_id_ai_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."ai_prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_entry_id_calendar_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."calendar_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_days" ADD CONSTRAINT "brief_days_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_connections" ADD CONSTRAINT "gsc_connections_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_rows" ADD CONSTRAINT "gsc_rows_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_links" ADD CONSTRAINT "live_links_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_partner_business_id_businesses_id_fk" FOREIGN KEY ("partner_business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_packs" ADD CONSTRAINT "social_packs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_results_pe_uq" ON "ai_results" USING btree ("prompt_id","engine");--> statement-breakpoint
CREATE INDEX "cal_biz_date" ON "calendar_entries" USING btree ("business_id","date");--> statement-breakpoint
CREATE INDEX "cal_status" ON "calendar_entries" USING btree ("status","date");--> statement-breakpoint
CREATE UNIQUE INDEX "crawl_biz_url_uq" ON "crawl_pages" USING btree ("business_id","url");--> statement-breakpoint
CREATE INDEX "gsc_rows_lookup" ON "gsc_rows" USING btree ("business_id","kind","date");--> statement-breakpoint
CREATE INDEX "jobs_claim" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "jobs_biz" ON "jobs" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_singleton_uq" ON "jobs" USING btree ("singleton_key") WHERE status in ('queued','running');--> statement-breakpoint
CREATE UNIQUE INDEX "members_biz_email_uq" ON "members" USING btree ("business_id","email");--> statement-breakpoint
CREATE INDEX "members_user_idx" ON "members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notif_biz" ON "notifications" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "proposals_biz" ON "proposals" USING btree ("business_id","direction");--> statement-breakpoint
CREATE INDEX "packs_biz" ON "social_packs" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_uq" ON "users" USING btree ("google_sub");