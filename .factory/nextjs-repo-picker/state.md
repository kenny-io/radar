# State: Next.js repository picker

Branch `kenny-dev/nextjs-repo-picker` from `main` @ `b854e86d`. Delivery: a PR to `main`; merging deploys to Railway production and needs the owner's go-ahead.

| ID | Task | Owner | Status | AC |
|---|---|---|---|---|
| E1 | Sign-in first, repository picker, folder default and normalization, org 403 copy, stubs | factory-engineer (f9089e48, df657c11) | verified | NRP-1…7 |
| Q1 | Independent QA on df657c11 | factory-qa | conditional pass: D1, D2 should-fix | NRP-1…7 |
| F1 | QA fixes D1, D2, D3, D4, D5 | PM | done, unit-tested; not re-run by QA in a browser | NRP-2, 4, 5 |

## Owner items
- Grant Radar to the `thallylabs` org (github.com/settings/connections/applications/Ov23liEm9niSJvBlTSjN → Grant). Until then GitHub leaves thallylabs repos out of the list and answers 403.
- `thallylabs/thally-website` keeps each post in its own route folder (`src/app/blog/{slug}/content.mdx` + `page.tsx`, registered in `@/lib/blog`). Radar writes `{folder}/{slug}.mdx`, which that site won't render. A decision is needed (change the site to read a content folder, or a new connector layout).

## Next action
Owner review of the PR; merge deploys.
