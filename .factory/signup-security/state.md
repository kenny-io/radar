# State

Base f9eb6178. Final native worktree `/Users/ekene/.codex/worktrees/signup-security/radar-push`, branch kenny/signup-security-hardening. Shared checkout release/support edits preserved; only owned signup changes moved.

| ID | Owner | Responsibility | State |
|---|---|---|---|
| A1/A3 | factory-architect | Contracts, migration policy/security review | verified |
| A2 | factory-architect | Thally Turnstile reuse | verified secret; optional hostname gate documented |
| E1 | factory-engineer | Backend/schema/migration/regressions | verified |
| E2 | factory-engineer | Auth UI/optional widget/history security | verified |
| Q1/Q2 | factory-qa | Independent database/migration/browser/default-policy QA | verified, including production-mode smoke3/3 |
| P1 | PM | Integrated delivery and authorized production rollout | verified and released |

Final default is rate-only per user steering; optional exact RADAR_SIGNUP_TURNSTILE=1 remains strict/failclosed. Shared10/IP/hour,3/email/hour and300global/hour limits precede pending creation/email. Confirmation/Google trust/session fixes always apply.

Isolated full suite889passed65skipped1baseline raster mismatch, reproduced clean main. Backend50/50; independent50/50 +5policy checks; Chrome core5/5,widget3/3,hydration2/2,migration/history checks passed. Isolated typecheck/build and final production-mode Chrome smoke3/3 passed. No open implementation defect.

Released with explicit owner authorization: PR26 merged582e0eb7 and deployed safely. Current production085f1d88 retains identical signup security source after support-only PR28. Migration/cohort preservation, actual Gmail inbox receipt, live account confirmation/signin/signout/replay/quota and test cleanup verified. Final current-artifact Chrome6/6 passed. See release.md, release-architecture.md and release-qa.md. Turnstile remains off; optional activation gate documented.
