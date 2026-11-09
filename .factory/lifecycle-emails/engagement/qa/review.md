# Independent QA — conditional work reminders

Accepted for integration into PR25. No unresolved defect found in the observed scope. This is local source/build acceptance, not a production-site release, real email delivery or inbox-placement claim.

## Exact source and environment

- Repository/worktree: `/Users/ekene/.codex/worktrees/radar-seo-ai-discovery/radar-push`, branch `kenny/lifecycle-emails`, base HEAD `a96ebd9dd326c088fb4847bfc8e9104c2691677e` plus frozen engagement changes.
- Frozen source fingerprint: **`036e3bd7c87d8cde09acaf00694df4418fa5fdd13501f6049614d741fa87f784`**,488 files. Scope and full relative POSIX lexical ordering are recorded in `source-fingerprint.json`; per-file hashes are in `source-files.json`. Recomputed after final checks; unchanged.
- Isolated database: local Postgres port54329, `radar_engagement_qa_20261104`, additive migrations through0010. Impact-event migration backfill0. No shared production database or customer rows.
- Browser environments: Next dev `http://127.0.0.1:3935`; optimized Next production `http://127.0.0.1:3936`, actual `NODE_ENV=production`, with a nonfunctional local-only Stripe key so the billing gate remains configured, build **`VtQMuZSb-6yVqkxLp30R1`**. Production stubs are disabled. Neither server runs a worker.
- Ordinary synthetic password users and owner/member rows; complimentary accounts permit real app access without a payment. No administrator browser bypass. Fixtures cleaned after each run; final counts were0 users and0 businesses in the isolated database.
- Installed Google Chrome, isolated headless browser contexts; unrelated browser sessions untouched. No real provider sends, social posts, charges or production account settings changed.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Independent database/API/source/dispatch probes | **19/19 pass** | Four QA-owned test files, `independent-tests.log` |
| Developer engagement source suite rerun independently | **15/15 pass** | `developer-engagement-suite.log` |
| Ordinary-user dev browser flow | **21/21 pass** | `browser-results.json`, `browser.log`, screenshots |
| Same targeted browser flow in optimized production | **22/22 pass** | `production/browser-results.json`, `production/browser.log`, screenshots |
| Four individual reminders plus combined email at390/600px | **10/10 pass** | `render-results.json`, ten rendered PNGs |
| Actual read-only startup-schema probes | **2/2 pass** | `worker-startup-results.json` |

## Acceptance coverage

- **EN1 passed:** The independent harness runs the actual initial brief job with billing enabled and a valid comp owner. A successful reply-bearing run records exactly one reminder, eligible in one hour and expiring at business-day end. Rescans do not create another event. Empty and handled-failure runs record none. Any copied reply suppresses the whole brief, permanently even after reopening the item. State probes also verify no send before the one-hour boundary and no next-day stale brief.
- **EN2 passed:** A plan waits24h, is tied to its generation and entry IDs, and is invalidated by regeneration. Any matching approval suppresses the whole reminder rather than mailing about leftovers. The independently rerun suite exercises real approval/unschedule actions and permanent resolution. Copy contains no35% result promise.
- **EN3 passed:** A real generated article body is required. Creating a same-business article-sourced social pack resolves that next step; a foreign pack cannot suppress it. A social pack waits24h; copying a single post suppresses its whole follow-up. Source and publishing tests retained by engineers cover scheduling/posted resolution; this pass independently inspected those hooks and reran the relevant engagement cases, without real publishing.
- **EN4 passed:** Concurrent collectors assign sources once; distinct actionable work is combined rather than mailed per item. The rolling cap includes founder mail and ambiguous attempts, across businesses. Stable owner-business timezone quiet hours defer work. Before attempt1, an acted-on section is dropped and only the remaining provider payload is frozen. A429 retry preserves the exact provider body/key, including after the user's name changes. Completing an included action after a503 suppresses the entire retry. A competing optional email defers a queued digest with0 provider attempts.
- **EN5 passed:** All three categories initiallyoff. Keyboard opt-in saves only the selected flag and survives refresh; repeated true saves retain original consent time. The authenticated identity is authoritative; foreign user IDs, cross-site writes and unauthenticated preference access are refused. Old founder tokens do not disable work categories. Scanner GET does not unsubscribe; explicit form POST and RFC8058 signed one-click POST work without requiring a login. Forged tokens cannot change preferences. Work opt-out preserves founder preference. Lapsed subscription access suppresses queued work without mutating billing state.
- **EN6 passed:** Desktop/mobile settings, native keyboard checkboxes, loading failure/retry, write-failure rollback and persistence work. The email link switches from another owned business only after authorization, selects the existing article and performs0 generation requests. The signed-out signin roundtrip preserves that target after EN6-D1's fix. Foreign business/resource access is refused. All email variants have one h1, no horizontal overflow, correctly loaded high-resolution logo, scoped opt-out, fixed first-party business-specific action links and one primary button; combined secondary actions remain links. The final600px combined screenshot was visually inspected through its full footer.
- **EN7 scoped pass:** Additive migration succeeds; initialfalse preferences prevent a historical broadcast. Existing security/billing preference scope is preserved. No new service/dependency or live delivery was used. The PM owns full-suite/build/release verification; this QA report does not relabel historical recovery90-browser checks or simulator delivery as checks of this new feature.

## Defect closed

**EN6-D1:** A signed-out email target initially reached signin but was discarded afterward because `entryAfterAuth` did not allow `/email/open`. QA found this in the ordinary browser. The UI engineer added a narrow validated landing-route allowance with password/Google regression tests. Independent full dev and production browser retests now pass. See `defects.md` for reproduction and evidence. No implementation edits by QA.

The final production run also checks the authenticated billing overview readback (`provider=stripe`, `enforced=true`, `status=comp`); no Stripe operation is invoked. An earlier production UI-only smoke lacked a configured provider and is superseded by this run. One configured-production attempt reached the correct Social URL but timed out waiting20s for its modal; the confirmatory full22-check run with failure capture enabled passed without reproducing it. No runtime error was observed. The precise cause of that one readiness delay was not established, so these checks do not promise page-load latency under load.

The first browser harness used an exact Section heading match, while the existing component includes its subtitle in the accessible heading; the selector was corrected to match the actual heading. An early developer-suite run with billingON correctly skipped its non-comp source-job fixture. That suite passed under its intended billing-off setup; separate QA-owned source-job checks explicitly use comp owners and billingON and pass. Neither setup correction hides a product assertion.

## Commands and limits

- `DATABASE_URL=<isolated QA DB> RADAR_DEV_STUBS=1 RADAR_BILLING=on RADAR_SECRET_KEY=<local dummy> APP_URL=http://127.0.0.1:3935 npx vitest run --config .factory/lifecycle-emails/engagement/qa/vitest.config.ts`
- Same isolated DB with `RADAR_BILLING=off`: `npx vitest run --no-file-parallelism src/server/services/lifecycle/engagement.test.ts`.
- `node --import tsx .factory/lifecycle-emails/engagement/qa/browser.ts` with matching local-server environment; production additionally uses `NODE_ENV=production`, `QA_BASE`, `QA_OUTPUT` and `QA_RUNTIME` to preserve separate evidence.
- `node .factory/lifecycle-emails/engagement/qa/render.mjs`. Each mail uses a fresh page, measured viewport and settled paint to avoid Chromium full-page repaint artifacts. First-party PNG URLs are fulfilled from the deployable local asset, not falsely claimed as already deployed.
- The default startup probe succeeds against the migrated database; an isolated empty database rejects with a0ms test budget and one sanitized waiting diagnostic. No actual worker is launched.

No blocked local criterion remains. Real SMTP/inbox placement, externally performed engagement that Radar cannot observe, production traffic capacity and actual live deployment remain untested here. Recommend integrating the frozen source and these records, then following the existing owner-approved release workflow. Do not infer authorization to merge/deploy from this QA acceptance.
