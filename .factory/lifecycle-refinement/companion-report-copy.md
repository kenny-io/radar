# LC2 local AI report copy companion

Original workspace: `/Users/ekene/Downloads/design_handoff_radar/radar-push`, base HEAD `f9eb61786db4ae1a6ce9cbbd81ddaef1243bcd49` plus existing unrelated dirty work and prior local companion default/preference changes. LOCAL ONLY. No commit/staging, provider send, database write or production action. This copy patch is against the exact source captured at the start of LC2, after the earlier weekly-education companion patch. Do not overwrite or replace that earlier patch with this one; apply them in order only to the matching measurement source.

## Copy decision and review

B: the existing report already makes a concrete measurement argument: counts, comparable prior period, a missed question and review. The rewrite retains that argument, leads with understandable collected-answer counts, and adds paragraph spacing. Read emails/copywriting/copy-editing SKILL.md and their copy-guidelines, AI-tells and checklist references. No local product-marketing context file was found.

Actual sender subject remains `Recommendation share this week · {domain}`. Body explains completed UTC days, current and previous collected answers, signed percentage-point change or unavailable comparison, most missed question and saved topic only when present. The sole primary CTA is **Review all answers**. **Email preferences** remains the footer action with the supplied signed URL. A proposed topic is described as awaiting review rather than an already-written article. Missing-data and variable-answer limits remain explicit. No unsupported guarantees, new timing claims, or new sender were introduced.

Applied clarity, voice, evidence, specificity and action-friction checks: current/prior numbers are sourced from the summary; percentage changes remain percentage points; absent miss highlights do not imply every answer mentioned the business; a missing topic ID never promises a saved proposal. Read-aloud/AI-tell pass removes the old em dash introduction and filler guarantee slogan. These are editorial checks, not an independent QA claim.

## Shared preview contract

Pure absolute import: `/Users/ekene/Downloads/design_handoff_radar/radar-push/src/server/services/visibility/digestContent.ts`.

`recommendationDigestContent(summary, appUrl, preferencesUrl)` returns `{ text, html, preheader }`. Summary structurally needs `weekly` and `weeklyBiggestMiss`. Its only import is a type-only `VisibilitySummary` import, erased at runtime; there are no DB/env/provider imports. The preheader is generic and contains neither tracked question text nor signed token URLs. QA precision fix: it describes collected answers/comparison/next review without promising a missed question. A zero-miss regression test covers preheader and body when all current answers mention the business. HTML escapes all dynamic text/URLs. QA framing fix: full doctype/html lang=en dir=ltr document, charset/viewport/title, semantic main, inherited overflow-wrap:anywhere and word-break:break-word, and width:100%/max-width:560px/box-sizing:border-box container. Long unbroken escaped prompt markup is covered in formatter tests; independent browser mobile QA remains separate. No brand image or new asset dependency. Sender calls this exact formatter at enqueue and persists both bodies. The existing `recommendationDigestText` export remains available through digest.ts and the pure module for compatibility. Preview must import the pure module, not digest.ts, to avoid job registration/DB imports.

## Checks and unchanged boundaries

`npx vitest run src/server/services/visibility/digest.test.ts src/server/services/visibility/digestPreferences.test.ts src/server/services/visibility/history.test.ts src/server/services/visibility/digestContent.test.ts src/lib/recommendationShare.test.ts`: PASS, 5 files / 39 tests (33 existing mocked boundary/measurement tests plus six formatter tests).

`npm run typecheck`: PASS after changes. Inspected exact before/after digest diff: queue sender's only behavior change is calling the pure formatter; scheduler, default-on logic, eligibility, status controls, token generation and idempotency keys unchanged. Existing queued payloads keep their frozen body on dispatch, so older messages do not receive this copy rewrite. No real DB/browser/provider verification performed here.

This remains a separate unreleased measurement report, not the lifecycle education sequence. Original base lacks canonical verified-mailbox eligibility; before release integrate main/PR26 verification at queue and dispatch and reconcile the colliding measurement migration numbering. This copy patch does not resolve those existing release blockers or claim production readiness.

## Exact LC2 task fingerprints

Empty before hash denotes a newly created file. Patch SHA256: `ef8f571115fef39c79b0db0ae13f5d4eeee203f78509e563405cd34690d45022`.

| File | Before LC2 | After LC2 |
|---|---|---|
| `src/server/services/visibility/digest.ts` | `5f6d1222ef7983f6428a50d147f58954dab5a41e0970f40d617b6fcdcbc49855` | `a16f8f7916180ffcbf82425a541ea92f95e1931357b00d80f57e5a928b96900c` |
| `src/server/services/visibility/digestContent.ts` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `b1463aca4c7d5e4db05f7608ecda3c1d95fcda0b28b66bc378d1e567a712b360` |
| `src/server/services/visibility/digestContent.test.ts` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` | `164e1926aec5d445e58ae01e874f0ce82e373d34b9d60cd1f67f0165e48c0aba` |
