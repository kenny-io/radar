# Independent production article verification — ACCEPT

QA-4 / PPR-8, 10 November 2026, completed approximately 01:54 Dubai (UTC timestamps in JSON). Both requested articles are live on canonical production `https://thally.io`. **13/13 real-browser groups passed; 0 failed; 0 blocked.** No product defects observed. The earlier preview-only limitation is resolved by this production evidence.

## Integrated revision and environment

User explicitly authorized merging both destination articles and verifying live publication. PM performed merges without conflicts/manual resolution: PR137 merge `8e5b36274920ea3d6602b3c15c91b11c66df555b`, PR138 merge/final combined main `c9a3b859cd208ff380d4737659ec536fb967c9a8`. QA fetched exact main into the clean owned destination clone and inspected combined source; no GitHub/source mutations or delegation by QA.

Read destination AGENTS and canonical site configuration. Test environment: real production anonymous native Google Chrome via existing Playwright, isolated contexts, desktop 1440×1000 and mobile 390×844, reduced motion; no test account or customer session. PM's safe read-only Netlify receipt confirms production deploy `6af2407136be45d7f1b18623`, state ready, commit `c9a3b859cd208ff380d4737659ec536fb967c9a8`, published `2026-11-09T21:52:45.826Z`, canonical URL `https://thally.io`. QA checked receipt consistency against tested revision; actual browser independently exercised canonical public output. Receipt: `production-articles-qa/netlify-production-receipt.json`.

## Acceptance coverage

| Check | Result | Evidence |
| --- | --- | --- |
| Combined source preserves both reviewed integrations | Passed | Both article files byte-identical to accepted PR137 a8b3304 and PR138 75c11fb. Each manual registry entry and llms overview link exists exactly once; combined diff 10 files, 466 additions, no deletions. `merged-source.json`. |
| Real production routes and blog listing | Passed | Both canonical article URLs return 200; live blog canonical correct and exactly one card for each. Ordinary pointer-hover and keyboard Enter navigation from blog reaches each actual canonical article. |
| Complete rendered content | Passed | Migration 9987 rendered characters and normalized prose SHA256 `3324129fc3b5896e311fa68ddd45af0d58391b339e5fc74b62b420e50bc230fe`; analytics 9125 characters and SHA256 `8dd3df7df324af7704397780128f7ae5021629f7fde227e5f365587ea47082c1`. Both exactly match the independently accepted article renderings; one H1 each, no unresolved body tokens. |
| Published images and source citations | Passed | Each article's2 inline images loaded at 1200×675 with alt text. Migration 9 public citations, analytics 8; every rendered citation absolute HTTP(S), nonempty hostname, no embedded credentials. Internal no-scheme research reference not exported. |
| Canonical, sharing image and structured metadata | Passed | Each canonical and og:url equals its production article URL. Per-article OG image returns 200 image/png; working team author link; BlogPosting JSON-LD URL agrees. |
| Persistence/fresh reader | Passed | Existing tab reload and a separate fresh anonymous browser context retain exact full prose hash for each article. |
| Mobile/keyboard | Passed | Each article fits 390px without document overflow; visible focused Blog breadcrumb works via Enter and returns to live blog with its article card. Both mobile viewport screenshots visually inspected. |
| Production discovery | Passed | `/sitemap.xml`, `/rss.xml`, `/llms.txt`, `/llms-full.txt` all 200 and include both routes; full corpus contains both article openings. |
| Runtime/assets | Passed | Zero browser runtime exceptions and first-party HTTP asset failures observed. |
| Account/tenant/write flows | Not applicable | These are public static articles tested anonymously. QA performed no authenticated mutation, merge or deployment. |

No existing baseline failure was encountered during acceptance. Initial rollout polling showed the earlier article before the second finished deploying; final acceptance ran only after both routes/cards were present and PM supplied the exact production deployment receipt.

## Source preservation

Merged migration content: 10989 file bytes, SHA256 `217019262f442859ab5f3eb89a73fdde13a5e59684e98dbd227a3b913d9826b1`; contains all original 10988 payload bytes SHA256 `89f145d9a33ef0fa757596b47c22f038a67061977a8d71d76bdb2929a20fbd34` plus one final newline.

Merged analytics content: 10098 file bytes, SHA256 `27701cc5d5371f42ad92224a5d2c2bdd7d42f81508161569e89b04637c3a5bad`; contains all corrected 10097 public payload bytes SHA256 `7ecbeeb487ab9bb2de0eb676926636c33b3553b53139d33307eab6fee4664306` plus one final newline. PM separately verified original stored article blocks and all 9 research references remain unchanged; 20 independent citation boundary probes previously proved output filtering without input mutation. No punctuation/body rewriting was used to obtain acceptance.

## Reproducible evidence

Command from Radar worktree:

`node .factory/publishing-planner-recovery/production-articles-qa/browser.mjs c9a3b859cd208ff380d4737659ec536fb967c9a8 6af2407136be45d7f1b18623`

Evidence under `production-articles-qa/`: `production-browser.json`, `production-browser.log`, `merged-source.json`, `netlify-production-receipt.json`, `expected-preview-content.json` (expected values only), `production-blog-desktop.png`, `pr137-production-{desktop,mobile}.png`, `pr138-production-{desktop,mobile}.png`. Page response statuses and Netlify request IDs recorded in browser JSON. Prior exact-head build/tests/audit/preview evidence remains in destination-qa.md; it is not substituted for these live production checks. No secrets/customer sessions in evidence. Destination clone remains clean at exact combined main c9a3b859.

Recommendation: ACCEPT the requested merge-and-live-verification outcome. Both actual production articles are available, with no remaining blocked acceptance checks in this scope. Passing observed checks does not establish all possible future behavior.
