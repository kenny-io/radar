# Search Console reconnection banner

User request: show a banner that is subtle in design but hard to miss when Search Console needs reconnection. Production diagnosis found `token refresh failed: invalid_grant` for thally.io; current UI mislabels it as a temporary error and offers Resume.

Design: extend the existing Radar app UI. A compact, pale warning banner above page content, with an outlined warning icon, strong title “Reconnect Search Console”, short explanation, and a clear reconnect button. Persistent until recovery; no dismiss control, animation, overlay, or interruption. Wrap naturally on phones. Existing typography, button, color and focus conventions apply.

Acceptance criteria:
- GSC-AC1: Recognized invalid/revoked/missing Google authorization in an error connection shows the banner throughout the active business app; healthy, syncing, skipped, unconnected and transient provider failures do not falsely request reconnection.
- GSC-AC2: Reconnect launches real existing Google OAuth from a user click and recovers the selected property without requiring Disconnect or deleting historical data. Cancellation, denied consent, popup failure, missing property access and retry failures remain actionable and retain the warning.
- GSC-AC3: Dashboard, Performance and Settings agree that authorization failures need reconnection and do not offer misleading temporary-error/Resume recovery for those failures. Transient failures retain retry behavior.
- GSC-AC4: Banner is visible near the top on desktop and mobile, readable with accessible contrast, keyboard reachable, and has no horizontal overflow. Busy state prevents duplicate reconnection. Business switches cannot apply stale recovery to another business.
- GSC-AC5: Existing tenant and Editor-or-higher authorization remains enforced; Viewers see an appropriate instruction to ask an editor/admin, without a nonfunctional action. No raw provider diagnostic is shown to users.

Constraints: preserve all unrelated working-tree changes; no dependencies or migrations. User approved production shipping after reviewing the banner. Release only this feature onto current production main; do not include unrelated local changes. Re-run checks and browser QA on the isolated release source, then merge and verify deployed services. Do not perform real Google consent or change the user's Search Console connection during verification.

Architecture decision: use shared classification of existing status/error data and a dedicated `gsc.reconnect` action with no property input. After Google consent, validate the saved property's access and resume its existing cursor/incremental import. OAuth callback alone must not clear the warning. Bind popup messages to their window and captured business; ignore stale UI updates after business switches. Keep recovery failures actionable. No design service was available; existing Radar components/tokens are the design authority.

Release adaptation: current main already has nonce-bound, COOP-safe OAuth and centralized revision-aware writes. Preserve those contracts. Add explicit Cancel sign-in with AbortController/unmount cleanup and invoke the current app action only immediately after an active-business check. Preserve billing/activity shell features. Release base `ba78a2cfd413428ec1ef3e69708e299dc3aecdea`.
