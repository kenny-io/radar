# Observability production release — November 10, 2026

**Merged, deployed on both services, and test alert delivered with owner authorization.**

- PR: https://github.com/kenny-io/radar/pull/38
- Source: `8b0fc3462c2709788cfa730d2f80c3ffee014a30`; tested head `8eb03772cce207a1b809a7d89a00062e2d495b99`, identical tree.
- Web deployment: `a1d27185-bca3-4879-a37b-f7960c9a9d86`, SUCCESS.
- Worker deployment: `e14bd6ce-2434-4990-a9a5-1af7dc17db42`, SUCCESS.
- URL: https://radar.thally.io

Current-production security, image-account cooldown, publishing and Autopilot behavior were preserved by an observability-only transplant. No schema/dependency changes or runtime credential/billing configuration changes were needed. The original extensive dirty checkout remains intact; the isolated release is based on secure main `b38b67a4`.

## Runtime and email evidence

Both actual containers report the deployed merge SHA, production mode, development stubs 0, failure alerts enabled, recipient kenny@thally.io, configured verified Radar sender and registered `observability.alert` job. Six source hashes match the tested release; worker startup is logged. Readbacks are saved in `qa/release-runtime-{web,worker}.json`.

The marked synthetic alert was sent using `node --import tsx scripts/test-failure-alert.ts` inside the deployed worker. No real provider outage or customer failure was created.

- Alert ID: `26afa389-4d2f-4dae-a61f-2136e06e8cbf`.
- Resend message ID: `01a1c226-8ec2-7a51-994c-58298a716fad`.
- Sender: `Radar <radar@thally.io>`; recipient: `kenny@thally.io`.
- Subject: `[Radar production] Failure: observability.smoke`.
- Created: November 10, 2026 at 01:11:09 Dubai (November 9 at 21:11:09 UTC).
- Resend get-email status: **delivered**, exact recipient and unique synthetic alert ID/body matched. Verified at 21:11:44 UTC.

This is provider-confirmed delivery, without claiming that a person opened the inbox. The durable job stores the provider receipt. See `qa/release-test-alert.json`.

## Verification

Production build/typecheck/diff checks passed. Release suite:982 passed,231 skipped, one unchanged baseline image snapshot failure (baseline915 passed/227 skipped/one same failure). Independent isolated PostgreSQL 55/55 and focused provider/image/security-mail/transport 39/39 passed, including exact immediate/queued receipts and immutable payload/key replay.

Independent live Chrome visited homepage, sign-in, privacy and terms: all 200, expected content, sign-in controls present, zero browser errors. `/api/health` returned 200 with `{ok:true}`. Evidence in release-qa.md and qa/release-browser-results.json. No account creation, generation, posting or payment mutations were made for QA.

## Recovery

Disable failure emails consistently on both services with `RADAR_FAILURE_ALERTS=off` if required; structured diagnostics remain. Inspect retained alert jobs and the 23-hour retry/idempotency guard before replay. Binary rollback target is secure preceding `b38b67a4` on both services; no database rollback required. Preserve current credentials, billing and business settings.

Requested release and delivery verification complete; no outstanding feature blocker.
