ALTER TABLE "billing_accounts" ADD COLUMN "past_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brief_days" ADD COLUMN "acted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "last_active_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "activity_seen_at" timestamp with time zone DEFAULT now() NOT NULL;