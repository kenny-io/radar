# Refresh publication recovery

Problem: production entry e_MCOBF9hZ (lived.ae) stores a refresh target as `/rent/dubai/1-bedroom-apartments`. The repository planner requires an absolute website URL, fails deterministically, and spends its correction attempt retrying immutable bad metadata. Production revision verified read-only: 75163f1ccf821fbe468c8a345aecb5b6de50fd2e.

Scope: normalize persisted refresh targets at the publisher boundary, preserve complete source URLs for future calendar/suggestion entries, and retain strict repository route identity checks. No UI, schema, auto-merge behavior, or production article mutations.

Acceptance:
- RP-1: Existing root-relative refresh targets become absolute business-site URLs in both refreshUrl and canonical, without editing saved articles.
- RP-2: Absolute CMS URLs, meaningful queries and SPA fragments retain identity; route changes are still rejected by repository validation.
- RP-3: Invalid/missing/non-web/unsafe targets fail clearly before hero/model/Git work. New articles retain null refreshUrl/canonical.
- RP-4: New refresh candidates and accepted suggestions retain the full source URL.
- RP-5: Focused publishing and affected regressions, typecheck, and independent QA pass on the integrated revision.

Delivery: reviewable isolated branch and PR against main. Repository production policy requires owner go-ahead before merge/deployment; final approval must follow concrete PR and test evidence. Existing customer failures are not retried as tests.

## Discovered structured-refresh blocker

Actual authorized retry after PR48 passed URL normalization, then plan and repair safely returned no changes: the existing editorial target is a typed registry record rather than a blog post. No remote draft or destination write occurred; saved article/body hashes remain unchanged.

- RP-6: A refresh may target an existing structured editorial page outside the blog. Source discovery and fresh review must trace its existing public route and discovery/navigation chain, without inventing a duplicate blog post.
- RP-7: When existing schemas cannot carry the complete host body, the planner may propose a minimal additive optional field and source-grounded conditional renderer. Only the target opts in; unrelated records, routes, structured data, interactions and legacy rendering survive. Host body tokens, exact edits, safety budgets and independent review remain mandatory.
- RP-8: Before follow-up release, a real-provider dry run on pinned actual destination source must produce an accepted complete integration, and independent destination build/browser/regression verification must pass. After release retry normal production action and verify actual result separately.

Follow-up scope: generic planner prompts and regression tests only. No site-specific adapter, new dependency/schema token, route change, mode conversion, guard weakening, or manual destination patch.

## User-requested failure UX and reporting

User explicitly requested customer-friendly publishing failures and issue reports sent to `kenny@thally.io` with subject `User Reported Issue on Radar`.

Resolved experience: failure banner reads “Radar is unable to publish this post. Your article is saved.” Primary action “Report issue to the team”; secondary Retry for users who can publish. While submitting, disable the report button and show Sending…; confirm Issue reported only after provider acceptance. A failed submission offers a safe retry message. Existing design components, responsive layout and toast conventions apply. Dashboard failure links to the article with the same simple message. Reporting is an explicit click, without an additional confirmation dialog.

- RP-9: Raw publishing diagnostics never appear in the article/dashboard UX or customer-facing calendar/job/SSE publishing payloads. Retain full persisted diagnostics for team investigation.
- RP-10: Authenticated workspace members can report a failed article with entryId only. Server loads tenant-scoped metadata/diagnostics, fixes the recipient/subject, excludes article body and secrets, applies existing support-equivalent mail limits, and deduplicates the same incident across clicks/reloads/members.
- RP-11: Show sent only after confirmed mail acceptance; provider failure is retryable with immutable persisted payload/idempotency key, stubs send no real mail. Browser QA covers desktop/mobile, sending/sent/failure states, safe details and permissions. After rollout, submit the authorized actual report while the article is failed, confirm delivery status, then retry publication.
