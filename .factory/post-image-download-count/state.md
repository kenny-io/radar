# State: Daily Brief post images — Download and 1–4 count

Branch `kenny-dev/post-image-download-size-5ca656` from `main` @ `3fe684ea`. Delivery: a PR to `main`; merging deploys to Railway production and needs the owner's go-ahead.

| ID | Task | Owner | Status | AC |
|---|---|---|---|---|
| E1 | Same-origin media route + `storedKey`/`readStored`; `visualBlob` reads bucket images through it and never substitutes the template; Brief, Social pack and article downloads | PM | verified | PID-1…4 |
| E2 | Exact count 1–4: `imageOptions`, `brief.visuals` (`n`, legacy `range`), Add visuals window, Try again | PM | verified | PID-5…7 |
| Q1 | Independent QA in a browser on 62dcc6db | factory-qa | PID-1, 3–7 pass; PID-2 fail (D1) | PID-1…7 |
| F1 | D1: `storedKey` accepts plain key segments only (no decoding, no `%`, `\\`, `.`/`..`, empty segments) + unit tests | PM | done | PID-2 |
| Q2 | QA retest of PID-2 vectors, cross-origin PID-1 and PID-3 on 893b14ec | factory-qa | pass | PID-1…3 |

## Files
- `src/server/services/storage.ts`, `src/app/api/b/[bid]/media/route.ts`, `src/components/Visual.tsx`
- `src/lib/imageOptions.ts`, `src/lib/types.ts`, `src/server/actions/brief.ts`, `src/features/brief/DailyBrief.tsx`
- `src/features/social/PackView.tsx`, `src/features/article/ArticleWorkspace.tsx` (download error toast only)

## Next action
PR kenny-io/radar#10 (no CI checks configured; mergeable). Owner review of the PR; merging deploys. After deploy: Download on a Brief post in production saves the generated image.

## Risks
- No real S3/R2 bucket was used in QA (a local no-CORS stand-in).
- Images stored under an older bucket address (before `S3_PUBLIC_URL` changed) still display, but Download now shows the error toast for them instead of silently saving the template.
