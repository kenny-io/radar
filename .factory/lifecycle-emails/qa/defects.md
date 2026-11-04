# Independent QA defects

Source base `963a2d59`, branch `kenny/lifecycle-emails`, uncommitted integrated feature. No production mutations or email sends by QA.

## Q1 — obsolete sign-in proof mutates drafts before refusal — P1, fixed and retested

AC5. Original `finishAuth` claimed the guest before `createSession` validated an obsolete password hash. Independent local database reproduction: create a password user and their onboarding draft, create a guest with another draft, replace the user's password hash (representing a completed reset), then call `finishAuth(user, undefined, oldHash)` with the guest cookie. Expected401 and no account/guest changes. Actual401, but original draft deleted, guest draft assigned to the account and guest deleted.

PM fixed by passing proof to `claimGuest` and locking/checking the account before guest/business mutations, plus passing signup's created hash. Retest `.factory/lifecycle-emails/qa/stale-signin.test.ts` passed; the engineer added a permanent auth regression. Evidence logs: `/tmp/radar-lifecycle-qa-stale.log` (failure), `/tmp/radar-lifecycle-qa-stale-fixed.log` and `/tmp/radar-lifecycle-qa-extra.log` (pass).

## Q2 — newly opened fragment link ignored while already on reset page — P2, fixed and retested

AC5/AC6. Real Google Chrome, local Next dev3931, dedicated QA database, synthetic user. Open `/reset-password` with no token and wait for invalid/missing-link state. Obtain a new reset URL, then navigate the same tab to `/reset-password#token=<new valid token>`. Browsers treat this as same-document hash navigation, so no new server GET occurs. Expected new-password form to read the new token and allow reset. Actual page retains invalid-link state; no new-password input appears. `PasswordRecovery` only parses in the effect depending on `reset`, and `parsed.current` prevents another parse; no `hashchange` listener exists.

Reproducer: `.factory/lifecycle-emails/qa/browser.ts` expired-link scenario. Original browser run recorded16 preceding checks passed and the new-password field timeout. Auth engineer added a hashchange listener, state reset and generation guard so a pending old response cannot overwrite a newly opened link. Independent retest passed45/45 browser checks in both development and the optimized production build, including this exact same-document navigation and a deliberately delayed simulated old response. Raw reset tokens are never included in tracked evidence.

## Test harness corrections (not product defects)

- Initial parallel dispatcher tests consumed other test files' queued fixtures; transport engineer added a test/operator scope, leaving production global dispatch unchanged. Independent rerun passed62/62, then full auth/billing/lifecycle190/190.
- Installed Playwright browser revision absent; QA used existing `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` in fresh isolated contexts.
- Exact Password label included a hint, and toast also has role=status. QA selectors were corrected to actual accessible input/confirmation targets.
