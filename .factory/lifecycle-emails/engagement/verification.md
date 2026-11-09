# Integrated engagement reminder verification

Frozen source SHA256 `036e3bd7c87d8cde09acaf00694df4418fa5fdd13501f6049614d741fa87f784`,488files. Algorithm: full relative POSIX-string sort of src/**,drizzle/**,next.config.ts; hash pathUTF8+NUL+rawbytes+NUL. PM and independent QA produced identical fingerprints. Source manifests are beside this record and under qa/.

## Integrated checks

- Full local database-backed suite:960passed,65external integration skips,one unchanged native-raster baseline failure across92files. Failure is src/server/ai/openrouter.qa.test.ts:202, same expected f883614e6a7dfb07 versus actual91d5409f50974af7 already recorded before this feature. No test/golden was weakened or hidden. Command npm test -- --no-file-parallelism with local Postgres radar_lifecycle_20261103 and development stubs; /tmp/radar-engagement-full-tests.log. Exit1 accurately reflects that known baseline exception.
- Optimized production build passed, dist.next-engagement-release, BUILD_ID VtQMuZSb-6yVqkxLp30R1; /tmp/radar-engagement-build.log.
- Current typecheck and diff checks passed. Next-generated TypeScript dist includes were restored to their original committed form after owned dev testing. No dependency/configuration change was required.
- Dedicated developer coverage includes15source/eligibility/batching/retry cases,9preference/link route cases,3publishing permanence/rollback cases and3worker rollout-readiness cases; all pass as part of the full run. The existing publish/billing/auth suites remain in that run.
- Independent QA:19policy/API/source/dispatch probes with actual billing gates and synthetic comp/lapsed accounts;21development browser checks;10desktop/mobile work-email renders;2actual readiness probes against migrated and empty local databases. Optimized-production browser22/22passed with an explicit read-only provider=stripe/enforced=true/status=comp proof, ordinary synthetic comp owner and a nonfunctional dummy Stripe key. That final run supersedes a provider-unconfigured production UI smoke. No billing/payment/provider action was made. A single20second modal-readiness timeout after a correct redirect did not reproduce on the final run; QA records it as a timing observation, not a confirmed defect. See qa/review.md for final results and environment limits.

## Defect closed

Independent QA found that signed-out email links lost the destination after signin. A narrow /email/open return-path validator now preserves only its expected businessId/kind/ref parameters for password/Google auth. Developer route regressions and independent browser retest pass. No arbitrary redirect or broader /api/email path allowance was introduced.

## Rollout

PR25 remains unmerged/undeployed. Web predeploy applies0009and0010before new web serves. Worker now probes the required schema read-only before starting jobs/scheduler/mail, waits up to120seconds if migrations are still running, then fails closed for platform restart. It never applies migrations itself. Source writes and reminder references commit together. Existing Resend sender/secrets and worker are reused; no infrastructure, billing setting, customer backfill or campaign changes.

All new reminder categories defaultoff. Enabling a category captures only future completed work; disabling tombstones pending category sources. Expected next actions permanently retire their reminder; first-attempt checks prune stale sections. Provider body/key remain immutable after an actual attempt; ambiguous attempts conservatively count toward the optional daily cap. A source acted on while a provider request is already in flight cannot retract that request; checks run immediately before dispatch, not as an inbox recall mechanism.

No production account, payment, customer email or social publication was mutated. No real provider requests were made in engagement tests. Local fake acknowledgments demonstrate transport behavior, not inbox delivery. The actual two-message Resend simulator proof from the original lifecycle release remains historical evidence for that recorded revision.

Owned QA app servers3935/3936 were stopped after final checks. Local static preview3934 remains for owner review. The tested source fingerprint was unchanged by QA documentation, generated screenshots or cleanup.
