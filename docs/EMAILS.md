# Radar email inventory

The production inventory checkpoint on 2026-11-09 found web and worker healthy at 60c68af34c6f80eee8fd7efa8eb2f02c3794394d. The six sender families verified at that checkpoint are live; their rewritten copy below is local in pending PR #25. Main subsequently added the owner-enabled Autopilot handoff family in PR #37 (source b38b67a4); its deployment/receipt was not independently rechecked here. Other rows are local implementations. Subjects below show the revised source, not a claim that these revisions have shipped. Resend reported no automations and no Radar broadcasts; two unrelated Thally campaigns were drafts. Recent delivery records confirm Radar mailbox confirmation and the internal support handoff; historical welcome/reset simulator messages are not production-customer sends.

The weekly-education implementation builds on pending PR #25, integrating main safely. All registered verified accounts are eligible for five weekly lessons by default, including pre-trial, trial, paid, complimentary and lapsed accounts. Recorded opt-outs remain honored. Event-driven emails still require their actual trigger. Guest/unverified addresses and provider-suppressed recipients do not receive the education course. One account receives one sequence across businesses, not one per business. The first lesson waits for daytime/optional-mail capacity; subsequent lessons wait at least seven days after provider acceptance. Five then complete, with no loop or catch-up burst.

The distinct weekly recommendation-share report lives in the original checkout’s unmerged AI measurement feature. It is not lesson 1 of the educational course. The narrow local companion now makes missing/new report preferences default on, preserves stored opt-outs and adds a scoped public preferences form and frozen HTML/text footer. It must ship with that separate feature after resolving its existing migration collision and integrating main’s verified-mailbox scheduling/dispatch eligibility. Keep this separate source/release status visible; it does not yet share the lifecycle optional-mail cap.

| Number | Status | Revised subject | Trigger | Cadence | Content |
| --- | --- | --- | --- | --- | --- |
| #1 | Local: PR #25 | Put your Business Profile to work / Welcome to Radar | Account confirmed or new verified Google account created | Once/account | Continue from existing analyzed Business Profile, or neutral account-ready next step |
| #2 | Local: PR #25 | Why I built Radar | New verified account | Planned24h later; optional cap/daytime can delay | Ekene’s reason for building Radar and offer to help |
| #3 | Local: PR #25 | Reset your Radar password | Valid password-reset request | Per request; one-hour single-use link | Password reset and session-security guidance |
| #4 | Local: PR #25 | Your Radar trial is on | Trial successfully activated | Once/trial | Founder’s first-use advice, trial end date, subscription continuation and card-confirmation credit; no cancellation prompt or routine price |
| #5 | Retired | Trial-ending reminder | No trigger | Never sent | New queueing is disabled; pending reminders are suppressed without replay or deleting history |
| #6 | Local: PR #25 | Your Radar subscription receipt | Qualifying invoice-paid webhook | Per qualifying invoice | Actual amount/currency and invoice download path |
| #7 | Local: PR #25 | Your Radar subscription needs attention | Invoice payment-failure webhook; still unpaid at send | Per eligible failure event | Update card/pay invoice and access implications |
| #8 | Local: PR #25 | Your Radar cancellation is confirmed | Current subscription changes to cancel at period end | Once/actual transition | Access end date and no renewal; resume link |
| #9 | Local: PR #25 | Your Radar subscription has ended | Current subscription enters canceled/incomplete_expired | Once/actual transition | Ended/expired setup state and account restart path |
| #10 | Local: work reminder | Conversations worth joining | New Daily Brief remains without copied/posted reply | After1h; same-day relevance window | Review conversations, edit a reply and participate |
| #11 | Local: work reminder | Choose the topics you want to publish | New content plan has no approval/scheduling action | After24h; once/source | Review useful topics and complete the next step |
| #12 | Local: work reminder | Turn your article into social posts | Newly ready article has no article-sourced social content | After2h; once/source | Create and review social posts from the article |
| #13 | Local: work reminder | Your social posts are ready to schedule | New pack has no copied/scheduled/posted content | After24h; once/source | Review the saved posts and publish/schedule/share |
| #14 | Local: combined work reminder | A few things to pick up in Radar | Two/three unfinished source actions are eligible together | Combined; at most one new optional email/account/24h | Up to three relevant next steps across owned businesses |
| #15 | Local: education week1 | Does ChatGPT or Claude recommend {business}? | Verified account enrollment, including existing users | First of five; daytime/cap respected | Two buyer questions, inspect answers/citations, choose an article question and track counts |
| #16 | Local: education week2 | Find a conversation {business} can help with | Lesson1 provider-accepted | At least7 days later | Find useful threads, edit/post replies and check follow-through |
| #17 | Local: education week3 | How {business} could appear on another site | Lesson2 provider-accepted | At least7 days later | Join the optional network, review proposals and check live placement |
| #18 | Local: education week4 | What should {business} publish next? | Lesson3 provider-accepted | At least7 days later | Compare keyword fit and search intent, approve a useful topic and compare measured search activity |
| #19 | Local: education week5 | Put {business}’s article to work on social | Lesson4 provider-accepted | At least7 days later; sequence ends | Generate/review a social pack, publish/schedule and check actual post status |
| #20 | Local: one-time guide | What happens before an article goes live | Eligible owned profile/workspace with no meaningful content workflow | First observation +24 hours with workspace access; +3 days pre-trial | Choose a topic, review the draft, connect publishing and control what goes live |
| #21 | Local: one-time guide | Your next article might be a page you already have | Real recent Search Console page data plus accepted Organic Search lesson | Later of readiness observation +24 hours and Organic Search acceptance +7 days | Evaluate an existing-page refresh; public guide with accurate private-data prerequisites |
| #22 | Live family; rewrite local | Confirm your email for Radar | Password signup or requested confirmation resend | Per request;30-minute one-use link; rate limited | Confirm mailbox and choose password |
| #23 | Live family; rewrite local | {inviter} invited you to {business} on Radar | Owner/Admin invites a teammate | Per invitation;14-day acceptance link | Business, role and invitation acceptance |
| #24 | Live family; rewrite local | {business} approved a partner link on {page} | Incoming backlink proposal approved | After20-second Undo window | Exact proposed sentence, target, anchor, qualifier, disclosure and placement instructions |
| #25 | Live family; rewrite local | {business} passed on a partner link | Backlink rejected with a note | After20-second Undo window | Proposal and decline note; silent decline sends nothing |
| #26 | Live family; rewrite local | Link removal request from {business} | Removal requested for a live backlink | Per removal request | Page/target/anchor and request to remove within seven days |
| #27 | Live family; rewrite local | Partner link not found on {page} / Partner link attribute changed on {page} | Live link becomes missing or loses qualifier; manual Re-check can repeat | Weekly verification detects transitions; manual action can notify again | Both owners receive the link and issue requiring attention |
| #28 | Separate local AI feature | Recommendation share this week · {domain} | Active business with collected AI answers in the preceding week | Monday after08:00UTC/12:00Dubai; once/business/week | Current/previous recommendation share, change, biggest miss and proposed topic |
| #29 | Main Autopilot source; rewrite local | Radar Autopilot: {N} action needs/actions need you · {business} | Owner-enabled Autopilot finds new owner actions | Per deduplicated action batch; separate from lifecycle cadence | Prepared drafts, source links, business-scoped actions and Autopilot management |

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

Two messages are sent by Radar **to its team**, not to the user:

| Status | Subject | Trigger/cadence | Content |
| --- | --- | --- | --- |
| Live, internal | Radar support request | User explicitly selects Email support; retry deduped | Conversation, page/business context and reply contact |
| Live, internal | Feature request — {domain} | User submits a feature request | Request text, authenticated contact, role and business |

There is no dedicated multi-email expired-trial win-back campaign, new-backlink-match notice, link-now-live confirmation, invitation reminder, customer support acknowledgment, article-published receipt or social-published email. Current in-app notifications are not additional email senders. Stripe-native dashboard email settings are separate from Radar’s templates and have not been established by the code inventory; do not label them active without account-level evidence.

Evidence: `.factory/weekly-education/production-inventory.json`, `email-inventory-scout.md` (20worktrees searched), current source/QA records and the separate local report companion record. All live/local labels describe the state at this checkpoint; merging/deploying the pending release changes those labels.

Current rewrite and scheduling evidence: `.factory/lifecycle-refinement/`. The complete current catalogue is `previews/index.html`, `all-emails.txt` and `catalogue.json` there (28 active families / 68 variants plus retired #5, with permanent review numbers). The separate AI report uses a copy-only companion patch and keeps its earlier release limitations.

The numbered reading catalogue is `.factory/lifecycle-refinement/previews/catalogue.html` (or `catalogue.md`); numbers #1–#29 stay fixed for review feedback. #29 is the Autopilot owner handoff, which requires explicit per-business activation and does not share the lifecycle education/work opt-out or optional cap. Its footer links to both Email preferences and Autopilot management. Turning education off does not disable the owner-enabled marketing program.

Current-main integration must preserve canonical `0010_autopilot.sql`; the unpublished lifecycle migrations are renumbered to 0011–0014 with newer ordered journal timestamps. Earlier 0010–0013 references in the historical QA records describe the pre-Autopilot branch, not the final rollout order. See `main-integration-architecture.md` and `main-integration-runtime.md` under `.factory/lifecycle-refinement/` for the final integration proof.

## Founder voice correction

New user-facing messages use **Ekene from Radar** as the display name, keeping the configured verified sending address. Replies go to the existing founder mailbox `team@thally.io`. Actual copy is personal advice from Ekene with an Ekene / Founder, Radar sign-off. The founder story is “Why I built Radar”. Third-party invitations/partner actions and automated Radar findings retain their actual attribution. Internal support/feature forwards keep their operational identity and reply routing.

Trial-ending reminder **#5 is retired**, including the collector, direct queue path and pending dispatch. Its number stays reserved; the other references are unchanged. Actual subscription cancellation confirmations remain event-driven. Routine prices and cancellation prompts were removed from trial confirmation; renewal/end-date/credit facts remain. Billing speaks about the Radar subscription. Actual amounts remain on subscription receipts when present, while failed-subscription notices omit them.

Final numbered catalogue: 28 active families, 68 full variants and retired slot #5. Migration 0015 adds nullable general-outbox sender metadata for new envelopes so founder From/Reply-To remains stable across retries; historical NULL metadata and already-frozen lifecycle envelopes are not rewritten. No messages are replayed to deliver the new copy. See `.factory/lifecycle-refinement/founder-voice-verification.md` for this correction’s current acceptance and release boundary.
