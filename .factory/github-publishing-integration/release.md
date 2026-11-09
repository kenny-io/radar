# Repository-aware publishing release

User authorization: “push and merge”, November 5, 2026.

Branch `kenny/github-publishing-integration` from current main `085f1d88`, isolated from the original checkout's unrelated changes. Scope is the fingerprint-verified publishing implementation, connector tests, existing GitHub help, TypeScript runtime dependency promotion, connector documentation and this feature's evidence.

The change replaces flat-file/layout dispatch with bounded source discovery, exact integration edits, source-grounded review/correction and atomic multi-file commits. Saved old publishing drafts receive the same integration planning. PRs remain drafts pending destination build/CI/preview verification. No database migration or runtime configuration change is needed.

Verified source hashes: planner `c94c066afec620714c5e75bf5735547197cd1625edfd375fc20e7f8eb38b28ac`; connector `5f3356c321d4f683f99a2d484fdb4737380db6964b37e5805915fb470d3087b6`.

Latest-main publishing/action suite: 312 passed, 51 reported skipped. Independent release QA: 47 contract/replay checks, typecheck and production build passed; all nine feature fingerprints unchanged before/after build; scoped diff and whitespace checks passed. See `release-qa.md`. Remote PR/check/merge/deployment evidence is pending at this preparation checkpoint. Earlier multi-layout, real-model, destination build/browser and safety evidence is in `general-qa.md` and `verification.md`.

Deployment follows the repository's existing main-merge automation for web and worker. Verify source revisions, both service statuses and read-only production smoke after merge. Do not republish a customer's article as a release test.

Rollback is a source revert on main covering the same feature files, with web and worker redeployed through the normal pipeline; no database rollback is required. Keep unrelated work and runtime credentials unchanged.
