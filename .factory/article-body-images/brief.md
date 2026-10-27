# Article body images

## Problem and base
Articles currently generate only a cover; the body is text only. Verified after fast-forwarding main by 17 commits to origin/main 2ab6149eb7f22bd5a482bd7646063d9e2fd4e04f on 2026-10-27. User requests building the missing feature. Work on kenny/article-body-images in the existing clean checkout.

## Scope and experience
Keep Radar's existing cover and visual style. Generate distinct, section-relevant illustrations inside new articles and rewrites. Use the existing image provider/template fallback and storage. Extend the current Media panel with a body-image action for existing generated drafts, loading/error states, and accessible image descriptions. Preview and publish the same images in the same positions. No new dependencies or SQL schema migration; preserve old articles and manual edits. Existing generated articles are repaired explicitly, not silently rewritten. Preserve tenant/role restrictions and publication locks. No production content changes or deployment implied by building; deliver a verified feature branch/PR.

## Acceptance criteria
- AC1: New drafts and Rewrite from brief contain cover plus multiple distinct body images anchored to article sections (short/standard: 2; long: 3, limited sensibly by available sections).
- AC2: Body images, section placement and alt text persist across save/reload; legacy articles without the new field remain usable.
- AC3: Existing generated drafts can add/regenerate body images without changing body copy, sources, SEO, or cover. The action exposes progress and useful failure/retry state and refuses locked published/publishing/scheduled articles.
- AC4: The article view displays responsive body images with accessible alt text between sections; the Media panel follows the established UI and works on mobile.
- AC5: HTML, Markdown/MDX and native Notion publishing include body images in matching positions with usable public URLs; the separate featured image is retained.
- AC6: Provider failure uses existing template fallback; storage/total failure cannot silently report successful body-image generation. Drafting completion requires expected body images.
- AC7: Focused regression tests cover generation/placement/persistence, failure and locks, legacy compatibility and publishing; integrated typecheck/build and real browser QA run with limitations documented.

- AC8: One article view replaces the duplicate Edit/Preview toggle. Open drafts support inline text editing with autosave; queued/published articles and Viewers see read-only text. Body images persist after text edits.

## Delivery
Reviewable implementation and tests, independent QA, feature records, and PR if authenticated GitHub is available. Main serves production; do not merge/deploy without authorization.
