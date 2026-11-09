# LC2-Q independent verification plan

Initial source: clean HEAD f616862c7dcefb1aabec9155972466f7b3aeaf36, branch kenny/weekly-education, /Users/ekene/.codex/worktrees/radar-weekly-education/radar-push. This task supersedes no previous test evidence: prior weekly results are history, not fresh LC2 evidence.

QA owns only this directory; no feature/runtime changes, delegation, merge/deploy, real provider request or production writes. Fresh local Postgres15 DB radar_lifecycle_refinement_qa_20261109 on127.0.0.1:54329, Node22.18.0, no worker. Browser URLs/test account will be confirmed once integrated runtime is ready. Ordinary synthetic verified password accounts with appropriate local access fixtures; no admin bypass. All provider sends mocked/captured. Current legacy sendMail does not honor dev stubs when a key exists, so tests explicitly prevent real transport.

Skills read: installed emails2.1.5 (sequence-templates, email-types, copy-guidelines), copywriting2.3.3 (AI-tells), copy-editing2.2.2 (checklist). No product-marketing context file found. Diagnosis B: supplied founder story and practical feature drafts carry a real voice; review must preserve their argument while improving clarity. QA recommends copy changes through PM and never edits the author's runtime source.

## Contracts awaited

- LC2 PRD/acceptance criteria and architecture scheduling mapping for all seven previously unscheduled drafts. Existing welcome/founder and weekly feature lessons must be reused, with no duplicated campaign; workspace-ready stays retired.
- Actual variant manifest and renderer/capture entry points, including security confirmation, team invite, four partner notices, work reminders, education, billing/core, any unique article workflow/GSC lesson, internal team mail and separately bounded local report. Do not silently equate template type count with rendered variants.
- Enrollment/cutover/cohort model, actual delays, exit conditions, cross-flow cap/priority, opt-out category, deterministic account/business context, in-flight payload/version policy and supported delivery states.

## Checks derived from user behavior and failure modes

1. Seven-draft mapping: each original draft has one executable event/lesson mapping or dedicated new trigger, correct audience/delay/skip, and source-backed inventory. No duplicate welcome, founder or feature introduction; no history broadcast or overdue burst. Fresh/late-verified/no-business/pretrial/trial/paid/comp/lapsed users and multiple businesses; guests/unverified/optout exclusion.
2. Time/state: actual provider-accepted cadence, downtime, day/DST windows, retry/ambiguity, collector/dispatcher concurrency, pause/resume/completion, essential priority, shared optional cap and no starvation. In-flight old jobs keep key/body, new renderer/version cannot replay delivered lessons. Database and startup guard empty+upgrade.
3. Send-time relevance: current recipient, verified status, category choice, ownership/membership/access, workflow already completed, GSC disconnected/no data, expired source or trial-start conversion. No tenant data/link leak or cookie switch before authorization.
4. Copy: concrete baseline source frozen under before-source (HEAD-derived, no runtime import). Review before/after subjects, preheaders, body, primary CTA and audience for every actual variant. Verify factual UI steps/labels, prices($1confirmation,3days,normally$49firstmonth/$50renewal), dates/expiry, approved founder story, billing/security obligations, distinction between measured and missing AI data, and explicit manual publication/approval. No fabricated outcome, testimonial or urgency. Seven editing sweeps + human contextual AI-tell review; exact word matching will not stand in for behavioral assertions.
5. Rendering: actual HTML/text per family, hidden preheader present/useful/escaped and not duplicated visible body; mobile390 and desktop600, natural logo/typography, no overflow/clipping, one primary task with correct action links, scoped footer/settings, safe literal dynamic HTML/header text and no bearer token images/logs. Inspect screenshots visually, not just DOM counts.
6. Browser: ordinary password/confirmation/invite relevant flows and actual CTA auth return; settings/unsubscribe including no-business/lapsed, keyboard, read/write failures, refresh and slow stale read; business-switch and foreign resource denial, no generation/approval/payment effects on GET. All local captures only; never HTTP-only evidence for affected UI.
7. Evidence: exact final integrated source fingerprint/build, fresh commands/results/screenshots, failed/blocked/not-applicable separately, baseline raster mismatch retained without relaxing snapshots. Report defects early with criterion/severity/repro/expected/actual/revision/evidence; retest integrated fixes.

## Limits

Actual SMTP/provider acceptance/inbox placement, hosted production migration/load and native Gmail/Outlook rendering remain out of local scope. Separate original-checkout AI report remains separately scoped unless explicitly integrated. Existing code/template snapshots may be used for comparison, never called evidence of new runtime behavior.

PM clarified inventory:26baseline user-facing families = confirmation1+invite1+partner4+core9+individual/combinedwork5+weekly5+separatelocalreport1. Newarticle_workflow/search_refresh add2=28families; welcome access/profile and lesson access-state outputs are additional variants. Internal support/feature forwards remain operational and outside copy rewrite. Confirmation remains actual plaintext with existing encrypted/redacted auth capture; do not invent an HTML provider output for gallery completeness.

## Architecture-resolved adversarial cases

Read architecture.md in full once published. Newtype lifecycle_guide with article_workflow/search_refresh state peruser/guide; account-owned outbox rows, separate course progress; exact first-observed anchors and30day unattempted/23hour retry window. Both guides share education permission, flag, signed token, cap and suppression preflight.

Specific matrix:
- Article: workspace+24h versus savedpretrial/lapsed+3days, lateraccess onlyshortens; first-observednow foroldaccounts; alreadyproposed calendar remainseligible, ANYotherowned meaningful article status/generatedbody skipspermanently, foreign/member-only workdoesnot. Queuedsource/businesschange mustnotrebind.
- Search: connected+property+lastSyncedThrough AND pageimpressions>0 within28completedbusiness-localdays AND exactorganiccourse outboxstatussent/sentAt. Test logged/attempted/notqueued prerequisites, oldupdatedAt versusfreshobservation, current/future/stale/zerodata/query-only, AsiaDubai/Honolulu local-midnight boundaries. Due=max(observed+24h,organicaccepted+7days). Lapsedwithretainedmeasureddata remainseligible with truthfulpublicCTA.
- States: concurrentcapture/assignment once; pausewaiting/queued40days thenresume originaldelay/samekey; no optout monopolization; temporaryGSCerror/missingdata defersuntilboundedexpiry, identity/source loss skipsbeforeattempt andblocksafterattempt; exactfrozenretry andatomicack rollback; sent/skipped/blocked neverreset byreenable orcoursecompletion.
- Priority: essential→weekly→guides→founder→work, strict24hcap/daytime preserved; SocialMarketing collision delaysrefreshguide; guides neveradvance/resetworklynextLesson. Securitymail staysoutsideoptionalcap.
- Compatibility: queueoldwelcome/founder/weekly/work envelopes before rewrite; attemptedandunattemptedcore snapshots retained ascontract, allowedfirst-attempt education/work refresh versus post-attempt immutable; no replay to delivernewwording. NewguideFK RESTRICT standalone deletion andnormalusercleanup; canonicalupgradeafter0012andread-onlystartupguard.
