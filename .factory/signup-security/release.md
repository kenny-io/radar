# Signup security production release — 4 November 2026

User explicitly authorized merging PR26, deploying, safely migrating existing accounts and verifying live signup/confirmation delivery. Completed.

- PR: https://github.com/kenny-io/radar/pull/26 — merged at16:41:01UTC (20:41:01Dubai), merge582e0eb74522881d9f772c8add6fab6f0bacbfa3; security implementationf322e597.
- Live: https://radar.thally.io. Initial security release webd6cf14cb-f1bb-49a5-8fe0-0d4c23dcb075 and worker685c8e06-0620-4576-8d77-690b5f7387c6 bothSUCCESS.
- Final observed production source085f1d88a83868b61c8cb0665dabea87f82180d3: webd06b23b4-ada3-4020-9120-edb23fe8b9d0 and worker2bad20bb-4a57-4495-9a9c-afecf7c7160a bothSUCCESS. Concurrent PR28 changes only support code/docs; signup/auth/session/migration/UI source is unchanged. Independent public browser checks reran on085f and passed6/6.

## Safe migration

A fresh private0600 pg_dump was transported as base64 over Railway SSH, decoded locally and verified through161TOC entries plus full SQL extraction to/dev/null (no customer-data restore into a development database). Archive7,054,780bytes and checksum remain private. Binary SSH output was rejected as corrupted and replaced before merge/migration.

Stopped original web8a979ad1 and confirmedREMOVED plus public health404 before merging. A concurrent support merge queued old-auth build1f1671d3; PM canceled that exact obsolete build and independently confirmedREMOVED. Target security migration/start occurred with old web absent; worker/DB kept running. No blanket revocation after reopening was necessary.

Independent pre/post/final cohort audits prove original5Google-only accounts preserved and verified; all6original sessions absent; all6businesses,6memberships and2billing rows match baseline full-row hashes. All9prior migration hashes preserved;0009 is the exact tested SQL hash, total10migrations. Final audit allows one legitimate new session belonging to the original cohort. No customer billing/subscription or publishing action changed. Runtime production, stubs disabled, rate-only protection, sender configured, billing remains on.

## Live proof

One unique owner-approved Gmail plusalias received one actual confirmation message at16:44:33UTC (20:44:33Dubai). Gmail INBOX label, exact recipient/subject and SPF/DKIM/DMARC pass were independently verified. Search connector rate limiting was bypassed through the owner's signed-in Gmail UI to locate the message ID; direct metadata read then worked. No claim relies only on provider acceptance. The provider's optional read API returned401; its outbound-body/RFC-correlation path was not used. The token was captured privately from the actual received Gmail preview and matched to the database SHA256.

Actual API checks passed: pending signup/no session/no password, protectedMe401, redacted production outbox, inbox confirmation creates the same verified identity and secureHttpOnly/Secure/Lax cookie, protectedMe200, replay400verification_invalid, signout revokes access, password signin succeeds, final test sessions/tokens0. No business, membership or billing row was created for the fixture. Three bounded resend attempts against the verified-or-removed fixture returned200/200/429, proving the three-per-mailbox hourly budget without extra mail.

Guarded cleanup at16:51:55UTC removed exactly1synthetic user,1own signup event and1redacted sent-outbox row. Exact ID/email/name/full creation timestamp and zero commercial/session/token/OAuth data were checked before deletion. No synthetic user remains; Gmail message retained. Private password/session/token values were removed after verification. Final cohort audit16:52:20UTC again proves original customers and business/billing data preserved.

Independent current-artifact Chrome6/6 at20:53:15–20:53:27Dubai covers desktop/mobile signup/no widget, validation/recovery copy, confirmation privacy/history, anonymous gates and hydration. No unexpected failures or browser exceptions. See release-architecture.md and release-qa.md; private booleans/count evidence is under ignored .data/signup-security/release/.

Default shared limits remain10/IP/hour across signup/resend,3/email/hour,300globally/hour. Turnstile remains off per user preference; enabling it later requires actual hostname/challenge acceptance. Real Google consent was not independently rerun by this release QA. Previous implementation checks remain889passed65external skips1unchanged image-golden failure, with typecheck/build passed; no new application source was changed during release.

Rollback must preserve credential/session revocations and the verified-user boundary. Use a forward fix or maintenance; do not deploy the old vulnerable authentication code or restore unsafe credentials. This record is release evidence, not an instruction to redeploy.
