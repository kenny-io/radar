# State
- Base: `main` `ead40f9b`. Branch `kenny-dev/radar-delete-business-36eee1`, worktree `.claude/worktrees/radar-delete-business-36eee1`.
- Delivery: pull request to `main`. No merge or deploy without the owner's go-ahead.
- Baseline on `ead40f9b`: typecheck clean; `vitest run` 4041 passed, 1 failed (`src/server/ai/openrouter.qa.test.ts`
  parity snapshot, known on `main`), 75 skipped.

| Task | Owner | Status | Covers | Notes |
| --- | --- | --- | --- | --- |
| T0 brief | PM | verified | brief | `brief.md` |
| T1 architecture | factory-architect | review | all | `architecture.md`; amendment for decision A (keep published images) in progress |
| F0 shared contract: migration, schema, types, delete/restore, routes, gates | factory-engineer | active | DEL-1..3, DEL-8, RES-2..4 | frozen after it lands |
| T2 server: queue, AI, publish/post checks, crons, backlinks, invites, email, stream, wipe, docs | factory-engineer | planned | DEL-4..7, PUR, E-2, E-3 | after F0; wipe last, after the architecture amendment |
| T3 UI: Settings section, dialog, `/restore`, onboarding line, leave-on-delete | factory-engineer | planned | DEL-1..4, RES-1, E-1 | after F0; files disjoint from T2 (architecture §11.1) |
| T4 independent QA | factory-qa | planned | all | browser pass on the integrated revision |
| T5 delivery | PM | planned | | pull request |

## Blockers
None.

## Next action
F0 report → PM confirms the contract → dispatch T2 and T3 in parallel.
