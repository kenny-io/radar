# Launch verification — November 3, 2026

Source commit: `1f6a1a1b14f5ae298bd188fa47c3d6dfa11e87f9`, branch `kenny/production-launch`, base main `0a9af070`. Independent final source/dependency/deployment fingerprint: `137481f32404de0d8c755c9295fe4865363de733cc3c8b673deb794463f47583` (409 files; ignored per-file manifest in `.data/production-launch/qa/e4-e5-source-fingerprint.json`). PR: https://github.com/kenny-io/radar/pull/20. No production deployment of this changeset yet.

## Integrated checks

- Full database-backed suite: **855 passed, 65 skipped, one unchanged baseline failure** across 79 files. Command: `DATABASE_URL=<isolated local radar_production_launch> RADAR_DEV_STUBS=1 npm test`. Skips require external connector harnesses/platform access. The sole failure is the pre-existing native-raster golden in `openrouter.qa.test.ts` (expected `f883614e6a7dfb07`, current rendering `91d5409f50974af7`). No expectation was replaced or skipped to hide it. Log: `/tmp/radar-launch-release-tests.log`.
- Typecheck, `git diff --check` and final production build: passed. Final dist `.next-launch-release`, BUILD_ID `NNH2Klc26NzUsej_cYYXV`, runtime source commit `1f6a1a1b`. Build log: `/tmp/radar-launch-release-build.log`.
- Runtime dependency audit: **zero known vulnerabilities** with PostCSS 8.5.32 and Undici 7.30.1. Development-only Vitest/tinypool/esbuild advisories remain; no tooling server is exposed. A major test-tool upgrade was kept outside this release.
- Native production-mode public HTTPS requests through both the crawler and publishing DNS-pinned dispatcher succeeded against example.com, including TLS hostname validation. New timeout regressions use real local HTTP servers whose headers arrive before their response bodies stall.

## Independent browser and regression checks

See `qa.md` for details and evidence: live public smoke 7/7 groups; local real-Chrome signup → onboarding → persisted profile edit → stub trial → dashboard/Billing 6/6 groups; delayed-script hydration 3/3; production-build public smoke 15/15. Final focused E4/E5 regressions: **373 passed plus the same single raster baseline failure**, no skips, across 27 files. UI source did not change after hydration verification.

## Capacity and recovery

The prior fully integrated production build `fQAS3QW-qLMiPPO_ayayr` passed 200 unique authenticated accounts/businesses with 200 SSE connections: 5,640 timed GETs in 36.33 seconds, **155.2 requests/second, p95 124.6ms, p99 728.4ms, zero HTTP/tenant/SSE errors**. Observed 600 pings and 70 revision events; peak 10 application DB connections plus one sampler. Fixtures were removed. The exact final release build also passed a repeat: **5,670 GETs / 36.226s = 156.5 requests/s, p95 86ms, p99 555.2ms, zero errors**, with the same 200 sessions/SSE and DB budget. Full results are in `qa/load.md`.

This is a local, sparse-data, predominantly read-only envelope. It excludes signup password CPU, 200 simultaneous analysis jobs, provider quotas, payment capacity and Railway hardware/network capacity.

An actual production PostgreSQL snapshot (6,662,392 bytes) restored successfully into a network-disabled disposable PostgreSQL 18 database. Five aggregate counts matched production, and the disposable container was removed. The archive is ignored and owner-only (0600; containing directory 0700). Native scheduled backups were rejected on Railway Hobby. The owner keeps Hobby and will arrange a private offsite destination; the local recovery drill is not scheduled offsite protection. See `qa/backups.md`.

## Production/provider checks

Production web and worker remain successful at main `0a9af070`: single replicas in Singapore, shared S3, development stubs disabled, billing OFF. Read-only DB checks observed max_connections 100, 10 connections, zero queued/running jobs. Actual worker S3 upload/public read, web read and scoped probe deletion passed.

Live Stripe configuration checks passed; live account card payments, charges and payouts are enabled. Actual application writing/research smoke passed through Anthropic fallback. OpenRouter account credit is exhausted despite remaining per-key allowance. Email sender radar@thally.io is configured; Resend domain verification and public DKIM/SPF/DMARC records were checked. Actual email receipt is untested. See `providers.md`.

## Real Stripe sandbox

The owner authorized retrieving existing test keys from their signed-in browser. Keys are stored only in ignored 0600 local configuration. Separate Thally sandbox resources and local DB were used; no live charge/subscription mutation occurred.

Actual application billing and Stripe test clocks proved one $1 confirmation, one $1 credit, a paid **$49 first monthly invoice** and **$50 renewal**. Nine real Stripe-signed events processed once each. Independent browser checks cover real Elements declines, 3-D Secure Fail/Complete, trial activation, repeated-card refusal, portal card update, invoice PDF and return navigation. QA's cancellation-shape defect was fixed and passed a fresh real signed subscription update on the final build: the correct warning/date persisted across desktop/mobile reloads. Final actual browser acceptance: **9/9**; public smoke: **15/15**. See `stripe-invoices.md` and `qa.md`.

## Remaining sign-off

Production post-deploy smoke, real Google consent/Search Console verification, actual invitation receipt and ongoing external monitoring remain unverified. Scheduled offsite backups await the owner's destination. Main merge and paid-gate activation require authorized rollout; activation must preserve existing accounts with the recorded grandfather cutoff. Passing local checks alone does not establish complete live launch readiness.

## Final handoff

Final production source, exact-build load and independent cancellation recheck all passed as described above. Local QA web/TLS proxy and Stripe listener processes were stopped after testing. Test-only credentials, retained sandbox fixtures and private recovery archive remain in ignored owner-only storage for authorized follow-up. A direct scan found none of the captured Stripe credentials/signing secrets in tracked files. Historical E3 evidence required reconstruction after a misconfigured verification harness overwrote its metadata; fresh independent Stripe GET/local SELECT checks reconfirmed every financial assertion. The repaired verify-only harness is now proven not to modify evidence on either success or preflight failure. See `stripe-invoices.md`. No application source changed during this artifact repair.
