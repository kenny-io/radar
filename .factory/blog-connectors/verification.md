# Verification: blog-connectors (tranche 1)

Baseline (main @ ea70ecb2): typecheck clean; tests 260/261 (known `openrouter.qa.test.ts` snapshot); build passes.

## Integrated revision 538e934c (PM)
| Check | Result |
|---|---|
| Typecheck | clean |
| `npm test` (no harness) | 320 passed, 44 skipped (live), 1 failed = baseline `openrouter.qa.test.ts` |
| Live suite `src/server/services/publishing` with `bc-self/.data/connectors/harness.env` (real WordPress 6.9.4, Ghost 5.130, HTTPS webhook receiver) | 103 passed, 1 skipped (refresh n/a for webhook) — includes wpcom/notion mocked-HTTP (38) under B1's redirect change |
| `npm run build` | pass |
| Engineer evidence | B1: UI publish to real WordPress/Ghost/webhook, refresh in place, retry reuse, 401 → Needs reconnecting (scratchpad b1-shots). B2: wpcom/notion connect + pickers in UI on stubs; docs-checked |
