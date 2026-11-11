# Frontend implementation (E2)

Workspace: `/Users/ekene/Downloads/design_handoff_radar/radar-push`, branch `kenny/signup-security`, starting revision `f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49`. Other agents' edits and unrelated dirty release records preserved. Existing AuthShell/Field/Btn design extended; no design replacement.

## Changed files and behavior

- `src/features/onboarding/Signup.tsx`: password-free email signup, accessible named fields, server-validated Turnstile token submission, generic check-email outcome, Google conflict guidance, existing-account inbox confirmation CTA, safe next validation. Guest draft retained until backend verification. Google remains independent of the bot challenge.
- `src/features/onboarding/Turnstile.tsx`: explicit Cloudflare widget render, shared script load, action `turnstile-spin-v2`, flexible sizing, callback/expiry/error/timeout handling, retry and cleanup. Token clears after API attempts; missing key disables email path. Development stub is only supplied by server's nonproduction `env.devStubs`.
- `src/features/onboarding/VerificationRequest.tsx`: generic confirmation request/check-email state, editable email, resend cooldown, preserved safe next, clear provider/network errors, security challenge on every request, status announcement and heading focus.
- `src/features/onboarding/EmailVerification.tsx`: reads fragment token and removes fragment before interaction, holds token in memory only, explicit password selection/confirmation POST, UTF-8 password boundary, consent links, expired/replayed/invalid link recovery. Refresh deliberately requires reopening email or requesting another link; no localStorage/sessionStorage/history-state token persistence.
- `src/app/(auth)/signup/page.tsx`, `signin/page.tsx`: pass public sitekey and server-evaluated dev flag, retain metadata with noindex, use shared safe-next check for authenticated redirect.
- `src/app/(auth)/verify-email/page.tsx`: dedicated dynamic confirmation page, noindex/nofollow and no-referrer metadata.

## Acceptance

UI portions of S1/S2/S4/S5/S6 implemented, including scanner-safe explicit confirmation, loading/error/retry, keyboard labels, focus announcements and layout sizing. Security decisions remain server enforced by E1.

## Checks

- Baseline `npm run typecheck`: passed.
- Integrated `npm run typecheck` after UI implementation: passed.
- Final `npm run typecheck` after safe redirect/copy adjustment: passed.
- `git diff --check` for owned files: passed.
- Impeccable mechanical detector for four changed client components: `[]` (no findings).

Independent browser acceptance remains Q1/PM-owned. E2 intentionally did not start a server/browser before E1 database handoff. Real production widget validation and real email delivery remain configuration/provider acceptance tasks, not proven by typecheck.

## Integration

Uses `env.turnstileSiteKey` and `env.devStubs` supplied by E1, signup/resend `{ok:true,verificationRequired:true}`, verify POST `{ok:true,next}`, signin `verification_required`, verify `verification_invalid`, and backend password field errors `errors.pw`. No new dependencies or shared UI primitive edits.

## Authorized rate-limit fallback

User steering allows the shared server rate limits as the default protection while an owned Turnstile widget is unavailable. Server pages now pass `turnstileRequired={env.signupTurnstileRequired}`, derived by E1 from `RADAR_SIGNUP_TURNSTILE === '1'` (default false). Signup and confirmation request render the widget and require a valid client token only when this flag is true. In rate-only mode, no widget is loaded and no token field (including synthetic tokens) is sent; actual server IP/email/global throttles remain enforced. Enabled mode retains fail-closed missing-key and challenge failure behavior. Development stubs apply only when the widget is required in a nonproduction stub environment. Google and secure confirmation/history handling are unchanged.
