# Founder voice correction verification

User approved the prior catalogue with a clear correction: write as Ekene personally helping each reader get useful business results with Radar; singular “I built Radar”; retire the trial-ending cancellation reminder; use subscription wording and amounts only where necessary. Scope and acceptance are in `founder-voice-brief.md`; runtime and retry-safe sender design are in `founder-voice-architecture.md` and `founder-voice-runtime.md`.

## Frozen founder checkpoint

Starting source `5f7c56ab`, plus the frozen correction. Independent final source SHA256 `ec983db607f8540a6dbadf6fda21c088a4fc11e13a436d7c41e12402095d1d8e`, **617 files**. Node 22.18.0, local disposable Postgres on port54329, fake provider transports and synthetic users only. Complete independent evidence: `qa/founder-voice/report.md` and `copy-review.md`.

- Personal founder copy across all actual user-facing builders, consistent Ekene / Founder, Radar sign-off, founder display **Ekene from Radar**, reply **team@thally.io** and unchanged configured verified mailbox. No fabricated personal review of generated results/drafts.
- #5 retired at subscription collection, direct queue and before decrypt/provider dispatch, including future queued/attempted/stale-claim reminders. History/keys/attempt counts stay intact; an already in-flight accepted request cannot be recalled. Other subscription events and internal operational forwards remain.
- Routine amounts/cancellation prompts removed from trial-start email; end date, automatic subscription continuation and credit remain. Subscription receipts retain actual paid amount when available; failed-subscription notices omit the amount.
- **28 active families / 68 variants, 29 numbered slots with #5 reserved as retired**. Existing references unchanged. Old #5 files show retirement notice. Reading/gallery include actual sender metadata with explicitly fictional preview address.
- Additive0015 nullable sender_meta snapshots NEW general-outbox identity before provider calls; oldNULL legacy identity and existing frozen lifecycle payloads remain unchanged. Internal feature forwarding retains service identity; support forwarding keeps customer reply-to. MAIL_FROM configuration itself is not renamed, preserving legacy retries.

| Check | Result | Evidence |
| --- | --- | --- |
| Fresh full database suite | 1,256 pass,65 external skips, one existing raster golden failure | founder-voice-full-suite.log |
| Optimized build | Pass, BUILD_ID CiMpQWcgFPwNpn-YQxGIH | founder-voice-build.log |
| Final restored-config typecheck | Pass | founder-voice-typecheck.log |
| Engineer affected suite | 176 pass, including16 founder/retirement cases | founder-voice-runtime.md |
| Independent retirement/wire/legacy tests |22/22 pass | qa/founder-voice/report.md |
| Independent affected developer tests |97/97 pass | qa/founder-voice/report.md |
| Independent companion tests |42/42 pass | qa/founder-voice/report.md |
| Current mobile/desktop renders |136/136,68 active variants | qa/founder-voice/report.md |
| Catalogue browser |11/11 pass | qa/founder-voice/report.md |
| Optimized smoke |6/6 pass | qa/founder-voice/report.md |
| Clean/0014→0015/no-op migrations | All16 entries, no old metadata backfill | founder-voice-migrations.json; independent proof |
| Worker readiness | Current accepted / prior refused,2/2 | qa/founder-voice/report.md |

The raster failure is the unchanged expected `f883614e6a7dfb07` versus actual `91d5409f50974af7`, independently established on clean main-family source earlier. The full suite is not described as all green. Source/image golden were not changed to relax this check.

Separate original report companion: exact six-file patch SHA256 `d4a1d17ff843bd8ab5afe907837112c7a4a3515881ab0c81ddcb1b23843411a6`,42 tests, original typecheck and reverse apply check pass. New report-job metadata is immutable; old jobs stay legacy. This is not a generic mutable-override guarantee and does not approve the original unmerged measurement feature for release. See `founder-voice-companion.md` for its existing eligibility/migration/real-queue/browser gates.

## Delivery boundary

No customer sends, real provider requests, production writes, charges, main merge, deployment or activation. The correction is delivered on existing PR #25, pending owner go-ahead under `.factory/production-launch/state.md:27`. Apply migrations through0015 before matching services. Preserve metadata/guide-aware dispatch on rollback, oldNULL rows and frozen payloads; do not change global MAIL_FROM to rewrite old retry identity or replay messages for new copy.

While this checkpoint completed, main advanced to observability PR #38 (`8b0fc346`). A separate bounded main-mailer integration follows; its evidence is recorded separately and this checkpoint fingerprint is not claimed to cover that merge. Founder copy/schema/numbering remain frozen.
