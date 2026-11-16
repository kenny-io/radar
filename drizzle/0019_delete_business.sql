ALTER TABLE "businesses" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "purge_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_deleted_check" CHECK (
  ("status" = 'deleted') = ("deleted_at" IS NOT NULL)
  AND ("deleted_at" IS NULL) = ("purge_at" IS NULL)
  AND ("purge_at" IS NULL OR "purge_at" >= "deleted_at" + interval '168 hours'));--> statement-breakpoint
CREATE INDEX "businesses_purge_idx" ON "businesses" USING btree ("purge_at") WHERE status = 'deleted';