# Weekly Radar education

User request: prepare and wire educational emails covering all five Radar features, sent to everyone on a weekly cadence. This supersedes the earlier pre-trial-only editorial plan. Audience includes existing and new registered accounts across pre-trial, trial, paid, complimentary and lapsed access. Preserve recipient opt-outs and applicable delivery suppression; never send to anonymous guests or unverified addresses.

## Experience

One useful lesson per week, five lessons total: AI Visibility, Daily Brief, Backlinks, Organic Search, Social Marketing. Each has a clear subject, a brief reason to use the feature, exactly two practical actions, a way to check progress and a feature CTA. Business-name personalization has a neutral fallback. Instructions remain useful for pre-trial/lapsed accounts without implying their scans or content already exist. Signing in preserves the destination; billing/access gates still apply. No guaranteed AI recommendations, SEO gains, invented performance claims or automatic posting.

Use existing Radar email brand, compact buttons, HTML/plain text and first-party links. Provide a complete local preview gallery and readable copy. Settings → Emails exposes a separate weekly education preference. Signed one-click unsubscribe stops education only; earlier optional-email optouts must not be silently bypassed. No changes to billing/security delivery.

User steering: all emails should be eligible by default, without a prior email-preference opt-in. Provide an Email preferences button in every email footer and honor the recipient’s opt-out. Apply this to educational and work/usage emails; event-specific messages still require their factual trigger. Remove default-off work-reminder/source-consent gating while preserving known explicit opt-outs and avoiding historical reminder floods. This supersedes the prior opt-in-only reminders design, not billing/security trigger semantics. An operational release pause is distinct from recipient defaults.

## Acceptance criteria

- EDU-01: Five polished, fact-checked, personalized lessons cover all five features with two actions and a progress check; correct links and escaping.
- EDU-02: All eligible existing/new registered accounts can enroll once, across all access states; deterministic account/business context and safe fallback. No guest, unverified or opted-out sends.
- EDU-03: First lesson starts at enrollment in business-local daytime, next lessons are at least seven days apart after actual attempts/delivery as resolved in architecture. No repeated lessons, catch-up bursts, endless loops or per-business duplicates.
- EDU-04: Durable outbox, concurrency protection, bounded/retry-stable sending, send-time preference/recipient/context checks and shared optional-mail frequency limits.
- EDU-05: Independent Settings preference, authenticated persistence, signed anonymous unsubscribe and one-click header behavior; billing/security/work reminder preferences preserved.
- EDU-06: Migration/startup readiness, operational enrollment/activation/rollback notes, tests and render/browser evidence. Existing lifecycle release dependency is explicit.
- EDU-07: Reviewable branch/PR includes full copy and previews. No live recipient send, merge or deploy before concrete release review under existing repository authorization.

## Delivery

Isolated worktree: `/Users/ekene/.codex/worktrees/radar-weekly-education/radar-push`, branch `kenny/weekly-education`, base `5183db55` from pending PR25. Preserve source branch and unrelated search-indexing changes. Architect resolves contracts; engineer owns runtime/schema/preferences plumbing; PM owns copy and previews; independent QA verifies integrated behavior. Reconcile PR26 verification changes before delivery. No new provider or dependencies.
