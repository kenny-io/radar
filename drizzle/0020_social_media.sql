CREATE TABLE "social_media_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"cache_key" text NOT NULL,
	"source_hash" text NOT NULL,
	"status" text NOT NULL,
	"stage" text NOT NULL,
	"request_version" uuid NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consumers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" text,
	"reserved_usd" double precision DEFAULT 0 NOT NULL,
	"actual_usd" double precision,
	"charged_characters" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_media_kind_check" CHECK ("social_media_generations"."kind" IN ('video','carousel','narration')),
	CONSTRAINT "social_media_status_check" CHECK ("social_media_generations"."status" IN ('preparing','queued','narrating','rendering','ready','failed','needs_attention','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "social_media_generations" ADD CONSTRAINT "social_media_generations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_media_cache_idx" ON "social_media_generations" USING btree ("business_id","kind","cache_key");--> statement-breakpoint
CREATE INDEX "social_media_lease_idx" ON "social_media_generations" USING btree ("status","lease_until");--> statement-breakpoint
CREATE INDEX "social_media_business_idx" ON "social_media_generations" USING btree ("business_id","updated_at");