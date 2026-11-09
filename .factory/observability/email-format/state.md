# Alert email formatting

User requested a better-formatted email after receiving the production plain-text test. Existing deployment/test authorization applies to this corrective update.

Base: current secure production main4908694f (publishing recovery PR39); branchkenny/observability-email-format in existing isolated release worktree. Preserve source/auth/publishing/retry behavior.

Design: warm Radar canvas, white narrow card with orange brand accent, clear human heading/status, concise summary, prominent next step, readable environment/service/time facts and lower-priority grouped diagnostic IDs. Test mail is labeled TEST and does not claim a live failure. Degradation text appears only for a fallback incident. Accessible email-safe HTML and a well-spaced plain-text alternative; no external images/fonts/dependencies.

Acceptance:
- HTML is persisted at envelope creation and sent verbatim with text; legacy jobs without HTML remain exact text-only replays.
- All provider/error/context strings are HTML-escaped; long values wrap at mobile widths.
- Distinct test/failure/fallback copy and subjects are clear, with relevant issue and action details.
- Independent Chrome visual checks desktop/mobile/dark, focused transport/render checks and typecheck/build pass before release.
- Deploy identical source to both production services; send one revised marked test to Kenny and verify exact Resend delivered status.

Owners: engineer core owns formatter/delivery/tests; QA owns independent visual/replay evidence; PM owns integration/commit/PR/deploy/send/verification. No new architecture phase needed for presentation-only change.

Status: implementation active. No revised test sent yet.

Validation: renderer/delivery focused21/21 pass; independent24 Chrome cases plus hostile markup/legacy exact replay checks pass. Production build passed36 pages and types. Full suite1012 passed,231 skipped and the unchanged pre-existing image golden mismatch. Final post-build typecheck and worker-first rollout next. New HTML-aware worker is deployed before new web can create HTML envelopes; then both services move to the same merged revision, followed by one refreshed marked email and exact provider-delivered verification.


Released: PR https://github.com/kenny-io/radar/pull/40 merged as 108d6e1ae70f82f3fdfd854ca79fcc4579b2a172. Worker-first compatibility rollout 340dc028-42b4-486d-baf2-d807c612a63f succeeded and matched the formatter source hashes before merging. Final web 0da3581e-6ec4-46a9-98f9-84d839314bb8 and worker 6e5bdfed-f01a-453a-ab1c-bee3bd65450c both SUCCESS at the merge SHA; both actual runtime probes match tested renderer/delivery hashes and confirm HTML+text, correct test subject, alerts enabled and Kenny recipient. Health 200/ok.

Concurrent main advance PR41 changed only separate publishing renderer/evidence; observer formatter files remain identical to tested head 64b44b3a. Post-merge publishing/render plus formatter/transport 44 tests pass. No unrelated changes overwritten.

One refreshed marked test was sent from the deployed worker: alert fd238249-1efb-4a1c-bbb6-490439214a2d, Resend 01a1c244-41a5-7078-b018-8d64c9eec7ff, subject [Radar] Test alert. Resend confirms delivered to kenny@thally.io and retains the actual HTML, title and matching alert ID. Created November 10 at 01:43:35 Dubai (November 9 at 21:43:35 UTC). This confirms provider delivery, not a human opening the message. Evidence: test-delivery.json and runtime-{web,worker}.json. Requested formatting update, deployment and refreshed preview delivery complete.
