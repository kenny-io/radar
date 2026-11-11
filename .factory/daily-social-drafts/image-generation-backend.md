# E4 image availability repair — backend handoff

Workspace `/Users/ekene/.codex/worktrees/daily-social-release/radar-push`, branch `kenny/image-provider-errors`, starting HEAD `d8ac2d3a537c9d970e493d2e3940e8b6aba33c11`. Preserved the original dirty checkout and other agents' release records. No live provider requests, billing/credit/config changes, git mutation or deployment performed.

## Changed
- `src/server/services/images.ts`: enumerate every configured image route before applying existing cooldowns/breaker. Count an existing account cooldown or caught `account` failure as an account-blocked outcome. A transient OpenRouter breaker skip remains a non-account outcome. If all configured routes are account-blocked, return `RadarError` HTTP503, code `image_unavailable`, with exact safe copy: `Image generation is temporarily unavailable. Your previous image is kept. Please contact support.`
- `src/server/services/imageAvailability.test.ts`: nine mocked-provider behavior tests reproducing all three recorded account-error shapes, repeated cooldown with zero outbound requests, raster recovery after cooldown expiry, successful direct fallback, mixed transient500/ordinary429 plus account errors, OpenRouter transient-breaker skip, account cooldown shared with text, and optional background-template fallback.

Provider ordering, request contracts/models, shared OpenRouter account cooldown, transient breaker, direct-provider cooldowns, custom `modelRequired` strictness, image decoding/cropping and storage behavior remain as before. No UI changes: existing custom-image action preserves typed errors and image state; PackView already displays `image_unavailable` copy. No template is stored for a failed explicit request. Non-account and mixed failures retain their prior error path.

## Verification
All network requests mocked; no real paid API call. Native raster test validates a provider PNG's resulting dimensions and center pixel after cropping, distinguishing successful provider output from a template.

- Baseline: `npm test -- src/server/services/articleImagesFallback.test.ts src/server/ai/openrouter.test.ts` — **51/51 passed**. Log `/tmp/radar-image-availability-baseline.log`.
- Final focused: `npm test -- src/server/services/imageAvailability.test.ts src/server/services/articleImagesFallback.test.ts src/server/ai/openrouter.test.ts` — **60/60 passed**, three files. Log `/tmp/radar-image-availability-focused.log`.
- `npm run typecheck` — **passed**. Log `/tmp/radar-image-availability-typecheck.log`.
- `git diff --check` — **passed**.
- Exact SHA-256: images.ts `beb717a60965d3deb0dc5afade8e5f811047046d861ba0c46cffebdc5cf6dc45`; imageAvailability.test.ts `366c0d8384a11bcc47915a99c08816481e2b8e178d4ae268e27c63f3e9a516eb`.

No broad suite was necessary; the previously documented raster golden is outside these focused suites and was not changed. PM/independent QA own action/browser preservation checks and integrated release build. This software change improves the failure message; real generation stays unavailable until an eligible funded provider is restored. Existing account cooldown can last up to ten minutes after restoration. Decoding corrupt nominal-success image payloads inside fallback and direct-provider timeouts remain outside this bounded incident fix.
