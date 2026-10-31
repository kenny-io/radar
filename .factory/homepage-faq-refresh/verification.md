# Independent QA — homepage FAQ accuracy refresh

Environment confirmed: workspace `/Users/ekene/Downloads/design_handoff_radar/radar-push`, branch `kenny/homepage-faq-refresh`, base HEAD `29c3fe36fc248c1abb2fb593948e1185b3e6b9ce`. Preview `http://localhost:3901`; real Playwright/Google Chrome, fresh anonymous contexts. QA owns this record and `qa/` evidence only; unrelated release records and TypeScript config preserved. No analyses, authentication submissions, payments or publishing.

## Independent source review

| Criteria | Source evidence inspected | Intended claim |
|---|---|---|
| F1 blog automation | `src/server/actions/publishing.ts:94`, `src/server/services/drafting/jobs.ts:23` and `:136`, `src/server/services/publishing/jobs.ts:30` | Review-first default; Daily autopilot requires explicit acknowledgment, connection and schedule; pause holds publishing while drafting can continue |
| F2 social automation | `src/features/social/AutoModal.tsx:23`, `src/server/services/social/auto.ts:32`, `src/server/services/social/publish/schedule.ts:96`, `src/server/actions/social.ts:133` | Separate Automatic generation with library/schedule opt-ins; enabled workspace, matching connected live account and preflight required; next-day scheduling, no per-post approval; turning generation off updates settings without deleting scheduled publications |
| F3 replies/availability | `src/lib/constants.ts:114`, `src/server/services/brief/draft.ts:43`, `src/features/brief/DailyBrief.tsx:340`, `src/lib/socialPublish.ts:264` | Personal mentions default to asked, with disclosure; no Reddit links; X Reply now opens native intent box, not API auto-reply; availability copy must be conditional on workspace channels |
| F4 AI/GSC/GitHub/backlinks | `src/server/services/visibility/jobs.ts:20`, `collect.ts:121`; `src/server/services/gsc/sync.ts:88`; `src/server/services/publishing/connectors/nextjs.ts:136`; `src/features/backlinks/Backlinks.tsx:112`, `src/server/services/backlinks/matching.ts:165`, `network.ts:108`, `jobs.ts:59` | Nightly AI attempts retain earlier real results on failure, otherwise Not collected; not a new Not mentioned. Up to16 months available GSC data; GitHub opens PR, merge/deploy publishes. Backlinks review or opt-in rules-based auto-approval, default sponsored or nofollow qualification and weekly verification |
| F5 billing | `src/lib/billing.ts:2`, `src/features/billing/BillingSettings.tsx:56`, `overviewCopy.ts:11` | Published $50/month/3-day/$1-credit offer unchanged; one subscription for owned businesses; Stripe customers can manage cards/invoices/cancellation; no universal hosted-management promise for accounts without Stripe subscription |
| F6 adjacent homepage | Final Home/HomeStory copy diff will be reviewed | Remove universal manual-approval/default-no-mention/exact30 promises; keep review-first demo labeled as example |

Runtime availability projection (social limited rollout, X/LinkedIn profile configured, LinkedIn page unconfigured; billing enforcement off) supplied by PM as filtered nonsecret evidence. QA did not read credentials or change configuration.

One copy issue identified during review: an unavailable AI attempt can retain a previous real measurement; unconditional “is marked Not collected” would be inaccurate. PM independently identified the same nuance and requested a correction before final freeze. Final browser/claim results pending.

## Final frozen-tree result — PASS

Final source hashes match PM freeze:
- `src/features/marketing/Home.tsx`: `f32d101dc6f93ad13a5999f0e310d8bbf5566886ac0a9201de5a33993ca3d90b`
- `src/features/marketing/HomeStory.tsx`: `bf373872b230b7757a7452f761034d1a732f8457ee6efc89e419f1e6b6f56b0e`

Browser window `2026-10-31T11:21:21.286Z`–`2026-10-31T11:21:32.160Z` (UTC). **5/5 browser scenario groups passed**: all14 native FAQ accordions at1440 and360px opened with Enter, closed with Space and reopened; focus stayed on each summary with a visible solid outline; answers were readable at16.5px/26.4px and no horizontal scrolling occurred. All three demo tabs and Home/ArrowDown/End navigation worked with revised descriptions/panel note visible. Owner-swapped hero/closing and all three feature closing headings remained unchanged. Zero browser/page errors.

Supplemental360px check exercised all three demo tabs, verified every card stayed inside its stage with no horizontal overflow, and captured `qa/how-copy-mobile.png` / `qa/mobile-demo-results.json`. Direct visual inspection of mobile social/pause answers and desktop/mobile demo copy found no clipping or material readability issue.

Final claim coverage:
- F1/F2 pass: separate acknowledged blog autopilot and social generation/scheduling; library versus next-day connected X/LinkedIn scheduling without another approval clearly distinguished.
- F3 pass: availability qualified by enabled workspace channels; community replies manual, X opens native reply box; personal mentions default to when asked, with disclosure and no Reddit links.
- F4 pass: blog pause/drafting and social generation/existing schedules distinguished; ten connectors/GitHub merge, nightly AI retaining previous results or Not collected, up to 16 months of available GSC data, optional backlinks with manual or rules-based approval and weekly verification match source. The pre-freeze AI wording issue is resolved; no outstanding claim defect.
- F5 pass: published offer ($50/month, three days, $1 credit) unchanged; account-wide coverage of owned businesses and Stripe-management qualification correct. Runtime billing enforcement remains unchanged and was not independently tested as a purchase.
- F6 pass: comparison/trust/integrations/inclusions/demo wording no longer promises universal individual approval; exact 30-topic promise removed. Demo remains explicitly illustrative review-first. Only copy/markup formatting changed in the two owned source files; no feature-page/style/interaction implementation changed.
- F7 pass: native accordion/focus/mobile checks, naturalcopyreview, `npm run typecheck` and `git diff --check -- src/features/marketing/Home.tsx src/features/marketing/HomeStory.tsx` passed. No new mirroring/snapshot unit tests added.

Reproduction/evidence: `node .factory/homepage-faq-refresh/qa/browser.mjs`; `qa/browser-results.json`, `qa/browser.log`, `qa/faq-visible-{1440,360}.json`, `qa/adjacent-visible.json`, and localPNG screenshots. No failed/blocked checks remain in this copy-only scope. Recommendation: ready for PM review and locally verified delivery; no commit/PR/merge/deployment performed by QA.

PM integration: final source hashes match independently tested fingerprints; inspected desktop/mobile expanded FAQ screenshots. Final npm run typecheck and source diff check passed. Only Home.tsx/HomeStory.tsx copy changed; existing release records and tsconfig drift preserved. Preview on :3901 is current; no follow-up commit or deployment performed.
