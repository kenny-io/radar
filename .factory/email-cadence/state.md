# State

Branch `kenny-dev/radar-email-cadence-6eec24`, base `e7e597ef` (main). Owner approved the cadence on 2026-11-18. Not merged, not deployed.

| Task | Owner | Status | Covers | Scope |
| --- | --- | --- | --- | --- |
| EC-A | factory-architect | active | EC-01…EC-07 | Design in `architecture.md`: daily Autopilot email, standing problems, weekly work reminders, rollout |
| EC-E | factory-engineer | planned | EC-01…EC-07 | `src/server/services/autopilot/`, `src/server/services/lifecycle/engagement.ts`, `dispatch.ts`, their tests. Depends on EC-A |
| EC-P | PM | planned | EC-08 | `docs/EMAILS.md`, `.factory/lifecycle-refinement/schedule.md`, these records, the PR |
| EC-Q | factory-qa | planned | EC-01…EC-08 | Independent acceptance against the integrated revision. Depends on EC-E |

Dropped from scope: the "raw URL as preview text" seen in the owner's screenshot. The renderer sets a preheader for every work reminder (`templates.ts`); Gmail search results show the text around the search word, not the preview.

Next action: architect's design, then engineer.
