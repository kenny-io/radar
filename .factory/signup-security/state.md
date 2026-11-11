# State

Base f9eb6178. Final native worktree `/Users/ekene/.codex/worktrees/signup-security/radar-push`, branch kenny/signup-security-hardening. Shared checkout release/support edits preserved; only owned signup changes moved.

| ID | Owner | Responsibility | State |
|---|---|---|---|
| A1/A3 | factory-architect | Contracts, migration policy/security review | verified |
| A2 | factory-architect | Thally Turnstile reuse | verified secret; optional hostname gate documented |
| E1 | factory-engineer | Backend/schema/migration/regressions | verified |
| E2 | factory-engineer | Auth UI/optional widget/history security | verified |
| Q1/Q2 | factory-qa | Independent database/migration/browser/default-policy QA | verified, including production-mode smoke3/3 |
| P1 | PM | Isolated full tests/typecheck/build/reviewable PR | verified locally; draft PR delivery |

Final default is rate-only per user steering; optional exact RADAR_SIGNUP_TURNSTILE=1 remains strict/failclosed. Shared10/IP/hour,3/email/hour and300global/hour limits precede pending creation/email. Confirmation/Google trust/session fixes always apply.

Isolated full suite889passed65skipped1baseline raster mismatch, reproduced clean main. Backend50/50; independent50/50 +5policy checks; Chrome core5/5,widget3/3,hydration2/2,migration/history checks passed. Isolated typecheck/build and final production-mode Chrome smoke3/3 passed. No open implementation defect.

Delivery target: draft PR, unmerged/undeployed. Production requires actual email receipt/provider acceptance and documented migration traffic drain/session revocation. Optional widget hostname/challenge verification is not a release gate for default rate mode. No production mutation occurred.
