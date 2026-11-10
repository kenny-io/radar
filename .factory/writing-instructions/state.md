# State

Branch `kenny-dev/radar-custom-writing-instructions-2d11b9`, base `2d41a801`. Intended delivery: local commits, then a draft PR to main on the owner's go-ahead. No merge or deployment authorized.

| Task | Owner | Status | Depends on | Scope | Criteria |
|---|---|---|---|---|---|
| A1 design and contracts | factory-architect | verified | — | `.factory/writing-instructions/architecture.md`: storage, shared contract, prompt placement per call site, precedence wording, enforcement review, stub/QA observability, UI spec | all |
| E1 implementation | factory-engineer | verified | A1 | types/contract, save action, workspace projection, prompt sites, settings UI, profile link, tests, docs | WI1–WI11, QA1 |
| Q1 independent acceptance | factory-qa | verified | E1 | acceptance, regression, real-browser journey | WI1–WI11, QA1 |
| P1 integration and delivery | PM | active | Q1 | records, integrated checks, commits, handoff | — |

Status: owner authorized merge and deployment on 2026-11-10 (PR #44). Release head `6ae70e04` includes main `8dee7358`; checks re-run on it (`release.md`). Q1 accepted fingerprint `a1904d34fd81e524`; later changes (O1 fix, merge of main, revision-only autosave reply) were rechecked by the PM, not independently.

Open items for the owner: live-model compliance is unverified before release (stubs only); PM decisions D1–D4 in `brief.md` and the `DIVERGENCES.md` entry (status "Needs approval") await the owner's view. Next action: confirm both Railway deployments and the production check listed in `release.md`.
