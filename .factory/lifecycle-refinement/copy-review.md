# Copy decisions and review

Diagnosis B: the user supplied a recognizable founder voice and an approved reason for building Radar. Preserve that argument and vocabulary. The operational and educational messages needed clearer next actions and lifecycle context, not a different positioning story.

Applied installed skills: `/Users/ekene/.agents/skills/emails/SKILL.md` with sequence/copy/type references; `copywriting/SKILL.md` and AI-tells reference; `copy-editing/SKILL.md`. Product context comes from the user’s launch script, approved founder note, marketing pages and actual product screens. No additional interview was needed. Earlier generic sequence templates are guidance, not authority to invent discounts, social proof, guarantees or features.

## Decisions

- One message has one job. Welcome continues from the saved profile; founder explains why and invites a specific reply; billing/security remain factual; work reminders ask for one next step. Combined work mail is one digest, not several simultaneous sends.
- Keep the approved founder rationale almost intact. Replace vague sign-off filler with a request to reply with what the reader is trying to do.
- Profile activation replaces the analyzed welcome. AI/Brief/Backlinks use the existing weekly lessons. Only first-article workflow and Search Console refresh need new guide events.
- Separate the early publishing walkthrough from the later Organic Search lesson. The guide explains review→draft→publishing; the weekly lesson teaches keyword fit and search intent.
- Keep one primary CTA plus preference/support links. Use real fixed destinations and stage-aware trial/restart/setup language.
- Educational copy retains two actions and a progress check. New guides use relevant saved states. Meaningful preheaders extend subjects and are escaped/hidden in actual HTML; plaintext senders stay plaintext and their first paragraph provides the inbox preview.
- Preserve 30-minute confirmation,1-hour reset,14-day invitation, trial/pricing values from constants and actual invoice/date fields. No fake Re:/Fwd:, invented urgency, measured gains, customers or anecdotes.
- Partner notices distinguish proposed/approved placement from verified live status. Removal asks for 7 days and points to in-app status rather than promising a nonexistent confirmation email. Qualifier changes have a distinct truthful subject.
- All user-facing messages have an email-preference destination. Optional category wording explicitly says lessons and guides share the same opt-out. Security/billing trigger and delivery rules are preserved.

## Independent findings addressed

Architect and QA identified duplicated article instructions, a nonexistent page-filtered-query drilldown in Performance, unconditional joining instructions for already-joined users, copied-versus-posted ambiguity, setup/lapsed prerequisite gaps, and unclear shared-category opt-out wording. All were corrected from actual product behavior. Search Console itself is named for page-filtered queries.

QA rendered bounded but unbroken profile/recipient text at 390px: original cards expanded to 1314/3106px. Fixed outer/card table layout and inherited wrapping; identical stress inputs now stay 390px. Evidence remains under qa/stress.

The separate report’s preheader is generic when no missed question exists; its HTML now has an accessible document frame and safe long-word wrapping. Original queued payloads remain frozen. Its unmerged measurement feature still needs main verification/migration integration before release.

## Review artifacts and metrics

`previews/index.html` uses actual shared and legacy builders, with an optional pure formatter imported from the separate local report feature. Fictional examples are explicit. Plaintext bodies are labeled rather than presented as nonexistent HTML emails. `all-emails.txt` includes complete subjects, preheaders, triggers, cadence and body copy; `catalogue.json` distinguishes28 families from extra access/role/data variants.

Measure accepted/suppressed/blocked guide counts and opt-outs through existing ledgers. Review existing content approval and feature-action events after messages without claiming causal attribution. No open-tracking pixel, new analytics service or fabricated conversion benchmark was added.

## Numbered catalogue and current-main integration

The user requested complete refined copy with permanent review numbers. The final catalogue has **29 families / 69 full variants**, with #1–#29 and lettered alternates. Existing bare references stay unchanged when a fallback is added (for example #6 and #6B). `catalogue.html` is the continuous reading view with an index and expandable alternates; `catalogue.md` and `all-emails.txt` contain every body without truncation; `index.html` shows actual visual email previews. Each variant includes subject, preheader where applicable, full body/footer, trigger and cadence. Fictional details and inactive preview tokens are explicit.

The additional variants cover missing invoice/payment details, subscription setup expiry, neutral setup subjects, disconnected Search Console and missing report comparison/topic. These expose existing renderer branches and do not create extra sends. The new main Autopilot owner handoff is #29. Its actual builder is refined, retaining dynamic saved actions/drafts/source links, scoped destinations and count, plus Email preferences and explicit program management. The first-article guide now states at the start that its steps assume a review-first workflow with both Autopilot and Blog autopilot off; enabling either can permit publication without separate review. No sixth course lesson or historical catch-up was added.

Regenerate with Node 22 and `node --import tsx scripts/preview-radar-emails.ts --companion-root /Users/ekene/Downloads/design_handoff_radar/radar-push`. Compatibility weekly/nurture/lifecycle entry points also need `--import tsx` because their actual templates are TypeScript modules. These commands render only and never schedule/send. Final integration verification supersedes the earlier 28-family/55-variant checkpoint above.
