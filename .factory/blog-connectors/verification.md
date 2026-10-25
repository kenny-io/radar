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

## QA (B4): independent verification on e999e58d (product code = 538e934c)
Environment: QA DB `radar_qa`, app on :3100 (`RADAR_DEV_STUBS=1`, `RADAR_REAL_CONNECTORS=wordpress,ghost,webhook`). Real WordPress 6.9 on :8381 (admin and Author app passwords), Ghost 5.130 on :2381 and the HTTPS webhook receiver on :9381. Browser: the built-in pane, plus Playwright for the OAuth popups. Evidence is in the QA scratchpad, `qa-b4/01…41` plus `logs/`.

| Check | Result |
|---|---|
| Typecheck | clean |
| `npm test` (radar_qa) | 320 passed, 44 skipped, 1 failed: the baseline `openrouter.qa.test.ts` snapshot |
| Live suite, harness env only | 89 passed, 15 skipped (`publisher.live` needs a DB) |
| Live suite, harness env plus `DATABASE_URL` | 103 passed, 1 skipped |
| `npm run build` | pass |

| AC | Verdict | Browser evidence (summary) |
|---|---|---|
| BC-1 | Pass, with one caveat on "only available platforms" | **WordPress Test connection:**<br>• bad password → "401 Unauthorized — check the credentials"<br>• unreachable → "Couldn't reach localhost:8399 — check the URL"<br>• wrong path → "404 Not Found — check the credentials" (documented divergence, still pending approval)<br>• good password → "test draft created, then deleted". WordPress REST and DB show no leftover draft or trash.<br>**Ghost:** a bad key gives 401 copy; a good key passes and leaves no draft.<br>**Webhook:** the test passes and the receiver verifies the `radar.test` request; a forced 403 gives "403 Forbidden — check the credentials".<br>**Author:** the Author app password connects too.<br>**First approval with no blog (new business):** Approve opens PublishIntro, WordPress connects, then the mode step, then the article is scheduled and Publish now publishes it. The onboarding wizard itself has no publish step, so this first-approval flow is what was tested.<br>**Caveat:** with dev stubs on, all ten platforms are listed, so the filter that hides unconfigured OAuth apps can't be observed here (code-reviewed only). |
| BC-2 | Pass | **WordPress Publish now:** Published, and View post opens `/time-tracking-for-designers/`.<br>• Title, slug and excerpt (= meta) are set.<br>• The featured image is uploaded with its alt text.<br>• h2, ul, sources and links render.<br>• The YouTube embed block is a bare URL for the stub id, as expected.<br>**Author connection:** published as author 2, and the video embed block is still present.<br>**Ghost:** `<title>` and `meta_title` are the edited SEO title; the feature image has its alt text; excerpt and content are correct. `newsletter` and `email` are null, so no email was sent.<br>**Webhook:** View post serves the received page.<br>**Scheduled publish:** a worker job (`manual:false`) published the entry at the set time (02:00 Europe/London). The schedule was set back to 09:00 America/New_York afterwards. |
| BC-3 | Pass | The refresh entries were prepared with SQL (`mode`/`url`), because GSC isn't connected.<br>• **WordPress:** post 234 was updated in place, with the same id and URL. The post count stayed at 84.<br>• **Ghost:** the same post id and URL were kept, and the post count stayed at 64. |
| BC-4 | Pass | • **Ghost container stopped, then Publish now:** retried, then shown as Failed ("Ghost returned no response from localhost:2381"). After a restart, Retry made exactly one post.<br>• **Saved-draft reuse (synthetic):** I created a Ghost draft and set it as the entry's `publish_remote`. Both Publish now and the **Retry button** (`publish.retry`) published that draft, and no new post appeared (66→66 and 67→67).<br>• **Code check:** `startPublish` doesn't clear `publishRemote`.<br>• The live suite covers the real case where a publish fails after the draft step. |
| BC-5 | Pass | • **Webhook 401 and 403:** fail at once (one attempt), the article banner names Webhook, Settings shows "Needs reconnecting", and the Dashboard shows the Needs attention item. The status clears after a successful retry, or after Reconnect → Test → Save, which retries automatically.<br>• **503 and 429:** 4 attempts with the stub backoff of +3, +6 and +12 s (the code uses 30 s, 2 min and 8 min in production). The `Idempotency-Key` stays the same, and the connection stays OK.<br>• **422:** a single attempt, no retry.<br>• **Taken slug on WordPress:** got `-2`, and Radar recorded the `-2` URL. |
| BC-6 | Pass | I recomputed `v1` independently, using the UI-generated secret over `t.` plus the raw body, and it matches; the Python scheme also matches.<br>• Headers: Content-Type, User-Agent, Radar-Event and Idempotency-Key (= article id).<br>• The envelope (`evt_` id, type, created, business) and all 15 documented `article` fields are present, with no extra fields. |
| BC-7 | Partial (stubs) | WordPress.com and Notion: the Connect popup reaches the callback and shows "Authorized".<br>• Pickers list the stub sites and databases.<br>• Test connection passes and Save stores the target.<br>Doc conformance relies on B2 plus the mocked-HTTP tests, which pass. Live posting is an owner step and is not marked passed. |
| BC-8 | Pass | Typecheck, tests (baseline only) and build all pass.<br>• Framer, Next.js, Shopify, Webflow and Wix: the stub auth, picker and Test connection all work.<br>• The calendar → draft → approve flow works.<br>• Settings → Publishing layout is fine, and the default switch persists across reloads. It was set back to the admin WordPress connection. |
| BC-9 | **Open** (B3) | `LAUNCH.md` has both callback URLs. `DIVERGENCES.md` hasn't changed since `ea70ecb2`, so this tranche's behaviour isn't logged:<br>• WordPress videos sent as embed blocks<br>• Ghost `meta_title` taken from the SEO title<br>• write redirects refused<br>• the OAuth 404 "can't see that …" copy and the 3xx copy<br>• the `RADAR_REAL_CONNECTORS` switch (row 157 still says every connector is stubbed)<br>• the Notion API version (row 155 says `2022-06-28`; the code uses `2025-09-03`) |

**Observations** (not regressions; these components are unchanged in this branch):
- Two connections to the same site show the same label ("WordPress · localhost:8381", "To WordPress"), so you can't tell which account each one uses.
- Webhook Test success says "test draft created, then deleted" (documented divergence).
- With an `http://` endpoint, Test is disabled and no hint explains why.
- At 375 px the Connection options button wraps under each row.
- Opening a dialog leaves focus on `body`. Escape does close it.

Test-data changes (in `radar_qa` and the harness only, no product code):
- SQL set refresh mode on two entries.
- `publish_remote` was injected twice, for the synthetic reuse checks.
- The webhook connection URL was swapped to `?status=401/403/422/429/503` and then restored.
- An extra business, `qa-onboarding-blog.com`, was added, plus stub connections for WordPress.com and Notion.
- The test posts remain in WordPress and Ghost.
- The receiver's `webhook-secrets.txt` was restored from backup, so the `radar_qa` webhook connection's secret is no longer accepted.
- No scheduled or failed entries are left.
