-- Custom data migration (architecture §21.2): grandfather every account that owns an active business at migration time.
-- Owners get a complimentary account, so nobody using Radar today is locked out when RADAR_BILLING is turned on (AC-R1).
-- Idempotent: re-running it only re-asserts comp. Guests never own active businesses; they are excluded anyway.
INSERT INTO "billing_accounts" ("user_id", "comp", "comp_reason")
SELECT DISTINCT b."owner_id", true, 'grandfather'
FROM "businesses" b
JOIN "users" u ON u."id" = b."owner_id"
WHERE b."status" = 'active' AND u."guest" = false
ON CONFLICT ("user_id") DO UPDATE SET "comp" = true, "comp_reason" = COALESCE("billing_accounts"."comp_reason", 'grandfather'), "updated_at" = now();
