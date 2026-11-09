# Alert email formatting QA

Task: improve the plain-text operational email presentation without changing alert delivery or persisted retry behavior. QA owns this record and visual evidence only. Workspace `/Users/ekene/.codex/worktrees/radar-observability-release/radar-push`, branch `kenny/observability-email-format`, baseline `4908694fb6c63ce618e83843d30203af739fe9dd`.

Expected checks: branded inline HTML with plain-text alternative; human subject/title; clear TEST label and absence of real incident claims for probes; conditional fallback/degradation text; grouped actionable details; escaped untrusted diagnostics; semantic heading and presentation-table roles; desktop and320/375px overflow/readability including long errors/IDs; light and dark color-scheme contrast. New HTML must be persisted and immutable. Previously queued envelopes lacking html must replay their original exact text-only provider payload/key.

Status: awaiting core fixture/render handoff. No live sends, production changes, account actions or provider calls from QA. Local browser fixture evidence and independent transport checks pending.

## Independent result — GREEN

Reviewed renderer/delivery changes and ran actual installed Chrome against the frozen fixtures.

-24render cases PASS: test, credit failure, provider fallback and long diagnostics at960px desktop,320px and375px mobile, each in light/dark color schemes. Zero horizontal overflow. All visible text passes per-size contrast checks (4.5:1normal text /3:1large text). Explicit dark background rendered asrgb(23,23,21), light canvasrgb(250,249,246).
- One semantic h1, language en, presentation roles on layout tables; no script elements or event-handler attributes in all cases.
- Visually inspected desktop test/credit,320px long diagnostics, dark desktop test and375px dark long diagnostics. Test is clearly labeled, says no customer/provider action failed, has an obvious no-action-needed panel and no raw SyntheticTest/fallback diagnostic in the primary message. Real failures show issue/provider/status and next action; long errors and IDs wrap fully rather than truncate.
- Independent hostile-markup probe renders provider/error/cause/hint strings as literal text in actual Chrome; no injected image/script/event handler is created or executed.
- Independent mocked transport probe confirms original legacy text-only JSON body and idempotency key are byte-exact with no html property, even after changing current sender/application configuration. New envelopes include both html and text, and their persisted HTML/text/key replay identically. No provider/network/email call was made.
- Independent focused renderer/delivery/queued-receipt suite:3files21tests PASS. `git diff --check`:PASS.

Evidence: `qa-render-results.json`, `qa-transport-results.json`, reproducible `qa-render.mjs`/`qa-transport.ts`, and `screenshots/`. Representative desktop preview: `screenshots/test-light-960.png`; mobile/error evidence: `screenshots/long-diagnostics-light-320.png` and `screenshots/long-diagnostics-dark-375.png`.

Tested production-file fingerprint: `7e8aaa38b437458ed430493fb24303ee102bc9683f8f63cebce638d2733964ec` over lexically sorted `src/server/observability/email.ts` and `src/server/observability/delivery.ts`, each filename+NUL+bytes+NUL. Base commit `4908694fb6c63ce618e83843d30203af739fe9dd`; formatting changes uncommitted at review. Source did not change during these checks.

No blocking defect found. Browser evidence is Chrome rendering email HTML, not a direct Gmail/Outlook client test. Email-client-specific CSS behavior and forced client color inversion are not claimed verified. Actual revised production send/delivery and web/worker rollout remain PM-owned; QA sent no mail and changed no production state.
