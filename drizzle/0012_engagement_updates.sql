CREATE TABLE "engagement_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_key" text NOT NULL,
	"source_ref" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"eligible_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_reason" text,
	"lifecycle_email_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_email_preferences" ADD COLUMN "daily_brief" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_email_preferences" ADD COLUMN "calendar_reminders" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_email_preferences" ADD COLUMN "article_social" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_email_preferences" ADD COLUMN "daily_brief_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_email_preferences" ADD COLUMN "calendar_reminders_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_email_preferences" ADD COLUMN "article_social_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "engagement_events" ADD CONSTRAINT "engagement_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_events" ADD CONSTRAINT "engagement_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_events" ADD CONSTRAINT "engagement_events_lifecycle_email_id_lifecycle_emails_id_fk" FOREIGN KEY ("lifecycle_email_id") REFERENCES "public"."lifecycle_emails"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "engagement_source_uq" ON "engagement_events" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "engagement_due_idx" ON "engagement_events" USING btree ("user_id","eligible_at") WHERE resolved_at IS NULL;