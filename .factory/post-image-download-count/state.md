# State: Daily Brief post images — Download and 1–4 count

Branch `kenny-dev/post-image-download-size-5ca656` from `main` @ `3fe684ea`. Delivery: a PR to `main`; merging deploys to Railway production and needs the owner's go-ahead.

| ID | Task | Owner | Status | AC |
|---|---|---|---|---|
| E1 | Same-origin media route + `storedKey`/`readStored`; `visualBlob` reads bucket images through it and never substitutes the template; Brief, Social pack and article downloads | PM | review | PID-1…4 |
| E2 | Exact count 1–4: `imageOptions`, `brief.visuals` (`n`, legacy `range`), Add visuals window, Try again | PM | review | PID-5…7 |
| Q1 | Independent QA in a browser | factory-qa | planned | PID-1…7 |

## Files
- `src/server/services/storage.ts`, `src/app/api/b/[bid]/media/route.ts`, `src/components/Visual.tsx`
- `src/lib/imageOptions.ts`, `src/lib/types.ts`, `src/server/actions/brief.ts`, `src/features/brief/DailyBrief.tsx`
- `src/features/social/PackView.tsx`, `src/features/article/ArticleWorkspace.tsx` (download error toast only)

## Next action
QA, then push and open the PR.
