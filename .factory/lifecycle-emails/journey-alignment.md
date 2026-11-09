# Email journey alignment

Owner correction: Radar analyzes the website and creates a Business Profile before the primary signup flow completes. A welcome message asking those users to add a website or create a profile repeats work they have already done. The founder message should explain why Radar was built and offer help.

## Current copy and trigger context

- New password and Google signup capture the current authenticated guest session before the account-creation transaction. Inside that transaction, `queueSignupEmails` reads only that guest's newest onboarding draft and requires a nonempty `site.analyzedAt` proof. It freezes `profileAnalyzed` and the business display name in the encrypted welcome payload before normal guest claiming transfers the profile. No arbitrary business/guest IDs from request bodies are accepted; no guest-draft foreign key is attached to the welcome row.
- The primary welcome now says the Business Profile is ready, names the business and continues from the existing profile. Its `/dashboard` link uses the existing guard to reach the trial, unfinished onboarding or an active workspace as appropriate. It does not claim that a trial is active or that reports/drafts already exist.
- Direct signup, an expired guest session or an unfinished latest analysis gets a neutral account-ready message. Those users are not falsely told that a Business Profile exists, and older/other visitors' profiles are never borrowed.
- The workspace-ready email describes the workspace opening when `commitDraft` activates it. It no longer describes the earlier website-analysis/profile-creation step as happening again. Scan/data collection can still be in progress.
- The owner supplied the launch-video script as the factual source for the founder's reason: building products has become easier; discovery beyond the founder's network is still a full-time job; Radar was built to take on that marketing work and help good products reach the people who need them. The note now contains that reason and an offer to help if anything is unclear. Its action is a reply to Ekene through the existing `team@thally.io` address. No invented anecdote or setup lecture. Video-production directions inside the supplied script are source context, not a request to create a video in this task.

## Verification and release

Focused database/template checks:31 passed (signup6, existing guest-claim9, templates16); typecheck/diff checks pass. Independent QA adds two request-boundary probes and local rendered previews; see `qa/journey-alignment/` and the reviewer report. No provider calls, customer sends, billing/configuration changes, merge or deployment. This updates the same PR25. Earlier full-flow/build evidence remains tied to its original revision; these checks cover the new context wiring and copy.

Final optimized build passed on the corrected source, `NEXT_DIST_DIR=.next-lifecycle-journey`, build ID `Dkx2XsEZiU_IuZAm9gOI_`; log `/tmp/radar-lifecycle-journey-build.log`. Generated Next TypeScript includes were removed from the deliverable. The current source fingerprint is `2a853cd54a02a6b2e567b225ce148ba207757d50cec362a1e4c6ec428d5d8824` (476 files, sorted by complete relative POSIX path; see the manifest for the distinction from older component-sort hashes).
