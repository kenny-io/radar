# Radar email inventory

The reviewed lifecycle release is deployed in production through PR #25 (merge `2d41a8015effc35fb90d0af12875ebb3963adaa5`, 2026-11-10 Dubai). Matching web and worker passed hosted migration, live browser and provider-simulator acceptance; normal first lessons are already provider-accepted. The weekly AI report #28 is also deployed through PR #42 (merge `93be7642a7a880bca6f9c40dbc9619ff6684f5b1`), using the same durable lifecycle transport. All29 active user-facing families are wired in the matching live web/worker release; #5 remains retired.18 exact migrations, worker configuration/cron registration and independent production browser checks passed. Exact current revision/deployment/schema/activation evidence is recorded under `.factory/lifecycle-refinement/shipping/`; see its state and verification before inferring an inbox receipt from source status. Catalogue copy uses fictional examples.

The weekly-education implementation builds on pending PR #25, integrating main safely. All registered verified accounts are eligible for five weekly lessons by default, including pre-trial, trial, paid, complimentary and lapsed accounts. Recorded opt-outs remain honored. Event-driven emails still require their actual trigger. Guest/unverified addresses and provider-suppressed recipients do not receive the education course. One account receives one sequence across businesses, not one per business. The first lesson waits for daytime/optional-mail capacity; subsequent lessons wait at least seven days after provider acceptance. Five then complete, with no loop or catch-up burst.

The weekly recommendation-share report is separate from lesson 1. Its canonical implementation captures append-only real observations and uses completed UTC weeks, current tracked-question series and an independent per-business default-on preference. It shares lifecycle encryption, suppression, retry identity, daytime and the optional-mail cap. No invented historical baseline is imported from the original dirty measurement checkout. Unrelated research/public-check/dashboard work remains outside this release.

| Number | Status | Revised subject | Trigger | Cadence | Content |
| --- | --- | --- | --- | --- | --- |
| #1 | Live lifecycle release | Put your Business Profile to work / Welcome to Radar | Account confirmed or new verified Google account created | Once/account | Continue from existing analyzed Business Profile, or neutral account-ready next step |
| #2 | Live lifecycle release | Why I built Radar | New verified account | Planned24h later; optional cap/daytime can delay | Ekene’s reason for building Radar and offer to help |
| #3 | Live lifecycle release | Reset your Radar password | Valid password-reset request | Per request; one-hour single-use link | Password reset and session-security guidance |
| #4 | Live lifecycle release | Your Radar trial is on | Trial successfully activated | Once/trial | Trial activation, exact end date, subscription continuation and card-confirmation credit; no cancellation prompt or routine price |
| #5 | Retired | Trial-ending reminder | No trigger | Never sent | New queueing is disabled; pending reminders are suppressed without replay or deleting history |
| #6 | Live lifecycle release | Your Radar subscription receipt | Qualifying invoice-paid webhook | Per qualifying invoice | Actual amount/currency and invoice download path |
| #7 | Live lifecycle release | Your Radar subscription needs attention | Invoice payment-failure webhook; still unpaid at send | Per eligible failure event | Update card/pay invoice and access implications |
| #8 | Live lifecycle release | Your Radar cancellation is confirmed | Current subscription changes to cancel at period end | Once/actual transition | Access end date and no renewal; resume link |
| #9 | Live lifecycle release | Your Radar subscription has ended | Current subscription enters canceled/incomplete_expired | Once/actual transition | Ended/expired setup state and account restart path |
| #10 | Live lifecycle release | New conversations in your Daily Brief | New Daily Brief remains without copied/posted reply | After1h; same-day relevance window | Review conversations, edit a reply and participate |
| #11 | Live lifecycle release | Your content plan is ready for a decision | New content plan has no approval/scheduling action | After24h; once/source | Review useful topics and complete the next step |
| #12 | Live lifecycle release | Make a social pack from a saved article | Newly ready article has no article-sourced social content | After2h; once/source | Create and review social posts from the article |
| #13 | Live lifecycle release | Give your saved social posts a publishing time | New pack has no copied/scheduled/posted content | After24h; once/source | Review the saved posts and publish/schedule/share |
| #14 | Live lifecycle release | Your open decisions in Radar | Two/three unfinished source actions are eligible together | Combined; at most one new optional email/account/24h | Up to three relevant next steps across owned businesses |
| #15 | Live lifecycle release | Does ChatGPT or Claude recommend {business}? | Verified account enrollment, including existing users | First of five; daytime/cap respected | Collect two questions, interpret mentions/citations and compare stable counts |
| #16 | Live lifecycle release | Add a real example to {business}’s replies | Lesson1 provider-accepted | At least7 days later | Add firsthand detail to suggested replies and track copied/posted follow-through |
| #17 | Live lifecycle release | How {business} could appear on another site | Lesson2 provider-accepted | At least7 days later | Join the optional network, review proposals and check live placement |
| #18 | Live lifecycle release | What should {business} publish next? | Lesson3 provider-accepted | At least7 days later | Compare topic search intent and keyword estimates with actual search measurements |
| #19 | Live lifecycle release | What could {business} teach in one social post? | Lesson4 provider-accepted | At least7 days later; sequence ends | Use An idea for a customer question, edit with a real example and track post status |
| #20 | Live lifecycle release | What happens before an article goes live | Eligible owned profile/workspace with no meaningful content workflow | First observation +24 hours with workspace access; +3 days pre-trial | Choose a topic, review the draft, connect publishing and control what goes live |
| #21 | Live lifecycle release | Your next article might be a page you already have | Real recent Search Console page data plus accepted Organic Search lesson | Later of readiness observation +24 hours and Organic Search acceptance +7 days | Evaluate an existing-page refresh; public guide with accurate private-data prerequisites |
| #22 | Live lifecycle release | Confirm your email for Radar | Password signup or requested confirmation resend | Per request;30-minute one-use link; rate limited | Confirm mailbox and choose password |
| #23 | Live lifecycle release | {inviter} invited you to {business} on Radar | Owner/Admin invites a teammate | Per invitation;14-day acceptance link | Business, role and invitation acceptance |
| #24 | Live lifecycle release | {business} approved a partner link on {page} | Incoming backlink proposal approved | After20-second Undo window | Exact proposed sentence, target, anchor, qualifier, disclosure and placement instructions |
| #25 | Live lifecycle release | {business} passed on a partner link | Backlink rejected with a note | After20-second Undo window | Proposal and decline note; silent decline sends nothing |
| #26 | Live lifecycle release | Link removal request from {business} | Removal requested for a live backlink | Per removal request | Page/target/anchor and request to remove within seven days |
| #27 | Live lifecycle release | Partner link not found on {page} / Partner link attribute changed on {page} | Live link becomes missing or loses qualifier; manual Re-check can repeat | Weekly verification detects transitions; manual action can notify again | Both owners receive the link and issue requiring attention |
| #28 | Live lifecycle release | Recommendation share this week · {domain} | Active business with collected AI answers in the preceding week | Monday after08:00UTC/12:00Dubai; once/business/week; daytime/cap may defer | Current/previous recommendation share, change, biggest miss and proposed topic |
| #29 | Live lifecycle release | Radar Autopilot: {N} action needs/actions need you · {business} | Owner-enabled Autopilot finds new owner actions | Per deduplicated action batch; separate from lifecycle cadence | Prepared drafts, source links, business-scoped actions and Autopilot management |
| #30 | Live lifecycle release | Too busy to keep up with publishing? | First observed eligible verified owner with a usable Business Profile | Once/account, earliest +48 hours; daytime/cap/weekly priority can defer | Founder introduction to autonomous content/social execution; open the correct business’s Settings → Autopilot; access prerequisites adapt |

Education subjects have neutral fallbacks when no business name exists. Pre-trial/lapsed/setup variants explain the prerequisite and give the appropriate next-step CTA. Core lifecycle messages, work reminders and weekly education use HTML/plain text and a compact Email preferences footer button. Optional categories can be stopped independently without suppressing security/billing messages. New/missing work preferences default on; existing persisted false values remain off. Only new work events are captured, so rollout does not send a historical backlog. Weekly lessons take the next eligible optional slot ahead of work reminders, preserving the24-hour cap and essential-mail priority.

The seven former drafts now have runtime destinations. Copy is imported from actual renderers by the compatibility preview adapter, not kept as a second set of editable drafts.

| Former draft | Actual destination | Cadence |
| --- | --- | --- |
| Put your Business Profile to work | Analyzed-profile welcome replacement | Immediate after confirmed account creation |
| Why I built Radar | Existing founder event | Planned +24 hours; cap/daytime can defer |
| What happens before an article goes live | article_workflow guide | Untouched workspace +24 hours; pre-trial profile +3 days |
| Would an AI assistant recommend your product? | Existing AI Visibility lesson | Course lesson 1 |
| Find one conversation you can help with | Existing Daily Brief lesson | Course lesson 2 |
| Read the sentence before you agree to the link | Existing Backlinks lesson | Course lesson 3 |
| Your next article might be a page you already have | search_refresh guide | Real data +24 hours and at least 7 days after Organic Search lesson |

The first-observation clocks begin after activation of the running feature. Meaningful content work permanently resolves the first-article guide. Search data, ownership, recipient and preferences are rechecked before delivery. Guides are once per account and share the education category; course progress is not reset. See `.factory/lifecycle-refinement/schedule.md` for exact eligibility and exits.

**Retired:** `Your Radar workspace is ready` remains removed and suppressed. There is no additional welcome, founder or duplicate AI/Brief/Backlinks campaign.

Three operational email families go to Radar’s team or operator:

| Status | Subject | Trigger/cadence | Content |
| --- | --- | --- | --- |
| Live, internal | Radar support request | User explicitly selects Email support; retry deduped | Conversation, page/business context and reply contact |
| Live, internal | Feature request — {domain} | User submits a feature request | Request text, authenticated contact, role and business |
| Main source, internal operator | [Radar {environment}] Failure/Degraded: {operation} ({provider}) | Action, job or provider failure/degradation; deduped and retried | Redacted failure context for the configured operator; separate service identity and delivery |

There is no dedicated multi-email expired-trial win-back campaign, new-backlink-match notice, link-now-live confirmation, invitation reminder, customer support acknowledgment, article-published receipt or social-published email. Current in-app notifications are not additional email senders. Stripe-native dashboard email settings are separate from Radar’s templates and have not been established by the code inventory; do not label them active without account-level evidence.

Evidence: `.factory/weekly-education/production-inventory.json`, `email-inventory-scout.md` (20worktrees searched), current source/QA records and the separate local report companion record. The original inventory checkpoint remains historical evidence. Current hosted acceptance is under shipping/; source implementation alone is not evidence of a human inbox receipt.

Current rewrite and scheduling evidence: `.factory/lifecycle-refinement/`. The complete current catalogue is `previews/index.html`, `all-emails.txt` and `catalogue.json` there (29 active families / 72 variants plus retired #5, with permanent review numbers). The weekly report now uses the canonical app renderer and runtime; older companion patches remain historical evidence only.

The numbered reading catalogue is `.factory/lifecycle-refinement/previews/catalogue.html` (or `catalogue.md`); numbers #1–#30 stay fixed for review feedback. #29 is the Autopilot owner handoff, which requires explicit per-business activation and does not share the lifecycle education/work opt-out or optional cap. Its footer links to both Email preferences and Autopilot management. Turning education off does not disable the owner-enabled marketing program.

Current-main integration must preserve canonical `0010_autopilot.sql`; the unpublished lifecycle migrations are renumbered to 0011–0014 with newer ordered journal timestamps. Earlier 0010–0013 references in the historical QA records describe the pre-Autopilot branch, not the final rollout order. See `main-integration-architecture.md` and `main-integration-runtime.md` under `.factory/lifecycle-refinement/` for the final integration proof.

## Founder voice correction

New user-facing messages use **Ekene from Radar** as the display name, keeping the configured verified sending address. Replies go to the existing founder mailbox `team@thally.io`. Actual copy is personal advice from Ekene with an Ekene / Founder, Radar sign-off. The founder story is “Why I built Radar”. Third-party invitations/partner actions and automated Radar findings retain their actual attribution. Internal support/feature forwards keep their operational identity and reply routing.

Trial-ending reminder **#5 is retired**, including the collector, direct queue path and pending dispatch. Its number stays reserved; the other references are unchanged. Actual subscription cancellation confirmations remain event-driven. Routine prices and cancellation prompts were removed from trial confirmation; renewal/end-date/credit facts remain. Billing speaks about the Radar subscription. Actual amounts remain on subscription receipts when present, while failed-subscription notices omit them.

The founder correction checkpoint had 28 active families, 68 full variants and retired slot #5; the current Autopilot introduction adds #30 and four access variants. Migration 0015 adds nullable general-outbox sender metadata for new envelopes so founder From/Reply-To remains stable across retries; historical NULL metadata and already-frozen lifecycle envelopes are not rewritten. No messages are replayed to deliver the new copy. See `.factory/lifecycle-refinement/founder-voice-verification.md` for this correction’s current acceptance and release boundary.

## Distinct content correction

The full sequence was reviewed for repetition, beyond #11/#13. Work notices now lead with different artifacts/decisions: fresh threads (#10), proposed topics (#11), saved article as a pack source (#12), saved post timing/sharing (#13), or an alternative combined digest (#14). Lessons teach transferable judgment: answer/citation interpretation (#15), useful personal replies (#16), placement fit (#17), search intent/evidence (#18), and original idea-led social posts (#19). Setup, trial confirmation, recurring receipts/reports and partner updates were shortened to their own new information. Shared generic help openings, repeated advice and blanket reply asks were removed. Same numbers, triggers, preferences and delivery policies; see distinct-copy-review.md under the refinement records.

## Autopilot introduction and body presentation

Email **#30** is a one-time optional introduction, separate from **#29**, the operational action handoff sent after an owner enables Autopilot. Its 48-hour first-observation clock requires a verified non-guest account, a usable owned profile and active Owner membership. No manual workflow, weekly-course completion or Search Console connection is required. Current or past Autopilot use in any currently owned business permanently skips the introduction, including an enabled program without an activation ID. Ownership, source business, recipient, access, use and preferences are rechecked before delivery. Existing users do not receive an account-age catch-up burst.

The active CTA selects the specific business and opens Settings → Autopilot. It never enables a program or starts publishing on GET. Setup, pre-trial and lapsed recipients receive the appropriate setup/trial/subscription prerequisite. Copy describes supported autonomous content/social publishing and acknowledges destinations needing approval or owner action. Education opt-out also stops this guide; the five core lessons remain a finite separate course.

Current catalogue: **29 active families / 72 complete variants / 30 permanent numbered slots**, including retired #5. Email bodies have no repeated H1 or standalone plaintext subject; the subject remains in envelope and catalogue metadata. Additive migration **0016_autopilot_intro** expands the checked guide allowlist after 0015. Matching worker readiness verifies that capability. See `.factory/lifecycle-refinement/autopilot-intro-verification.md` for exact verification and release status.

## Weekly report follow-up

The canonical #28 implementation adds `0017_ai_weekly_report` after unchanged0016. Observation history begins with successful/failed collection persistence after release; it does not backfill latest-state results into past weeks. Only real successful answers contribute to recommendation share. A changed tracked-question series starts a new comparison; no current-week data means no report. One missed-question proposal is saved idempotently when appropriate, and the email only promises a saved topic while that proposed entry exists.

A verified active Owner receives at most one report per business/completed UTC week, observed on Monday after08:00UTC. An old Monday is not caught up. Reports expire at the following Monday08:00UTC and cannot be rekeyed/replayed. Per-business weekly-email opt-out stays independent of education/work categories and works without current paid access. Capture, preparation and suppression-race rechecks enforce current owner, role, verified recipient, access/source and preference. Course takes priority, followed by report, guides, founder and work, all under the shared daytime/24-hour optional cap. Multiple businesses compete fairly by least-recent accepted report. The existing education operational flag controls this optional report too; it does not merge the user preference categories.
