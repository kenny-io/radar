# E2 implementation handoff

Workspace `/Users/ekene/Downloads/design_handoff_radar/radar-push`, branch `kenny/suggestion-prompts-custom-images`, starting revision `9d6c4016`. Read PM brief, architect contract/review and Impeccable craft floor. Preserved E1 and PM changes. No commits, merges or deployments.

Implemented IM1–IM4 and relevant UX1: selected-platform custom image generation/persistence, strict real-model routing even from branded styles, exact dimensions and metadata, retryable failures preserving prior complete media, Daily Brief optional direction with atomic image sets, and article explicit cover generation with flushed autosave. Existing regeneration/style changes reuse saved custom intent. Custom cover provenance persists into cover/body regeneration and required cover rerenders during drafting. Unavailable generation has distinct user-safe feedback. Inputs trim and cap at 1000; optional blank Brief field selects automatic images. No provider names, keys, URL fetches, reference-photo uploads, dependencies or migrations introduced.

Concurrency and safety: per-platform request identities, image-snapshot comparisons, final publication guards, strong article image admission and final guards, Brief request+seed identity, worker-attempt ownership and atomic completion prevent stale writes. Post text, other platforms, metadata and publication state are preserved. Failed custom directions/pending Brief settings remain retryable. Brief Change request/Remove remain available during generation. PM-owned `workspace.ts` projects terminal referenced image jobs even when they age out of the recent feed; its regression assertion is included in E2 tests.

Article behavior intentionally tightened: concurrent cover generation while a body-image job is active now returns `article_busy`, matching approved design and existing UI. Existing regression keeps safe SEO/source concurrent merge checks and now verifies this lock instead of allowing a conflicting cover mutation. Custom article capability is the cover input/action. Body images reuse strict custom direction after a custom cover succeeds; no per-body-image editor was added.

## Changed files

- UI: `src/features/social/PackView.tsx`, `src/features/brief/DailyBrief.tsx`, `src/features/article/ArticleWorkspace.tsx`.
- Contracts/actions: `src/lib/types.ts`, `src/server/actions/social.ts`, `brief.ts`, `article.ts`, `docs/CONTRACTS.md`.
- Generation/persistence: `src/server/services/images.ts`, `social/generate.ts`, `brief/visuals.ts`, `drafting/bodyImages.ts`, `drafting/draft.ts`, `drafting/jobs.ts`.
- Tests: `src/server/actions/customImages.db.test.ts` (new), `src/server/services/articleImagesFallback.test.ts`, `src/server/services/drafting/bodyImages.test.ts`, `src/server/services/drafting/bodyImages.db.test.ts`.

## Evidence

Final focused command, using separate local test Postgres and dev stub environment:

`DATABASE_URL=postgresql://radar@127.0.0.1:55439/radar_custom_images_tests npx vitest run src/server/actions/customImages.db.test.ts src/server/services/articleImagesFallback.test.ts src/server/services/drafting/bodyImages.test.ts src/server/services/drafting/bodyImages.db.test.ts`

Result: **38 passed / 38**, four files, final run 11.63 seconds. Database tests exercise real row locks, JSON persistence/reload, role/tenant guards, publication transitions, overlapping request races, remove/re-add with colliding seeds, stale workers, partial failures, exact aged-job recovery, and preservation of unrelated fields. Image provider/storage are mocked for these tests. Provider-routing tests separately mock API responses with real raster bytes and verify provider subject, actual 1200×628 crop, PNG metadata and strict no-fallback behavior. Expected injected-failure logs appear on stderr.

`npm run typecheck`: passed. `git diff --check`: clean. PM owns integrated full suite/build and independent browser QA. No live image-provider request was made, and no independent browser pass was claimed by E2.

E2 file-content fingerprint (sorted relative path + NUL + bytes + NUL across the 18 E2 files above): `bdc7e935dc0a993f45e44f964b2cec330ecc147b104f6b22f4a85383d0c8d00d`. PM workspace projection is additional shared source used by the aged-job test.

## Integration and limits

Changes are already in the shared branch; no cherry-pick or schema migration is needed. Strict custom generation requires an existing configured image provider with dev stubs off; missing provider configuration intentionally returns `image_unavailable`. Live-provider image quality/likeness was not verified. Named subjects are generated interpretations, not authenticated photos. Existing automatic/template fallback behavior remains available for legacy requests. Baseline raster-hash golden failure is pre-existing and untouched. No unresolved known requirement defect at handoff.
