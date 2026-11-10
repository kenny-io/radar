# Release

Owner authorized merge and deployment on 2026-11-10 (PR #44). This file was written before the merge; it records the plan and the prior state, not the outcome. Confirm the outcome from the Railway deployments for the merge commit.

Target: https://radar.thally.io, Railway `radar` / `production`. A merge to `main` triggers both `web` and `worker`. No migration, no new runtime variables, no infrastructure change. Instructions live in the existing `businesses.ai` column, so web and worker may come up in either order; an older process ignores the key.

Release branch head `6ae70e04`: the feature commit, a merge of main `8dee7358` (two doc conflicts in `docs/CONTRACTS.md` and `DIVERGENCES.md`, both sections kept), and one change so instruction autosaves ask for the revision-only reply introduced on main.

Verification on the release head (see `verification.md` for the earlier runs):
- Typecheck and build pass.
- Full suite with a throwaway Postgres, serial: 1,767 passed, 65 skipped, 1 failed (the known raster golden in `src/server/ai/openrouter.qa.test.ts`, same hash line as baseline).
- PM browser recheck of Settings → Writing instructions as Owner against the merged code: save, reload, over-limit kept across leaving, save-in-flight race, failed save and retry, platform row add with focus, revision-only replies (`{ ok, data, rev }`), 7 event rows with no instruction text. Not independently re-verified after the merge. Generation on the merged code is covered by the suite only.
- Known wart: with main's sticky error toasts, the "couldn't save" toast stays after a successful retry until dismissed.

Prior active release: main `8dee7358`; web deployment `ea2d00f0-1e9e-489f-96fc-12af1fc5af86`, worker `c5e9f3e9-8930-4296-a76d-a501e05bb340`, both SUCCESS.

Rollback: revert the merge commit on main and confirm both services redeploy, or redeploy both prior deployments. No data rollback is needed; saved instructions stay in `businesses.ai.instructions` and are ignored by older code. One caution: the older `settings.ai` action rewrites the whole `ai` column, so after a rollback a model change would erase saved instructions.

After deploy: check `/api/health`, both deployments SUCCESS on the merge commit, worker start-up logs, and the Settings section in production. Live-model compliance needs one real generation with a saved instruction.
