# AI support in Radar

User wants a floating bubble head in the dashboard that answers Radar questions or forwards the query to their email. Confirmed destination: support@thally.io, via existing SUPPORT_INBOX configuration. Work in the supplied checkout, preserving ongoing signup-security and launch changes. Delivery: implemented and verified locally; no production deployment requested.

## Journey and design

Extend the existing dashboard visual system (Geist, neutral theme tokens, orange signal). Bottom-right compact circular assistant head opens a nonmodal, labelled support panel without blocking dashboard work. Use a simple authored vector face consistent with the existing icon stroke. Header: Radar support / AI assistant. Intro and starter questions explain what can be asked. Plain-text conversation, thinking state, labelled composer, Enter to send / Shift+Enter newline, close/Escape and focus return. Panel fits mobile viewports and both themes; respect reduced motion. Do not cover or compete with existing dialogs. Keep chat in memory across panel close and navigation; reset on user/business changes and refresh. No browser transcript storage.

AI answers use curated product guidance and minimal server-resolved workspace context. No tools, browsing, account mutations or claims of live account inspection. Unknown/account-specific requests and provider failures clearly offer human help. Email support is always reachable after a question; user explicitly chooses to forward the conversation, with account email shown as reply contact. Confirm only accepted delivery; failures retain conversation and allow retry. Email includes question/conversation, authenticated user's contact, business, page, and support reference. No silent emailing from AI output.

## Acceptance criteria

- AC1: Signed-in dashboard users can open/close the floating support head, send a nonempty question and read an AI answer; dashboard navigation remains usable.
- AC2: Answers follow maintained Radar knowledge, use bounded conversation/context, and offer human handoff for unknown requests or AI failure.
- AC3: User can explicitly send a query/conversation to support@thally.io; verified identity and business context accompany it. Live missing mail configuration or delivery failure never reports success. Development capture is identified honestly.
- AC4: Endpoint requires signed-in user and active membership (Viewer allowed), rejects cross-business access and malformed/oversized input, rate limits AI and email separately. Transcript excluded from shared business events/logs; AI cannot trigger mail.
- AC5: Loading, empty, sending, sent and retryable error states; prevent duplicate in-flight submissions. Business switching prevents stale conversation/response leakage.
- AC6: Usable desktop/mobile, light/dark, keyboard, reduced motion; accessible control labels, live response announcements, focus on opening and return on close, no horizontal overflow.
- AC7: Meaningful tests, independent browser QA, configuration documentation, no unnecessary dependency/schema changes.

## Constraints and assumptions

Reuse existing AI routing, Resend configuration/outbox, authentication/membership and Postgres rate limits. No migration. Dedicated support endpoint avoids generic action telemetry. Keep support accessible through its endpoint for signed-in business members regardless of subscription. No actual external support emails during QA. Real AI answer quality and actual inbox receipt require configured live providers; deterministic development checks must be labelled as such.
