ALTER TABLE "businesses" ADD COLUMN "autopilot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD COLUMN "autopilot_activation_id" text;--> statement-breakpoint
ALTER TABLE "social_pubs" ADD COLUMN "autopilot_activation_id" text;