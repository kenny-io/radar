# Independent QA — Reddit copy opens a new tab

## Local acceptance: passed

Factory QA verified `/Users/ekene/.codex/worktrees/reddit-copy-release/radar-push`, branch `kenny/reddit-copy-new-tab`, base `8bc73298a9d9273a172e2806afa138e66e932794`. Final three source/test fingerprints are in `qa/browser-results.json`; all match the engineer's handoff.

**17/17 actual Chrome browser scenarios passed**, zero runtime exceptions. Local current-source Next dev server at `http://localhost:3134`, Node22.18.0, installed Google Chrome via Playwright, desktop1440×950 and mobile390×950. Playwright's default `--disable-popup-blocking` argument was explicitly removed: normal flows use Chrome's actual user-gesture popup policy. Normal copy paths use the real browser clipboard and native `window.open`; only denied/delayed clipboard cases and the initial blocked-popup attempt are explicitly injected.

**141/141 tests passed independently**, eight files: `npm test -- src/features/brief/redditCopy.test.ts src/lib/promptClipboard.test.ts src/lib/socialPublish.test.ts src/features/social/channels/logic.test.ts src/server/services/brief/replyBrevity.test.ts src/server/services/brief/plan.test.ts src/server/services/brief/rules-figures.test.ts src/server/services/brief/cap.test.ts`. Evidence `qa/focused-tests.log`. Engineer separately reported successful typecheck and completed production build. QA scoped diff check passed.

### Acceptance coverage

- AC1 passed: footer Copy reply, top Copy reply, Copy again and keyboard C open a separate validated Reddit thread `/#comments` tab. Original Radar stays on `/brief`, retains the current edited response and shows copied / “I posted it”. The clipboard exactly matches the response; actual `ControlOrMeta+V` pastes it into the destination textarea.
- AC2 passed: native popup creation succeeds with normal Chrome popup policy. Delayed clipboard keeps the reserved page on `about:blank`, with no copied mutation or external request before resolution. Delayed save likewise keeps it blank until success. External destination requests record that copied/edit persistence already completed. New page reports `window.opener === null`.
- AC3 passed: denied clipboard and failed persistence close any reserved page, preserve Radar URL/response and display existing actionable guidance. No same-tab fallback or external Reddit request occurs.
- AC4 passed: blocked initial popup copies/saves successfully, leaves Radar untouched and presents Open Reddit. That explicit action opens a new tab with exact clipboard text and null opener. A user-closed reserved tab recovers the same way. Missing/invalid destinations copy without any new tab or automatic navigation.
- AC5 passed: edited Plug response, just-edited keyboard response, repeat copy and mobile top action work. Header copy still precedes the variant switch. Repeated C during a pending write reserves only one tab. Non-Reddit reply remains copy-only; focused regression tests preserve feed/social and brevity behavior.

No outstanding observed defect. Recommendation: **ready for authorized delivery**; production verification pending merge/deploy.

### Evidence, environment and cleanup

- Browser command: `/Users/ekene/.nvm/versions/node/v22.18.0/bin/node .factory/reddit-copy-new-tab/qa/browser.mjs` after starting matching `qa/server.mjs`.
- `qa/browser-results.json`, `qa/browser.log`:17/17 results, fingerprints and zero runtime exceptions.
- `qa/radar-remains.png`: original Radar after actual copy/paste in a separate tab; `qa/comments-new-tab.png`: synthetic destination with actually pasted text; `qa/mobile-before-copy.png`: mobile top action; `qa/popup-blocked.png`: explicit recovery.
- Screenshots visually inspected after animation settling. Ordinary local `dev@radar.local` session on existing isolated local QA database; browser intercepts synthetic workspace/action responses and external Reddit destination. No real business fixtures were modified.
- Dedicated server3134 stopped and port confirmed closed after engineer build completion. QA removed its output include/reordering and restored tsconfig byte-for-byte to the pre-start snapshot, preserving all other work. Successful production `.next` build retained.
- Browser save/persistence responses are intercepted; existing persistence backend was not changed. Live Reddit login/layout/composer and actual posting were not exercised. No production mutation, account creation or live provider call.

## Production verification

Pending merge SHA, successful web/worker deployment IDs and architect actual-container source/asset readback. Prepared `qa/live.mjs` for public health/browser and served new-tab bundle verification. No authenticated production session is available to this QA browser; no new session/account will be created. Local real-browser clipboard/new-tab behavior is the functional proof, tied to the deployed source fingerprints after release.
