# Publishing planner recovery

User request: Fix handling of large generated repository files, explain rejected plans clearly, and verify both previously failed articles can publish through production Radar.

Scope: bounded generic repository discovery with metadata and recoverable unavailable/oversized source feedback; preserve SHA-grounded complete source edits and independent review; actionable, safe failure diagnostics for validation/review/repair and honest UI attribution. No framework-specific shortcuts, skipped manual registration, weakened evidence, destination code execution on Radar, schema migration, or automatic destination PR merge.

Acceptance criteria:
- PPR-1: Oversized generated artifacts cannot accidentally abort discovery when the authored source/generator/build chain establishes the integration; never treat skipped/truncated content as inspected or editable evidence.
- PPR-2: Mandatory source too large/unavailable has an explicit bounded failure; safety, limits, and atomic no-write-before-approval remain enforced.
- PPR-3: Empty plan, changed-file count, edit count, source review defects, and repair rejection each retain the specific reason/context with safe bounded diagnostics; no secrets exposed from untrusted model/source text.
- PPR-4: Article/dashboard copy distinguishes Radar validation from a remote GitHub rejection, while existing remote errors retain their meaning.
- PPR-5: Focused meaningful regressions, broader publishing checks, typecheck, build, independent QA, and real browser failure smoke pass on the integrated revision.
- PPR-6: Deploy reviewed fix through existing GitHub/Railway workflow, retry e_2UQxRIMM and e_2Qcpo76u, and confirm each creates one complete source-reviewed draft PR. Verify article body, route/listing integration and destination build/preview; distinguish opening a PR from a live destination publication. User's request authorizes Radar release and real retry; destination PR merges remain outside scope.

Start: origin/main 8b0fc3462c2709788cfa730d2f80c3ffee014a30. Existing dirty primary checkout preserved; isolated managed worktree on kenny/publishing-planner-recovery.

## Live verification follow-up

PPR-7: The analytics retry revealed a separate renderer defect: an internal Search Console research reference with url'#' was emitted as a public Sources link, including a title disallowed by destination audit. The repaired planner correctly rejected it and retained the original review issue. Filter only unusable public source URLs at shared sourcesList (HTML/Markdown/payload.sources); preserve stored body/source evidence and valid citations. Do not rewrite article punctuation or weaken source review/body insertion. Release this narrow follow-up, then retry analytics and complete its exact-head destination verification.

## Publication continuation, November 10

User explicitly requested merging both article PRs and verifying the articles live on Thally. This supersedes the earlier destination-merge exclusion. PPR-8: merge reviewed PR137 andPR138, preserve both complete source integrations, verify actual production routes/blog listings/full content/images/canonical/navigation/fresh+reload/mobile and generated discovery surfaces. No preview-only substitute for production acceptance.
