CREATE TABLE "education_enrollments" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"next_lesson" integer DEFAULT 0 NOT NULL,
	"next_due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_accepted_at" timestamp with time zone,
	"pending_email_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "education_version_check" CHECK ("education_enrollments"."version" = 1),
	CONSTRAINT "education_lesson_check" CHECK ("education_enrollments"."next_lesson" BETWEEN 0 AND 5),
	CONSTRAINT "education_status_check" CHECK ("education_enrollments"."status" IN ('active', 'completed', 'paused', 'blocked'))
);
--> statement-breakpoint
ALTER TABLE "user_email_preferences" ALTER COLUMN "daily_brief" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "user_email_preferences" ALTER COLUMN "calendar_reminders" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "user_email_preferences" ALTER COLUMN "article_social" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "user_email_preferences" ADD COLUMN "education" boolean;--> statement-breakpoint
ALTER TABLE "education_enrollments" ADD CONSTRAINT "education_enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "education_enrollments" ADD CONSTRAINT "education_enrollments_pending_email_id_lifecycle_emails_id_fk" FOREIGN KEY ("pending_email_id") REFERENCES "public"."lifecycle_emails"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "education_due_idx" ON "education_enrollments" USING btree ("next_due_at","user_id") WHERE status = 'active' AND pending_email_id IS NULL;--> statement-breakpoint
CREATE INDEX "users_education_eligible_idx" ON "users" USING btree ("email_verified_at","id") WHERE NOT guest AND email_verified_at IS NOT NULL;