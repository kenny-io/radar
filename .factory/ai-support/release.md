# Support release — 4 November 2026

User explicitly authorized deployment and real AI/email verification to support@thally.io. Clean managed release worktree on kenny/ai-support from origin/main f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49. Only support-owned code, the AppShell mount, README link and support records copied; source checkout and unrelated open PRs preserved.

Clean release checks: production build passed; typecheck passed; focused support20/20 passed; serial full suite756 passed186 skipped and one documented pre-existing image golden mismatch (expected f883614e6a7dfb07, actual91d5409f50974af7). No expectations modified. Prior independent local API/browser/production-mode evidence applies to unchanged support runtime files. No migration or dependency added.

Production preflight: web and worker successful on f9eb6178, public health healthy. Desired web config has production mode, stubs disabled, existing AI/mail credentials present, SUPPORT_INBOX=support@thally.io and MAIL_FROM=Radar <radar@thally.io>. Values of credentials were not printed. Resend thally.io sending domain verified.

PR27 merged as a73e2400931dd4e6ee8ff705892ef9e688bba260. The independently released signup-security PR26 subsequently merged as582e0eb74522881d9f772c8add6fab6f0bacbfa3, preserving support as an ancestor. Railway web d6cf14cb-f1bb-49a5-8fe0-0d4c23dcb075 and worker685c8e06-0620-4576-8d77-690b5f7387c6 succeeded on582e0eb7. Actual running web readback confirms revision, production mode, stubs0, correct support destination and provider configuration; public health200.

Live checks use the actual deployed support service through existing owner-authorized admin deployment access. They do not manufacture sessions, alter credentials, create accounts or change permissions. Normal Chrome owner sign-in encountered Google password reauthentication; user asked to complete login. Authenticated live browser coverage remains unrun. Independent public browser checks4/4 pass, including real endpoint401 for signed-out requests.

## Live findings and corrective release

- Initial normal publishing question returned the fixed human fallback in8726ms. Provider metadata shows the available Anthropic route reached the5-second timeout; account/refund question separately got a real, appropriately cautious response. AC2 was not marked passed for that initial result.
- Corrective change permits12seconds per provider HTTP request while retaining configured business model, failover and retries0. Route runtime budget180seconds covers conservative twelve-request schema-fallback waiting of144seconds. Focused22/22 and typecheck pass, including6.5-second real adapter-deadline regression and12-second failure recovery. Corrective build/deployment/retest pending.
- Exactly one labelled owner-authorized support handoff sent on582e0eb7. Outbox reference f0567b04-b2ab-4604-a675-e152ac28c6c4 is sent; same request UUID retry returns that same reference. Resend email01a1a772-e91d-7098-ba57-e9c5bc396829 independently reports delivered to support@thally.io at2026-11-04T16:44:48Z (20:44Dubai), with correct Radar sender and owner's reply contact. Release marker/reference/body match. Connected Gmail search did not expose the support inbox; no folder-placement claim. No second email is needed because the corrective change does not touch mail.

Rollback: revert only the support merge; no schema rollback required. Worker has no support-specific execution path.
