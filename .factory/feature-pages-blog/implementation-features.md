# E1 feature-page implementation

Confirmed isolated workspace branch `kenny/feature-pages-blog`, base `f4e0ec581bc5c95330cb20e57fb579835b87e434`. Other agents' work was preserved. No commits, merge, deployment, environment or database changes were performed by E1.

## Implemented acceptance

- M1: Added the three new feature route leaves and explicit force-static to all six feature pages. Root layout, homepage redirect, auth and billing logic are untouched. Actual static build output remains for PM/QA to confirm.
- M2: Shared public feature-link catalog, CSS hover/focus Features panel, active feature/Blog markers, written mobile navigation policy below900px, four-column/two-column footer with every route and Thally identity. HomeStory gains only the three missing feature links.
- M3: Full supplied Daily Brief, Social Marketing and Performance page sections ported to React, with supplied screenshots/alt/illustrative captions and two feature/one guide related cards. Existing three feature bodies change only their More ways row. New social screenshot copied to public/marketing/shots/p-social.webp; no hotlinked favicon dependency.
- M4: Isolated client demos implement clipboard success/failure, posted/undo focus, reply-style pressed state, Social roving tabs/Home/End/arrows, viewport-gated3.8s autoplay stopped by interaction/reduced motion, actual copy and generated PNG download, and safe illustrative post/schedule statuses. Performance uses seeded UTC data, metric tabs, inverted ranking axis and visibility/reduced-motion-aware SVG draw. No demo calls any account, publishing or provider API.

## Copy corrections approved by PM

The new prototype contains a few claims behind the already deployed behavior; the supplied layout is preserved while these new-page lines are narrowed:

- Daily Brief recommendation mentions/disclosure follow the current default, rather than claiming Just help is always the default. Reply facts/voice come from Business Profile and require user accuracy review; the link-free promise is specifically for Reddit. Feed posting is qualified by workspace availability.
- Social distinguishes Save to library from explicitly enabled Schedule posts and identifies separate opt-ins. It does not promise that every generated pack always waits for another approval.
- Performance says supported CMS refreshes update in place, with GitHub PR and signed-webhook URL contracts. AI Visibility is identified as its own page. Unsupported “quickest win/pays off most” language is narrowed. The related guide uses PM's reviewed title, “How to refresh pages ranking on page two.”

## Checks and scope

Baseline `npm test -- src/features/marketing/domain.test.ts`:21/21 passed. Final `npm test -- src/features/marketing/domain.test.ts src/features/marketing/feature-demo-data.test.ts`:25/25 passed. The four new tests exercise disclosed/link-free reply content, platform text bounds, deterministic series across time zones and inverted/flat chart behavior. `npm run typecheck` passed after E2 completed the new metadata path exports. `git diff --check` passed. Initial typecheck during parallel integration reported only E2's pending SEO path/export additions; no expectation was changed.

Source diff was reviewed for preserved legacy content, production links and lack of prototype preview/hotlink/placeholder targets. Full production build, browser visuals, clipboard/download behavior, keyboard/mobile/reduced-motion flows and live deployment are PM/independent QA responsibilities; E1 does not claim them here.

Owned files: MkRoot.tsx, parts.tsx, HomeStory.tsx, marketing.css, marketing-links.ts; three existing feature component related rows; DailyBrief.tsx, SocialMarketing.tsx, Performance.tsx; new-feature-demos.tsx, feature-demo-data.ts/test; six feature page.tsx leaves; p-social.webp. The exact21-file fingerprint is `faf55fe3c8ce7519f4f0c1dd556504a65506083d9d694a5e922f28c8369fccc8` (SHA256 of sorted path+NUL+bytes), with its manifest retained in ignored .data/feature-pages-blog/features-fingerprint.json. Final semantic inspection keeps the demo thread title as a styled paragraph so page headings do not skip h2; its visual appearance is preserved. No shared SEO/blog/RSS/package files were edited by E1.
