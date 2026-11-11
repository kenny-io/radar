# State

Base main e981adb79b386687c9b57716c88aa775a9851a8b. Isolated branch kenny/seo-ai-discovery. Existing launch records/source checkout preserved.

| Task | Owner | State | Scope |
|---|---|---|---|
| A1 | factory-architect | verified | Metadata/discovery/card contracts; architecture.md |
| E1 | factory-engineer | verified | Pure catalog, metadata,9 static PNG cards, discovery resources/schema; A2 corrected; focused checks passed |
| Q1 | factory-qa | verified | Local acceptance78/78; live acceptance pending deployment |
| P1 | PM | active | Requirements, integration, release and live deployment |

User authorized implementing and deploying this scope. No further approval required. Contracts settled:7 indexable pages, branded noindex account entries, physical PNG cards, static discovery routes, safe noindex default and bounded redirect/API headers. Final production build and independent local QA78/78 passed. No source defect remains observed. Release-ready. Next: commit/PR/merge and verify production deployment.

## Authorized rollout

Implementation `8a209067` and independent QA record `f4fb9eca` pushed. PR21 https://github.com/kenny-io/radar/pull/21 merged as `84316883d4ad3aef16be5eea8c5a3f2f5d57e450`. GitHub reported mergeable/CLEAN with no configured status checks. PM verified all source/static assets in the merge exactly match the local tested tree. No environment, billing or database change was made.

Both Railway deployments succeeded: web `88e3a34b-c062-42d6-ae88-cc52f9e6be4f`, worker `73111f04-04f3-47ec-8aff-883f634b504b`. Actual running-container readbacks confirm the merged SHA, Node22.23.3, production mode, billing ON, development stubs0, correct app/support URLs and unset lazy grandfather cutoff on both. Live /api/health and /robots.txt return200. All9 deployed PNGs return200 image/png, no noindex and byte-for-byte matches to the tested assets. Independent live acceptance is underway.

## Live finding and correction

First rollout passed all9 image checks,18 desktop/mobile pageviews and63 initial-head responses for social crawlers. Strengthened live QA found4 AI/search identities receive metadata streamed into body rather than the initial head (74/78 overall). A3 approved documented Next htmlLimitedBots wildcard to block metadata streaming for all identified crawlers/browser UAs; no guard/billing changes. E2 config correction and9 focused regression tests passed. Production rebuild and local regression are underway before follow-up deployment. Do not claim final live acceptance until the four failures pass.

E2 corrected build `F4OinTfBN-CfkTDOH59qG` passed production build and independent local acceptance78/78 plus99/99 initial-head checks. Source fingerprint `6c09a50b3f5d20bd42399c8024f84988485fa0d137ec49eb6c6e30b1ca3bdca3` (439 files). Ready for follow-up merge/deployment. Final live check remains required.
