# Image generation loading status

November 9, 2026. Daily Brief rendered an in-progress image preflight guard in red, making generation look like a failure.

Show a blue live status with the existing animated spinner and “Creating your image…”/“Creating your images…”. Keep actual validation and generation failures red, and suppress stale pending text after failed/expired jobs. Posting/scheduling still use the unchanged complete preflight list, so both remain blocked while images are pending. No backend, provider, schema or CSS-token change.

Scope: DailyBrief.tsx and this record. Typecheck, production build, diff check passed; Impeccable detector returned no findings. Real Chrome passed six scenarios: blue animated loading plus blocked publishing, ready clearing/loading and enabling Post, red genuine failure, expired-job failure without stale loading, independent real validation errors while generating, mobile/dark mode layout and color. No runtime errors. Inspected loading-status screenshot. Synthetic fixtures only; no image generation or customer mutations. QA session removed/server stopped and incidental tsconfig edits restored.

Build log /tmp/radar-image-progress-build.log; local browser evidence .data/image-progress/. No new mirrored unit tests for this reversible UI change.

Production rollout pending.

DailyBrief.tsx SHA-256: `f12928bad5d3f40d91af868216ac3f90a571a9ef6fffba9a9a7ebfa93bf1db53`.
