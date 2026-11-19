# E7B — Bounded merged-main review

Reviewed merged media/main base `40e0f092a73a54fed0bc826208e46f1af024d21e` (media `d6106456` + main/A6 `4d235bae`). Read-only source review: no implementation, provider, paid generation, production, Git or preference changes. Subsequent A7A changes belong to E7U and are not covered by this baseline acceptance.

- **183/183 tests passed**: media pipeline/timeline, AI admission/routing, storage/delete, worker readiness,22A6 database lifecycle cases and12lifecycle unit cases. Synthetic local DB only. Log `/tmp/radar-media-merged-review/tests.log`.
- Migration0020 SQL/Drizzle snapshot/journal are consistent with merged schema: copied migration folder + Drizzle generate reports **No schema changes**. Scratch output/log `/tmp/radar-media-merged-review/schema.log`.
- Prior architecture fixes remain present: authoritative content hashes and Generate/pre-voice/pre-attach freshness checks; required quote/occurrence/target drawing cues mapped through actual alignment and versioned/font-aware caches; explicitly estimated speech accounting with nullable actual USD; durable bounded network cache cleanup outside scheduler; render lock-session loss abort; current request/lease/media revision fencing and pending-consumer reconciliation.
- A6 noResend/needsApproval predicates survive claim/upsert/recovery/attempt writes. Generated-media attachment writes pack JSON, not publication payloads, and cannot clear those markers. Posted/sending/near-send rows prevent replacement; pending generation reaches publisher preflight. Fresh current pack reads avoid restoring scrubbed cached pub data. No claim is made that all A7A standing-default scenarios are verified.
- Worker-only pinned Node22 Dockerfile includes FFmpeg/ffprobe/local fonts, nonroot runtime and existing worker start command; web keeps its build. Readiness checks both media authority table/cache index and prior schema capabilities.

Review found a residual FK lock-order risk: media admission took pub/pack locks before INSERTgeneration/jobs implicitly acquired business KEY SHARE, opposing A6 businessFORUPDATE → pub → pack. Reported to PM/E7U without editing. E7U subsequently added explicit scoped businessFORKEYSHARE before pub locks in both `requestMediaIntent` and `generateMedia`; presence verified read-only. The final admission-vs-disconnect race test is assigned to independent Q7.

Minor note sent PM: business profile/brand voice and marketing context are present; per-pack voice participates cache invalidation but was not included in narration prompt at review start. Any later adjustment needs final integrated verification.

PM accepted this as merged **baseline** evidence and requested stop to free the slot. A7A is still changing; no final A7A fingerprint or release-readiness claim is made. Q7 owns final source fingerprint, independent browser/DB/race acceptance after E7U freezes. No further work by E7B until a specific defect is dispatched.
