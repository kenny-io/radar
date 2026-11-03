# Radar lifecycle emails and launch readiness

Owner request: audit launch readiness, draft the ten most useful customer email events, and wire them into Radar. Branch `kenny/lifecycle-emails`; source base `963a2d59` (production source matches `origin/main` `f9eb6178`; branch adds indexing records). Preserve unrelated indexing evidence.

## Scope and experience

Ten events: welcome with next steps; founder service check-in; password reset; workspace ready; trial started; trial ending; payment received; payment failed; cancellation scheduled; subscription ended. Reuse the existing Radar design language and verified `radar@thally.io` sender, `support@thally.io` for service replies and `team@thally.io` for the founder note. All templates have useful plain text and accessible HTML. Account recovery reuses the current auth shell, fields and buttons, with request/sent, reset/success, expired/invalid, rate limit and mobile/keyboard states.

No announcement campaign, automatic mailing of historical customers, new provider spend, live payment mutation, unrelated site changes or ownership changes. Founder content concerns setup/support only, contains no promotions, and provides an easy opt-out for optional onboarding mail. Billing and security notices remain essential service messages.

## Acceptance criteria

- AC1: Ten reviewed templates match actual Radar behavior, use safe escaped values and working app destinations, identify Radar/Fairspleet LLC and provide reply contacts. Date/amount copy comes from authoritative state; workspace readiness never claims uncompleted analysis.
- AC2: Password and Google signup enqueue welcome once for newly created real accounts; guests and ordinary signins receive no signup mail. Founder check-in is delayed, once per eligible new account, and suppressible.
- AC3: Committing a workspace queues readiness once for its owner, in the same persistence boundary. Subscription trial, payment, cancellation and end events queue once against owned/current billing objects, with stale/replayed webhook protection and truthful dates/amounts.
- AC4: Durable dispatch survives worker restarts; bounded timeouts, atomic claims, stable provider idempotency, bounded retry/backoff, terminal failures, provider acknowledgments and audit counts are covered. Email failures never replay a charge or lose the underlying customer action. No production email contents or credentials in logs/records.
- AC5: Password recovery offers non-enumerating responses, bounded requests, random single-use expiring tokens stored hashed, password validation, session revocation and no auto-login. Reset links are excluded from indexing and protected against referrer leakage; GET does not consume a token.
- AC6: Local stub mode cannot send real email. New flows and existing auth/billing behavior have meaningful database-backed tests, typecheck/build and independent browser verification, including mobile and failure paths.
- AC7: Delivery includes reviewable PR, an accurate launch checklist and rollout/rollback instructions. Repository policy requires owner approval before merging auto-deploying main; no claim of deployment or inbox delivery without evidence.

## Known launch items to reconcile

Scheduled private offsite backups await the owner's destination; a local restore drill passed. Prior provider audit found exhausted OpenRouter credit with working Anthropic fallback. Public Google consent verification, external uptime monitoring and actual email receipt were not established by earlier checks. Search sitemaps are successful; indexing requests remain partly quota/access blocked and do not guarantee index inclusion. Recheck current evidence rather than treating old unchecked checklists as live truth.
