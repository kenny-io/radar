# Support release — 4 November 2026

User explicitly authorized deployment and real AI/email verification to support@thally.io. Clean managed release worktree on kenny/ai-support from origin/main f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49. Only support-owned code, the AppShell mount, README link and support records copied; source checkout and unrelated open PRs preserved.

Clean release checks: production build passed; typecheck passed; focused support20/20 passed; serial full suite756 passed186 skipped and one documented pre-existing image golden mismatch (expected f883614e6a7dfb07, actual91d5409f50974af7). No expectations modified. Prior independent local API/browser/production-mode evidence applies to unchanged support runtime files. No migration or dependency added.

Production preflight: web and worker successful on f9eb6178, public health healthy. Desired web config has production mode, stubs disabled, existing AI/mail credentials present, SUPPORT_INBOX=support@thally.io and MAIL_FROM=Radar <radar@thally.io>. Values of credentials were not printed. Resend thally.io sending domain verified.

Release/live verification pending: merge support PR, confirm Railway web source/status and actual runtime environment, test useful real AI answers and explicit one labelled support handoff, confirm provider delivery and receipt if accessible. Real Chrome owner sign-in encountered Google password reauthentication; user asked to complete normal login. No sessions manufactured and no account/security changes made.

Rollback: revert only the support merge; no schema rollback required. Worker has no support-specific execution path.
