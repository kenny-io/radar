# Release QA — daily social drafts

## Release provenance

- Release worktree: `/Users/ekene/.codex/worktrees/daily-social-release/radar-push`, branch `kenny/daily-social-drafts`, main base `13f0697321302b2cc47384eb58520950c342985c`.
- All **13 feature source/test files exactly match** the prior independently tested fingerprint `e782085b183649dbd30ed5e127338cfb60d6d5b848d46d3c260ccdd7b3e109b8`. Per-file comparison: `release-qa/source-comparison.json`. Shared workspace change remains only the daily-default line; unrelated production code preserved.
- PM reports current-main release production build passed; full suite **996 passed, 65 skipped**, with only the previously known branded-raster golden mismatch. Engineer reports focused checks passed. These build/full-suite checks were not repeated by QA.

## Independent release-base browser smoke

**Passed.** Real headless Google Chrome/Playwright, ordinary locally seeded `dev@radar.local`, desktop 1440×1000 and mobile 390×844, `http://localhost:3120`. Synthetic database `radar_daily_social_release_qa` on local Docker Postgres port54329, freshly migrated from current main. Development stubs, billing off, social publishing enabled, test-only encryption key. Marked only the synthetic local account verified to satisfy current-main signup-security behavior; no email sent.

Confirmed daily library status, automatic provenance, retained manual generation CTA, settings open/read-only/close, and persisted reviewed draft on mobile without horizontal overflow. No client runtime errors. Evidence: `release-qa/local-results.json`, `local-library-desktop.png`, `local-pack-mobile.png`; reproducible `setup.mjs`, `server.mjs`, `local-smoke.mjs` in that directory. The prior 71 automated tests and 16 core/settings browser scenarios remain applicable because feature source matches exactly.

Stopped the local QA server, confirmed port3120 closed, and restored release `tsconfig.json` byte-for-byte to git HEAD; no intentional configuration changes. Did not alter the original dirty checkout.

## Production smoke

**Passed 5/5** after PM confirmed both Railway deployments successful on merged revision `83f774769976dbb2c673e88090979f052bc48b81` (PR30): web `555f659e-eafe-432d-a00e-713aa3718133`, worker `3d3ee266-a6e2-4f91-a7e8-9a0898694f5f`. The public application does not expose a build SHA; deployment provenance is supplied by PM deployment/runtime verification, not inferred from HTTP200.

Command: `DEPLOYED_SHA=83f774769976dbb2c673e88090979f052bc48b81 node .factory/daily-social-drafts/release-qa/live-smoke.mjs` against `https://radar.thally.io`.

- Readiness GET `/api/health` returned **200** with `{ok:true}`.
- Real Chrome anonymous homepage rendered at **1440px** and **390px**, with viewport-width document and no horizontal overflow.
- Anonymous `/social` redirected to `/signup`, displaying the existing email-first Create account surface and no private library content.
- **Zero** client runtime errors, **zero** failing Next asset responses, and **zero** attempted non-read requests. Browser route guard blocked any non-GET/HEAD/OPTIONS requests, but none were attempted.

Results: `release-qa/live-results.json`; public screenshots `live-home-1440.png`, `live-home-390.png`, `live-anonymous-social-redirect.png`. Reviewed the mobile screenshot. Initial smoke contained a stale password-field assertion; current-main signup deliberately requests email first. Corrected only that harness assumption and reran the bounded smoke; final results all pass.

PM independently reports actual production web hashes match all ten feature application files, worker hashes match all six server feature files, both environments use production mode with development stubs disabled, and no feature flags changed. Normal worker cron completed **3 jobs -> 3 packs / 6 platform posts**, with **zero automatic publication rows**, observed again on a second read. Those runtime/job observations are PM evidence, not direct QA database access.

No usable production authenticated session: Chrome DevTools connector reports its browser profile is already in use; fresh Playwright Chrome is anonymous. Therefore live authenticated library/settings, real daily generation, real AI quality, and actual provider publishing were not independently exercised by this smoke; normal daily generation was separately observed by PM through aggregate runtime/job evidence. PM owns worker runtime/source confirmation and aggregate job observations. QA performed no signup, email, payments, settings saves, social sends or paid AI calls. Recommendation: deployment smoke passed within this explicit scope; no confirmed feature defect remains. Local stubs and matching-source prior QA provide the authenticated core-flow evidence.
