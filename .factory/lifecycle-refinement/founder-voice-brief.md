# Founder voice correction

User approved the catalogue with corrections: every user email should sound like Ekene personally helping the reader get business wins with Radar; singular “I built Radar”, never a corporate marketing team. Remove the trial-ending cancellation reminder entirely. Use subscription language and include amounts only where necessary. Preserve the review catalogue numbers.

Baseline: clean `5f7c56ab`, PR #25, current-main Autopilot integrated. All revisions remain unshipped. No new campaign, recipient expansion, migration, customer send or deployment.

Acceptance:

- FV-01: Personal founder voice throughout the actual lifecycle, lesson, guide, security/invitation/backlink/Autopilot and separate local report builders. Consistent Ekene/Founder, Radar sign-off; no invented claim that Ekene manually inspected results or wrote each draft.
- FV-02: Founder sender display preserves the configured verified sending address; existing monitored founder reply destination is used consistently. Security links, roles, tenant checks, measurements and optional delivery rules remain intact.
- FV-03: No new trial-ending reminder is queued and existing pending reminders cannot send. Preserve delivery/attempt history and keys, with no rekey or replay. Catalogue #5 is marked retired rather than reused.
- FV-04: Billing refers to the Radar subscription. Trial confirmation is useful onboarding with end-date/automatic continuation facts and subscription controls, without a cancellation prompt or unnecessary prices. Actual receipt amounts remain where useful; routine failed-subscription mail does not repeat a price.
- FV-05: Regenerate all actual-source previews and numbered full copy, preserving references and truthful live/local/release boundaries. Independently verify changed behavior, actual sender metadata, voice/facts, mobile rendering and reading controls. Update the existing PR with a coherent tested change.

PM owns all editorial builders and previews/docs. Architect owns retirement/sender design. Engineer owns runtime retirement, sender transport/identity and focused regressions. Independent QA owns `.factory/lifecycle-refinement/qa/founder-voice/`. The separate original report stays local and is captured in an additional exact companion patch without overwriting prior patches or unrelated original-checkout work.
