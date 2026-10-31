# Production release QA — 31 October 2026

Recommendation: production release passes the available read-only smoke checks. Public availability, auth boundaries and all four deployed feature bundles are confirmed. Signed-in production interactions remain blocked by unavailable authenticated browser session; no production regression was observed within this scope.

Release identity supplied by PM: PR16 head `0b83753338c0201c0a5d1daba15f88de6398c87a` merged as main `2524537da22eae7644829c05069b3b3320995c83`. PM reported Railway production web deployment `7110231c-a208-46e0-9832-b9762eb2613a` and worker `53c7689b-3dc7-4466-8200-f48ca7e868d5` both SUCCESS before independent production checks. User authorized merge/deployment. Tested source matches pre-release functional acceptance source; no source changes by release QA.

Environment: `https://radar.thally.io`, existing user Chrome browser through CUA; public checks at 10:14–10:15 UTC / 14:14–14:15 Asia/Dubai after PM release-ready signal. No production credentials/session tokens were accessed; no content/settings/role writes, image generation, publishing or provider spend.

Passed:
- Public GET `/`200 and `/signin`200, with expected Radar titles and complete HTML.
- Unauthenticated `/performance`, `/social`, `/calendar`, `/brief`, `/article/qa-release-probe`307→`/signup` rather than exposing tenant data. Actual browser navigation to `/performance` also reaches the account screen.
- Real Chrome public landing page renders at desktop and390×844 mobile. Mobile homepage and auth-boundary document widths equal390, with no horizontal overflow.
- All23 assets referenced in public HTML or raw redirect Flight metadata fetched200. Exact deployed route chunks include the expected new controls/actions (static asset evidence only, not a claim of interactive signed-in verification):
  - Performance `page-279e9550d8c55539.js`: Copy all changes / Copy prompt controls.
  - Social `page-9566c3608916072c.js`: Describe your image, Generate image, social.regenImage.
  - Daily Brief `page-03cebe539d1b1e09.js`: Describe your image, brief.visuals.
  - Article `page-cd9a64e86154bde0.js`: Describe your image, Generate from prompt.
- Preliminary local-build hash probe URLs differed and returned404; after extracting the deployed paths from raw307 metadata, every actual referenced asset returned200. No production missing-asset regression was found.

Blocked:
- Authenticated production Performance copy click, Social PackView custom field and article Media controls. Existing connected Radar tab is at Sign in. A native Comet inventory had Radar tabs, but selecting one timed out; the foreground app was actively being edited, so QA did not continue interfering. PM confirmed no other known authenticated tab and authorized public/asset fallback evidence. No claim of an authenticated production session or interactive feature pass is made.
- Image-provider fulfillment/publishing are intentionally untested in production under this read-only verification scope. The independent local acceptance report remains the functional evidence.

Evidence (ignored `.data/suggestion-prompts-custom-images/production-qa/`): `public-check.mjs`, `public-check.log`, `public-results.json`, downloaded public HTML and `assets/`; `browser-results.json`, `home-browser.txt`, `home-browser.png`, `home-mobile.png`, `protected-route-mobile.png`. Temporary mobile viewport reset and QA-created tab closed afterward.

Failed new release checks: none observed. Not applicable under production read-only scope: live generation/provider spend, publication, editing, retry writes, mutation-based permission tests. Pre-release functional evidence is in `qa.md` (50 independent focused tests plus full desktop/mobile flows). No new source changes or deployment actions were performed by QA.
