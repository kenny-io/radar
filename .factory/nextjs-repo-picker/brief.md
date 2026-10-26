# Brief: Next.js blog: sign in with GitHub first, then pick the repository

Owner request (2026-10-26): "Let people sign in with GitHub first, then pick the repository from a list, with the content folder defaulting to content/posts. Ship it as a PR."

## Problem
- The Next.js connect modal disables "Sign in with GitHub" until both text fields (repository, content folder) have 3+ characters. The grey text is only a placeholder, so the button looks broken.
- The owner pasted `https://github.com/thallylabs/thally-website` and `tree/main/public/blog` and got "403 Forbidden — check the credentials". Cause, confirmed on github.com/settings/connections/applications: the `thallylabs` org has not granted the Radar OAuth app (✗, "Grant"). GitHub answers 403 "…organization has enabled OAuth App access restrictions…". Radar's copy blamed credentials.
- `tree/main/public/blog` is a GitHub page path, not a folder; Radar would have written into `tree/main/public/blog/`.

## Acceptance criteria
- NRP-1: For Next.js, "Sign in with GitHub" is enabled as soon as the modal opens (no fields required first). Shopify still requires its store domain before sign-in.
- NRP-2: After sign-in, a "Repository" select lists repositories the account can push to (owner, collaborator, org member), most recently pushed first, with a repo whose name matches the business domain moved to the front and preselected.
- NRP-3: Below it, "Content folder" is prefilled with `content/posts` (an editable value, not a placeholder).
- NRP-4: A pasted folder like `tree/main/public/blog`, `/content/posts/`, or `https://github.com/o/r/tree/main/content/posts` is normalized to the repo-relative folder before it is used and stored.
- NRP-5: An org OAuth restriction 403 (and the SAML-enforcement 403) shows a sentence naming the org and how to grant Radar access, not "check the credentials". The picker carries a short "Don't see your repository?" line pointing to GitHub → Settings → Applications → Radar.
- NRP-6: Existing Next.js connections (repo stored in `fields.repo`, no `targetId`) still edit, test and publish; the stored `fields.repo` keeps working for publishing.
- NRP-7: Dev stubs (RADAR_DEV_STUBS=1) list stub repositories for Next.js so the flow works locally.

## Exclusions
- Sites whose posts are per-route folders (`src/app/blog/{slug}/content.mdx` + page.tsx), like thallylabs/thally-website. The connector still writes `{folder}/{slug}.mdx`. Reported to the owner as a separate decision.
- Granting the thallylabs org access (an owner click on GitHub).

## Delivery
PR to `main` from `kenny-dev/nextjs-repo-picker`. Merging deploys to Railway production and needs the owner's go-ahead.
