# Image prompt prefill

November 9, 2026. Follow-up to the authorized daily-social production release.

The social pack image field now starts with a usable editable prompt built locally from the post topic and copy, selected visual style, business name and brand colors. Existing saved image prompts and pack custom direction take precedence. Explicit edits, including clearing, remain authoritative while switching platforms. No additional model call or database migration is needed for prefill.

Scope: `src/features/social/PackView.tsx` only, plus this record. No publication, worker, provider or image-generation API behavior changes.

Validation on current production base `83f77476`:
- Typecheck, production build and diff check passed. Build log `/tmp/radar-image-prompt-build.log`.
- Impeccable detector returned no findings.
- Local real Chrome: seven browser checks passed, with no runtime errors. Verified prefill/Generate enabled, saved prompt, edit preservation, clear/disabled state, legacy pack reload, exact prefilled prompt submitted to the existing image action and 390px mobile layout.
- The local stub environment has no image model: the submission correctly returned its existing unavailable error and retained the prompt. No real image-provider call or customer change was made. UI fixture restored, QA server stopped and generated tsconfig edits removed.
- Initial harness selector mismatches were corrected using the incumbent label/tab markup; no product defect was found.

Production rollout pending.

Source SHA-256: `665150ea765b6c38534eb6ecb1d83e20a7b79c52b2d51786de4e27b08bcbf52a`.
