# Main integration independent QA plan

Baseline lifecycle delivery: 96b3d730. Incoming deployed main: b38b67a4d48c51f39bd5fc68e1fc4143a9633060 (Autopilot migration 0010). Runtime engineer owns merge and unpublished migration renumbering to 0011–0014. QA owns this directory only, with no implementation edits, provider calls, production writes, merge or deployment.

Re-read lifecycle brief/architecture and inspect incoming Autopilot brief/architecture, mail transport, handoff, activation controls and deep-link guard. Existing prior evidence remains scoped to its fingerprint; this report will explicitly name the new integrated source/build.

Check merge semantics at shared Settings, safeBusinessHop + email next allowlist, verified sign-up/invitation, article/calendar/work hooks, Autopilot activation provenance and unchanged lifecycle timing/caps. Article workflow copy must describe review conditionally because enabled Autopilot can publish without review. Include the new plaintext Autopilot action handoff in the complete numbered catalogue.

Independent adversarial cases: failed mail retry must retain key/body; duplicate finished work does not post again; concurrent provider calls are only safe with an identical provider key; missing/changed/unverified owner must not leak prepared drafts. Activation revoked or owner changed must block handoff. Source URLs must exclude javascript/data, business links must survive selected-workspace change and login, foreign business remains denied. Anonymous email optout and account controls still work. Preserve auth encrypted development capture and production redaction.

Migration checks: clean, actual deployed main through 0010 then upgrade, and pre-guide through new 0013 then 0014. Assert original main migration SQL/journal hashes preserved; Autopilot business state/provenance, queued handoff work and persisted legacy payload remain unchanged; no enroll/backfill; explicit off/course progress/attempted payload retained where tables exist. Readiness must reject a deployment missing 0014. Fixture cleanup must respect pending email foreign keys.

After runtime handoff: fresh local DB, affected QA/developer tests serially, real Chrome Settings/invitation/signup/guide/deep-link flows, new numbered catalogue actual-renderer desktop/mobile checks and final optimized smoke. No worker or live provider. Final source fingerprint after generated configuration restore; distinguish existing image baseline from regressions. Report open defects promptly to PM and engineer.
