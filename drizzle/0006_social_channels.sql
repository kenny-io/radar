CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"ch" text NOT NULL,
	"remote_id" text NOT NULL,
	"name" text NOT NULL,
	"handle" text,
	"tokens_enc" text NOT NULL,
	"expires_at" timestamp with time zone,
	"expired" boolean DEFAULT false NOT NULL,
	"expired_at" timestamp with time zone,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_pubs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"sid" text NOT NULL,
	"src" text NOT NULL,
	"platform" text NOT NULL,
	"kind" text DEFAULT 'post' NOT NULL,
	"acct_id" uuid,
	"ch" text NOT NULL,
	"acct_label" text NOT NULL,
	"status" text NOT NULL,
	"date" date NOT NULL,
	"time" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"attempt_key" uuid,
	"stage" text,
	"claimed_at" timestamp with time zone,
	"retry_at" timestamp with time zone,
	"payload" jsonb,
	"remote_id" text,
	"remote_url" text,
	"posted_at" timestamp with time zone,
	"err" text,
	"err_code" text,
	"err_detail" text,
	"auto" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_pubs" ADD CONSTRAINT "social_pubs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_pubs" ADD CONSTRAINT "social_pubs_acct_id_social_accounts_id_fk" FOREIGN KEY ("acct_id") REFERENCES "public"."social_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_pubs" ADD CONSTRAINT "social_pubs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_pubs" ADD CONSTRAINT "social_pubs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_biz_ch_uq" ON "social_accounts" USING btree ("business_id","ch");--> statement-breakpoint
CREATE UNIQUE INDEX "social_pubs_biz_sid_uq" ON "social_pubs" USING btree ("business_id","sid");--> statement-breakpoint
CREATE INDEX "social_pubs_due" ON "social_pubs" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "social_pubs_acct" ON "social_pubs" USING btree ("acct_id","status");