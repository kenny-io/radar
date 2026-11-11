CREATE TABLE "email_verification_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"next" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_verification_user_idx" ON "email_verification_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_verification_expiry_idx" ON "email_verification_tokens" USING btree ("expires_at");--> statement-breakpoint
-- Previous Google logins checked email_verified. A legacy mixed password may have been planted
-- by somebody else before Google auto-linking: retain provider identity, remove that password.
UPDATE users SET email_verified_at = now(), password_hash = NULL WHERE google_sub IS NOT NULL AND NOT guest;
--> statement-breakpoint
-- End all real-user sessions at rollout. Password-only users must prove mailbox ownership;
-- Google users can immediately sign in again. Guests and all business/billing data are preserved.
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE NOT guest);
