# R8 — Reddit copy opens a new tab

## Workspace and scope

Release worktree `/Users/ekene/.codex/worktrees/reddit-copy-release/radar-push`, branch `kenny/reddit-copy-new-tab`, base `8bc73298a9d9273a172e2806afa138e66e932794`. This base includes the separately released image-generation changes. Preserve them. The architect owns this record only; the engineer owns the existing Reddit copy helper, its tests, and the bounded DailyBrief recovery toast change.

## Interaction contract

- Keep the Radar tab open. Never call current-tab `location.assign` or use a same-tab fallback.
- Validate the comments destination first. Initiate `copyPromptText(text)` synchronously, then reserve `window.open('about:blank', '_blank')` within the same click/keyboard gesture. Retain the returned handle by omitting the `noopener` feature, and immediately set `tab.opener = null` while its document is blank.
- Await successful clipboard completion, then the existing persistence callback. Only after both succeed, call the reserved tab's `location.replace(destination)`.
- On clipboard rejection or unsuccessful persistence, close the reserved tab best effort. Preserve the existing copy/save error semantics and duplicate-copy guard.
- Missing/invalid destinations copy and save without reserving a tab.
- Blocked popup, user-closed reserved tab, or failed tab navigation returns an explicit recovery result. Present a truthful copied status with an **Open Reddit** action. That fresh user gesture opens the validated destination with `_blank` and `noopener,noreferrer`. Radar stays open even if recovery is blocked.
- The existing top Copy reply button, Copy again, and C shortcut share this helper. The separate I posted it confirmation remains.

No schema, server API, dependency, environment, migration, or infrastructure changes. Reuse the existing safe Reddit URL builder. No customer data or remote content is written before successful copy and persistence; the blank tab has no external content when its opener is severed.

## Verification required

Focused tests must assert ordering (clipboard initiation, reserved tab, clipboard resolution, persistence resolution, new-tab navigation), both failure cleanup paths, blocked/closed tabs, invalid URLs, opener isolation, and absence of same-tab fallback. Actual browser smoke must exercise clipboard permissions/focus, exact copied edited text, successful new-tab destination, Radar remaining open, repeat copy, keyboard copy, recovery action, and desktop/mobile layout. Mocked popup tests alone do not establish browser focus/user-activation behavior.

## Production baseline and release path

Read-only Railway status inspection after branch creation:

| Service | Active successful deployment | Source SHA |
| --- | --- | --- |
| web | `99271c2b-bf78-4f0f-9fc1-2ca597fcf154` | `8bc73298a9d9273a172e2806afa138e66e932794` |
| worker | `615b3da3-1c34-4919-8726-202dcf50b804` | `8bc73298a9d9273a172e2806afa138e66e932794` |

Project `863ea66d-04b9-40e8-b27f-89a4f75c026e`, production environment `168aae6e-c038-4198-910a-e388afaac157`; web service `0c4df5c5-938d-421e-a16a-1c0781ac5118`, worker service `711ee076-4ac6-48f4-8721-91757f22cf7f`. Existing GitHub-main triggers deploy both services. The prior production-source fingerprint verification belongs to the earlier release record; this baseline is current deployment-status metadata, not a new actual-container hash readback.

Current read-only GitHub API checks: main branch protection returns 404 “Branch not protected”; repository rulesets are empty; base commit check-runs are empty. No new CI gate identified. Merge only the bounded correction and its evidence after integrated QA, observe both automatic deployments at the new merge SHA, then verify actual container source fingerprints, public readiness and the served brief asset. PM owns authorized delivery. No manual redeploy or runtime configuration change is required.

Rollback reference is the successful baseline pair above, which preserves the separately released image-generation work. Roll back only the correction if a defect is found; do not restore the earlier Reddit release over newer main changes.
