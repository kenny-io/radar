# Radar email inventory

The production inventory checkpoint on 2026-11-09 found web and worker healthy at 60c68af34c6f80eee8fd7efa8eb2f02c3794394d. The six existing sender families are live; their rewritten copy below is local in pending PR #25. Other rows are local implementations. Subjects below show the revised source, not a claim that these revisions have shipped. Resend reported no automations and no Radar broadcasts; two unrelated Thally campaigns were drafts. Recent delivery records confirm Radar mailbox confirmation and the internal support handoff; historical welcome/reset simulator messages are not production-customer sends.

The weekly-education implementation builds on pending PR #25, integrating main safely. All registered verified accounts are eligible for five weekly lessons by default, including pre-trial, trial, paid, complimentary and lapsed accounts. Recorded opt-outs remain honored. Event-driven emails still require their actual trigger. Guest/unverified addresses and provider-suppressed recipients do not receive the education course. One account receives one sequence across businesses, not one per business. The first lesson waits for daytime/optional-mail capacity; subsequent lessons wait at least seven days after provider acceptance. Five then complete, with no loop or catch-up burst.

The distinct weekly recommendation-share report lives in the original checkout’s unmerged AI measurement feature. It is not lesson 1 of the educational course. The narrow local companion now makes missing/new report preferences default on, preserves stored opt-outs and adds a scoped public preferences form and frozen HTML/text footer. It must ship with that separate feature after resolving its existing migration collision and integrating main’s verified-mailbox scheduling/dispatch eligibility. Keep this separate source/release status visible; it does not yet share the lifecycle optional-mail cap.

| Status | Revised subject | Trigger | Cadence | Content |
| --- | --- | --- | --- | --- |
| Live family; rewrite local | Confirm your email for Radar | Password signup or requested confirmation resend | Per request;30-minute one-use link; rate limited | Confirm mailbox and choose password |
| Live family; rewrite local | {inviter} invited you to {business} on Radar | Owner/Admin invites a teammate | Per invitation;14-day acceptance link | Business, role and invitation acceptance |
| Live family; rewrite local | {business} approved a partner link on {page} | Incoming backlink proposal approved | After20-second Undo window | Exact proposed sentence, target, anchor, qualifier, disclosure and placement instructions |
| Live family; rewrite local | {business} passed on a partner link | Backlink rejected with a note | After20-second Undo window | Proposal and decline note; silent decline sends nothing |
| Live family; rewrite local | Link removal request from {business} | Removal requested for a live backlink | Per removal request | Page/target/anchor and request to remove within seven days |
| Live family; rewrite local | Partner link not found on {page} / Partner link attribute changed on {page} | Live link becomes missing or loses qualifier; manual Re-check can repeat | Weekly verification detects transitions; manual action can notify again | Both owners receive the link and issue requiring attention |
| Local: PR #25 | Put your Business Profile to work / Welcome to Radar | Account confirmed or new verified Google account created | Once/account | Continue from existing analyzed Business Profile, or neutral account-ready next step |
| Local: PR #25 | Why we built Radar | New verified account | Planned24h later; optional cap/daytime can delay | Ekene’s reason for building Radar and offer to help |
| Local: PR #25 | Reset your Radar password | Valid password-reset request | Per request; one-hour single-use link | Password reset and session-security guidance |
| Local: PR #25 | Your Radar trial is on | Trial successfully activated | Once/trial | End date, confirmation credit, billing amounts and cancellation path |
| Local: PR #25 | Your Radar trial ends soon | Trial remains active and isn’t scheduled to cancel |24h before trial end; no overdue historical backfill | End date, automatic renewal and how to cancel |
| Local: PR #25 | Your Radar receipt | Qualifying invoice-paid webhook | Per qualifying invoice | Actual amount/currency and invoice download path |
| Local: PR #25 | Your Radar payment didn’t go through | Invoice payment-failure webhook; still unpaid at send | Per eligible failure event | Update card/pay invoice and access implications |
| Local: PR #25 | Your Radar cancellation is confirmed | Current subscription changes to cancel at period end | Once/actual transition | Access end date and no renewal; resume link |
| Local: PR #25 | Your Radar subscription has ended | Current subscription enters canceled/incomplete_expired | Once/actual transition | Ended/expired setup state and account restart path |
| Local: work reminder | Conversations worth joining | New Daily Brief remains without copied/posted reply | After1h; same-day relevance window | Review conversations, edit a reply and participate |
| Local: work reminder | Choose the topics you want to publish | New content plan has no approval/scheduling action | After24h; once/source | Review useful topics and complete the next step |
| Local: work reminder | Turn your article into social posts | Newly ready article has no article-sourced social content | After2h; once/source | Create and review social posts from the article |
| Local: work reminder | Your social posts are ready to schedule | New pack has no copied/scheduled/posted content | After24h; once/source | Review the saved posts and publish/schedule/share |
| Local: combined work reminder | A few things to pick up in Radar | Two/three unfinished source actions are eligible together | Combined; at most one new optional email/account/24h | Up to three relevant next steps across owned businesses |
| Local: education week1 | Does ChatGPT or Claude recommend {business}? | Verified account enrollment, including existing users | First of five; daytime/cap respected | Two buyer questions, inspect answers/citations, choose an article question and track counts |
| Local: education week2 | Find a conversation {business} can help with | Lesson1 provider-accepted | At least7 days later | Find useful threads, edit/post replies and check follow-through |
| Local: education week3 | How {business} could appear on another site | Lesson2 provider-accepted | At least7 days later | Join the optional network, review proposals and check live placement |
| Local: education week4 | What should {business} publish next? | Lesson3 provider-accepted | At least7 days later | Compare keyword fit and search intent, approve a useful topic and compare measured search activity |
| Local: education week5 | Put {business}’s article to work on social | Lesson4 provider-accepted | At least7 days later; sequence ends | Generate/review a social pack, publish/schedule and check actual post status |
| Local: one-time guide | What happens before an article goes live | Eligible owned profile/workspace with no meaningful content workflow | First observation +24 hours with workspace access; +3 days pre-trial | Choose a topic, review the draft, connect publishing and control what goes live |
| Local: one-time guide | Your next article might be a page you already have | Real recent Search Console page data plus accepted Organic Search lesson | Later of readiness observation +24 hours and Organic Search acceptance +7 days | Evaluate an existing-page refresh; public guide with accurate private-data prerequisites |
| Separate local AI feature | Recommendation share this week · {domain} | Active business with collected AI answers in the preceding week | Monday after08:00UTC/12:00Dubai; once/business/week | Current/previous recommendation share, change, biggest miss and proposed topic |

Education subjects have neutral fallbacks when no business name exists. Pre-trial/lapsed/setup variants explain the prerequisite and give the appropriate next-step CTA. Core lifecycle messages, work reminders and weekly education use HTML/plain text and a compact Email preferences footer button. Optional categories can be stopped independently without suppressing security/billing messages. New/missing work preferences default on; existing persisted false values remain off. Only new work events are captured, so rollout does not send a historical backlog. Weekly lessons take the next eligible optional slot ahead of work reminders, preserving the24-hour cap and essential-mail priority.

The seven former drafts now have runtime destinations. Copy is imported from actual renderers by the compatibility preview adapter, not kept as a second set of editable drafts.

| Former draft | Actual destination | Cadence |
| --- | --- | --- |
| Put your Business Profile to work | Analyzed-profile welcome replacement | Immediate after confirmed account creation |
| Why we built Radar | Existing founder event | Planned +24 hours; cap/daytime can defer |
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

Current rewrite and scheduling evidence: `.factory/lifecycle-refinement/`. The complete current catalogue is `previews/index.html`, `all-emails.txt` and `catalogue.json` there (28 families, plus access/role/data variants). The separate AI report uses a copy-only companion patch and keeps its earlier release limitations.
