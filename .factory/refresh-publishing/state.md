# State

Base: origin/main 75163f1c. Branch: kenny/fix-refresh-publishing. Original dirty checkout preserved.

- ARCH-1: verified. factory-architect confirmed source mismatch and approved frozen implementation.
- ENG-1: verified. factory-engineer implemented publisher normalization, future refresh URL persistence and regression tests; 105 focused tests passed.
- QA-1: verified. factory-qa independently passed 23 probes and 412 broader tests, 66 external/DB harness skips; Node 22 typecheck and final report passed.
- PM-1: active delivery. Node22 production build passed. Preparing reviewable PR.

No migration or runtime configuration change. Normalizing on read repairs saved relative targets on retry without editing stored article data. Original route-preservation and draft-PR semantics remain enforced.

No merge, deployment, production data changes, or customer retry performed. Repository owner approval required before auto-deploying main merge. After approval: merge, verify web/worker revisions and health, retry the reported entry once through its normal action, inspect the resulting outcome; do not merge the destination article PR as part of this repair.
