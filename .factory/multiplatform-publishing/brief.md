# Direct social publishing release

User authorized shipping Instagram, TikTok and YouTube publishing to production on November 19, 2026 (Asia/Dubai), after configuring developer apps and staging server credentials.

Scope: connect/reconnect/disconnect, Instagram Unified Login with explicit account selection, generated-image and uploaded-video attachments, required provider audience/disclosure choices, direct/scheduled publication, durable processing recovery, worker support and existing X/LinkedIn regressions. Preserve current production Autopilot/email scheduling behavior. Extend the existing UI; no new design direction.

Acceptance:
- AC1: Production settings expose configured Instagram/TikTok/YouTube connections through secure tenant/Editor OAuth, with encrypted server-only tokens.
- AC2: Instagram supports JPEG/Reels, TikTok photos/videos and YouTube video. Actual owned media and per-post choices are validated; absent choices block posting clearly.
- AC3: Post now and Schedule use real provider adapters. Workers preserve accepted provider references and do not duplicate uncertain publications.
- AC4: Unified Instagram grants bind login mode/config/version and authorized assets; legacy grants preserve their API host/refresh behavior.
- AC5: Existing production X/LinkedIn, opt-in automation, email cadence and account security remain intact.
- AC6: Feature-only port onto current main, focused tests/typecheck/build, independent local browser QA and live deployment/read-only verification.
- AC7: Report provider review restrictions honestly. Shipping cannot grant external platform approvals or make sandbox-only public publishing available.

Delivery: feature-only PR to main, merge and observe existing Railway web/worker deployment on the same revision. Do not activate other businesses' automation preferences or publish unspecified test content.
