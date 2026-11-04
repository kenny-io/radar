# Dashboard AI support

The floating support assistant appears inside Radar’s signed-in dashboard shell. It answers from maintained product guidance in `src/server/services/support/knowledge.ts` and minimal business name/domain context. It cannot inspect payments, change settings or execute actions. Unsupported questions and AI failures offer an explicit **Email support** handoff; the model never sends email. Review guidance when product behavior changes.

## Configuration

Reuse existing server-only environment variables:

- `SUPPORT_INBOX=support@thally.io` (confirmed support destination).
- `RESEND_API_KEY` and a verified-domain `MAIL_FROM` for actual handoff delivery.
- Existing AI provider keys/model routing. No new AI SDK, database migration or dependency.

Missing AI credentials fall back to the human help offer. Missing mail configuration returns an unavailable error; Radar never claims an email was sent when it was only logged. With `RADAR_DEV_STUBS=1` in nonproduction, AI is deterministic and emails are captured in `outbox_emails` with `status=logged`, even if live credentials happen to be present. The UI identifies capture instead of delivery. Production disables stubs.

## Data and reliability

`POST /api/b/:bid/support` checks same-origin browser requests, a signed-in non-guest identity and active Viewer-or-higher membership. Support deliberately remains available independent of paid generation access. The endpoint accepts at most 32KiB, a 2,000-character question and twelve 4,000-character history messages. Ask limits: 30/hour and 100/day per user, 100/hour per business. Mail limits: 5/hour and 10/day per user, 15/hour per business. Limits are stored in Postgres and shared across web replicas; retries count toward limits.

Chat history stays in browser memory until refresh or business/account change. It is sent as bounded context to Radar’s existing AI provider when asking a question. Only the explicit email handoff persists the transcript in the existing outbox. The route does not write shared business events or log transcripts. The email includes authenticated account contact, business context, page and a reference; replies go to the authenticated user’s email. Treat user-provided transcript contents as unverified.

Each handoff request UUID is scoped to user/business into a deterministic outbox UUID and Resend idempotency key. A Postgres advisory transaction lock serializes concurrent delivery attempts. Repeated successful sends return the original reference; changed payloads with the same ID are rejected. Provider failures/timeouts are recorded without raw responses, and the same payload/ID can be retried. To avoid replay after the provider’s 24-hour deduplication window, unresolved requests expire after 23 hours. Accepted delivery means the provider accepted the email, not guaranteed inbox receipt; inspect Resend delivery events for bounces. Outbox retention follows existing operations policy.

AI uses the business’s configured writing route with validated structured output, no retries and a 5-second timeout per provider route. Existing failover can try up to six routes (roughly 30 seconds total). The endpoint has a 60-second runtime budget. Email delivery uses a 10-second timeout. No automatic background retry sends mail without the user’s retry action.

## Verification and rollout

Run `npm run typecheck`, the focused support tests and independent browser checks. Development verification must not send real emails. Before production activation, confirm configured model responses against real Radar questions and verify actual receipt/reply behavior at support@thally.io using an authorized test. The local stub verifies workflow and failure handling, not live model quality or inbox delivery. Rollback: remove the AppShell widget mount and support route; no schema rollback required.
