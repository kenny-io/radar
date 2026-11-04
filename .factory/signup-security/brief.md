# Signup security

User request: implement email confirmation, secure Google account linking, add signup Turnstile, handle existing accounts safely and verify the fixes.

Scope: email/password signup and confirmation/recovery, Google identity resolution, session/privilege verification boundaries, optional server-validated Turnstile, shared rate limits, migrations, existing auth UI states, configuration and rollout documentation. Preserve businesses, memberships, guest drafts, billing access and subscriptions. No bulk email or production account/payment mutation. Delivery: implementation and verified reviewable branch; no merge/deploy request in this chat.

## Acceptance criteria

- S1: Password signup does not grant an authenticated user before mailbox ownership confirmation; cryptographically random, hashed, expiring, single-use confirmation/recovery tokens. Scanners/GETs do not consume or authenticate.
- S2: Confirmation is transactional, race/replay safe; inbox owner chooses/confirms their own password so an attacker cannot seed a credential. Guest draft and safe intended destination survive same-browser completion. Invalid/expired links and provider errors have clear retry paths.
- S3: Google requires verified provider identity; matching an unverified email cannot retain attacker password or sessions. No silent linking of established verified accounts solely by matching email. Existing mixed-credential accounts have a safe migration policy.
- S4: Existing password users must prove mailbox ownership; existing Google users retain provider access. Existing unverified sessions cannot reach app/admin privileges. Preserve records/billing and provide a usable inbox-based recovery path.
- S5: Per user steering, signup defaults to shared IP/address/global limits with no widget dependency. Explicit RADAR_SIGNUP_TURNSTILE=1 adds accessible Turnstile and strict server validation before writes/email work; missing/invalid/replayed/wrong-action/wrong-host tokens and config outages fail closed when enabled, with no automatic fallback. Mail sender remains required in production. No development bypass in production; expiry/failed submissions permit retry.
- S6: Verification/resend and public signup have IP/account/global throttles and generic account-existence responses; tokens/passwords absent from application logs/outbox payloads and URLs sent to third parties. Existing invite token requirement preserved; admin authorization never trusts an unverified address.
- S7: Meaningful database tests cover audit reproductions and new boundaries; independent desktop/mobile browser QA covers success/error/retry; integrated typecheck/build/tests with baseline exceptions documented.

## Experience

Extend incumbent AuthShell/Field/Btn design. Signup presents a check-email state after success, preserves safe next and guest cookie, supports throttled resend. Confirmation page reads token from fragment where feasible, removes token from URL, presents password choice and explicit confirmation; loading, expired, unavailable, success states and keyboard/mobile access. Sign-in gives existing users a clear email-confirmation recovery path without implying a registered address. Google conflict copy gives a safe way forward. No redesign.

## User steering: rate limits as active protection

User authorized: “if you can't figure it out, leave turnstile and protect via IP, or rate limiting the sign ups.” Existing Thally credentials are valid but hostname metadata is unavailable. Default to rate-only protection with a shared10/IP/hour budget across signup and resend,3/address/hour and300global/hour, plus route IP limits. Keep Turnstile as explicit optional enhancement; never silently bypass it when enabled. Distributed attackers can consume fixed quotas; email confirmation remains mandatory for account access.
