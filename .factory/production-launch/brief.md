# Radar production launch readiness

Date: 3 November 2026 (Asia/Dubai); target launch: 4 November 2026.
Base: main 0a9af070; workspace carries unrelated existing home-release records and tsconfig changes, which are preserved.

## Problem and scope
Verify and harden the existing product's public legal pages, account creation, paid trial and pricing, core access boundaries, deployment readiness, database and event-stream behavior under concurrent traffic. Retain the existing visual design and $1 card confirmation credited toward the first $50 month after a three-day trial. No new pricing, publishing policy, or infrastructure vendor.

## Acceptance criteria
- AC1 Public privacy/terms/bot and contact links load on mobile and desktop, describe actual processors and payment/trial/cancellation behavior, and contain no invented operator identity or unverified guarantees. Operator identity/jurisdiction needs owner input.
- AC2 Signup/signin validate and bound inputs, reject malformed requests safely, throttle abuse across replicas, persist sessions, preserve safe destination/profile flows and prevent Google identity confusion.
- AC3 Billing preserves price validation, one $1 confirmation/credit, three-day trial and cancellation/restart behavior. Distinguish local stubs, real sandbox payments and live configuration; no billing activation before outstanding acceptance and grandfather policy are resolved.
- AC4 Production mode, shared storage, keys and deployment topology are checked without exposing secrets; readiness checks exercise database availability; DB pool waits and stream polling are bounded.
- AC5 Meaningful focused tests, integrated typecheck/build, independent real browser smoke and a bounded local concurrent-load test record observed limits. Do not assert unspecified heavy-traffic capacity from a single machine.
- AC6 Concrete reviewable changes and rollout/rollback checklist. Existing repository policy requires owner go-ahead to merge auto-deploying main. Prepare changes and PR first, retain billing off pending a separate activation decision.

## Experience
Use existing pages/components. Errors remain inline and actionable; rate limits return 429 with a useful retry message. Public policies use the existing legal shell. Health endpoint reveals status only. Preserve authenticated workspace behavior and SSE event contracts.

## Ownership and dependencies
A1 architect: traffic/security/infrastructure design, db pool and SSE resilience/readiness implementation.
E1 engineer: account/auth/billing audit and fixes with regression checks.
Q1 independent QA: read-only live baseline then integrated local browser and regression evidence.
PM: legal consistency, dependency review, integration, load testing, records and authorized delivery.

## Known baseline
`npm test` without DATABASE_URL: 655 pass, 177 skip, one pre-existing raster golden mismatch (openrouter.qa.test.ts, expected f883614e6a7dfb07 vs current native rendering 91d5409f50974af7). Do not replace golden to mask a regression. Full DB tests will run against an isolated local database.
