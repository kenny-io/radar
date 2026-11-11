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

Pending PM confirmation of deployed merge SHA and successful web/worker rollout. Prepared `release-qa/live-smoke.mjs` for read-only desktop/mobile homepage, readiness GET, anonymous social-route protection, Next assets and runtime checks. It refuses to run without a full SHA supplied through `DEPLOYED_SHA` and blocks browser non-GET/HEAD/OPTIONS requests.

No usable production authenticated session: Chrome DevTools connector reports its browser profile is already in use; fresh Playwright Chrome is anonymous. Therefore live authenticated library/settings, real daily generation, real AI quality, and actual provider publishing are not independently exercised by this smoke. PM owns worker runtime/source confirmation and aggregate job observations. No signup, email, payments, settings saves, social sends or paid AI calls authorized for this QA pass.
