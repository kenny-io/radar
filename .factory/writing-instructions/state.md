# State

Branch `kenny-dev/radar-custom-writing-instructions-2d11b9`, base `2d41a801`. Intended delivery: local commits, then a draft PR to main on the owner's go-ahead. No merge or deployment authorized.

| Task | Owner | Status | Depends on | Scope | Criteria |
|---|---|---|---|---|---|
| A1 design and contracts | factory-architect | verified | — | `.factory/writing-instructions/architecture.md`: storage, shared contract, prompt placement per call site, precedence wording, enforcement review, stub/QA observability, UI spec | all |
| E1 implementation | factory-engineer | verified | A1 | types/contract, save action, workspace projection, prompt sites, settings UI, profile link, tests, docs | WI1–WI11, QA1 |
| Q1 independent acceptance | factory-qa | verified | E1 | acceptance, regression, real-browser journey | WI1–WI11, QA1 |
| P1 integration and delivery | PM | active | Q1 | records, integrated checks, commits, handoff | — |

Status: tested and committed locally on this branch; not pushed, no PR, not merged, not deployed. Q1 accepted fingerprint `a1904d34fd81e524` with one low UX observation (O1: over-limit text dropped on leaving the section). The PM fixed O1 in `src/features/settings/WritingInstructions.tsx` and rechecked it in the browser; final fingerprint `abe117019402f660`, with typecheck, full suite and build re-run on it (`verification.md`). Baseline exception: the known raster golden in `src/server/ai/openrouter.qa.test.ts`.

Open items for the owner: live-model compliance is unverified (stubs only); PM decisions D1–D4 in `brief.md` and the `DIVERGENCES.md` entry (status "Needs approval") await the owner's view. Next action: draft PR to main on the owner's go-ahead.
