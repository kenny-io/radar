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

## Released (2026-10-26)
- Merged: PR kenny-io/radar#8 → `main` as `30392143`, on the owner's go-ahead.
- Deployed: `radar - worker` success 14:49:20Z, `radar - web` success 14:51:52Z (radar.thally.io returns 200).
- Production check (owner's signed-in Chrome, Settings → Publishing → Add connection → Next.js blog):
  - Sign in with GitHub was enabled with no fields; Radar was already authorized, so GitHub returned straight away.
  - The Repository list had 391 repos and no `thallylabs/` ones (the org hasn't approved Radar); `kenny-io/radar` was preselected (no repo named after thally.io).
  - Content folder `content/posts` with hint; picker help line and link shown.
  - Test connection on `kenny-io/radar-connector-test`: "Connected". Afterwards that repo has only `main` and no open PRs.
  - Cancelled; nothing saved.
- Follow-ups in PR kenny-io/radar#9: the platform is named GitHub; only a site-named repo is preselected; GitHub's test line says "test branch".

## Released: GitHub name and follow-ups (2026-10-26)
- Merged: PR kenny-io/radar#9 as `b5c4ea45`, then PR kenny-io/radar#7 (landing copy) as `3fe684ea`, on the owner's go-ahead.
- Deployed `3fe684ea`: `radar - worker` success 16:59:12Z, `radar - web` success 17:04:22Z.
- Production check:
  - Picker tile reads GitHub, subtitle "Pull request", GitHub mark; the window title is "Connect GitHub".
  - After sign-in nothing is preselected ("Choose…"), since no repo is named after thally.io.
  - Test on `kenny-io/radar-connector-test`: "Connected · test branch created, then deleted". The repo has only `main` and no open PRs. Cancelled; nothing saved.
