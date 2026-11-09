CREATE TABLE "ai_miss_topics" (
	"business_id" uuid NOT NULL,
	"prompt_id" uuid NOT NULL,
	"series" text NOT NULL,
	"entry_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_miss_topics_business_id_prompt_id_series_pk" PRIMARY KEY("business_id","prompt_id","series")
);
--> statement-breakpoint
CREATE TABLE "ai_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"prompt_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"engine" text NOT NULL,
	"series" text NOT NULL,
	"day" date NOT NULL,
	"status" text NOT NULL,
	"pos" integer,
	"cites" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visibility_preferences" (
	"business_id" uuid PRIMARY KEY NOT NULL,
	"weekly_email" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_miss_topics" ADD CONSTRAINT "ai_miss_topics_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_miss_topics" ADD CONSTRAINT "ai_miss_topics_prompt_id_ai_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."ai_prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_miss_topics" ADD CONSTRAINT "ai_miss_topics_entry_id_calendar_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."calendar_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_observations" ADD CONSTRAINT "ai_observations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_observations" ADD CONSTRAINT "ai_observations_prompt_id_ai_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."ai_prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visibility_preferences" ADD CONSTRAINT "visibility_preferences_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_observations_series_day" ON "ai_observations" USING btree ("business_id","series","day");--> statement-breakpoint
CREATE INDEX "ai_observations_business_day" ON "ai_observations" USING btree ("business_id","day");--> statement-breakpoint
CREATE INDEX "lifecycle_report_business_sent_idx" ON "lifecycle_emails" USING btree ("business_id","sent_at") WHERE type = 'ai_weekly_report' AND status = 'sent';