CREATE TABLE "lifecycle_guide_states" (
	"user_id" uuid NOT NULL,
	"guide_id" text NOT NULL,
	"first_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"pending_email_id" uuid,
	"source_business_id" uuid,
	"status" text DEFAULT 'waiting' NOT NULL,
	"sent_at" timestamp with time zone,
	"reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifecycle_guide_states_user_id_guide_id_pk" PRIMARY KEY("user_id","guide_id"),
	CONSTRAINT "lifecycle_guide_id_check" CHECK ("lifecycle_guide_states"."guide_id" IN ('article_workflow', 'search_refresh')),
	CONSTRAINT "lifecycle_guide_status_check" CHECK ("lifecycle_guide_states"."status" IN ('waiting', 'queued', 'sent', 'skipped', 'blocked'))
);
--> statement-breakpoint
ALTER TABLE "lifecycle_guide_states" ADD CONSTRAINT "lifecycle_guide_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_guide_states" ADD CONSTRAINT "lifecycle_guide_states_pending_email_id_lifecycle_emails_id_fk" FOREIGN KEY ("pending_email_id") REFERENCES "public"."lifecycle_emails"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_guide_states" ADD CONSTRAINT "lifecycle_guide_states_source_business_id_businesses_id_fk" FOREIGN KEY ("source_business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lifecycle_guides_due_idx" ON "lifecycle_guide_states" USING btree ("due_at","user_id") WHERE status = 'waiting';--> statement-breakpoint
CREATE INDEX "lifecycle_guides_observe_idx" ON "lifecycle_guide_states" USING btree ("updated_at","user_id") WHERE status = 'waiting';