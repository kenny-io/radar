# GitHub organization repositories

User report (2026-10-30): Radar's GitHub repository picker excludes organizations the account owns or can access.

## Findings and scope
- Current OAuth scope `repo` and `/user/repos` affiliation already include owner, collaborator and organization member repositories.
- Read-only GitHub account inspection confirms Radar is Restricted for thallylabs and other owned organizations. GitHub requires separate organization approval; no grant has been made.
- Code silently caps listing at 500 repos and offers no reload after approval or direct repository entry to obtain actionable access diagnostics.
- Fix listing and recovery using existing UI/components, credentials and action contracts. No new OAuth scopes, GitHub App migration, publishing format change, org grants, merge or deployment.

## Acceptance criteria
- GOR-1: List all accessible pushable personal, collaborator and organization repos across pages beyond 500; deduplicate and retain site ranking/pushed order. Fail explicitly on fetch errors.
- GOR-2: Authorized new and existing connections can refresh repositories without reconnecting; preserve valid/current selection and folder. Show loading, empty and errors.
- GOR-3: Let an authorized user enter owner/repo or a GitHub URL when missing from list; normalize/validate server-side through existing connection test/save. Changing repository resets test success.
- GOR-4: Explain organization approval/SSO and push access accurately; 403 and hidden-private-repo 404 diagnostics provide useful next steps without claiming to bypass policy.
- GOR-5: Switching account, closing/reopening and overlapping requests cannot restore stale selections, credentials or successful tests. Existing connections and other providers keep working.
- GOR-6: Focused regression tests, typecheck and real browser checks verify integrated implementation; disclose live OAuth limits.

## Experience and delivery
Keep the existing modal and Repository select. Add Refresh repositories, loading/empty feedback, and an optional Enter repository manually control revealing a labelled input. Give exact GitHub approval location and refresh instruction. Reuse Test connection and its existing branch create/delete permission check. User must authorize any organization grant separately because that expands app access.

Deliver on `kenny/github-org-repositories` from 8dc6f844 as reviewable local changes/PR if existing delivery convention permits; no automatic merge or deployment.
