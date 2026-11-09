# Radar email inventory

Checked2026-11-09. Production web and worker both reported healthy at60c68af34c6f80eee8fd7efa8eb2f02c3794394d. **Live** means the sender/trigger is in that deployed revision, not proof every email type has recently been delivered. Resend reported no automations and no Radar broadcasts; two unrelated Thally campaigns were drafts. Recent delivery records confirm Radar mailbox confirmation and the internal support handoff; historical welcome/reset simulator messages are not production-customer sends.

The weekly-education implementation builds on pending PR25, integrating main safely. All registered verified accounts are eligible for five weekly lessons by default, including pre-trial, trial, paid, complimentary and lapsed accounts. Recorded opt-outs remain honored. Event-driven emails still require their actual trigger. Guest/unverified addresses and provider-suppressed recipients do not receive the education course. One account receives one sequence across businesses, not one per business. The first lesson waits for daytime/optional-mail capacity; subsequent lessons wait at least seven days after provider acceptance. Five then complete, with no loop or catch-up burst.

The distinct weekly recommendation-share report lives in the original checkout’s unmerged AI measurement feature. It is not lesson1 of the educational course. The narrow local companion now makes missing/new report preferences default on, preserves stored opt-outs and adds a scoped public preferences form and frozen HTML/text footer. It must ship with that separate feature after resolving its existing migration collision and integrating main’s verified-mailbox scheduling/dispatch eligibility. Keep this separate source/release status visible; it does not yet share the lifecycle optional-mail cap.

| Status | Subject | Trigger | Cadence | Content |
| --- | --- | --- | --- | --- |
| Live | Confirm your email for Radar | Password signup or requested confirmation resend | Per request;30-minute one-use link; rate limited | Confirm mailbox and choose password |
| Live | {inviter} invited you to {business} on Radar | Owner/Admin invites a teammate | Per invitation;14-day acceptance link | Business, role and invitation acceptance |
| Live | {business} approved a partner link on {page} | Incoming backlink proposal approved | After20-second Undo window | Exact proposed sentence, target, anchor, qualifier, disclosure and placement instructions |
| Live | {business} passed on a partner link | Backlink rejected with a note | After20-second Undo window | Proposal and decline note; silent decline sends nothing |
| Live | Link removal request from {business} | Removal requested for a live backlink | Per removal request | Page/target/anchor and request to remove within seven days |
| Live | Partner link not found on {page} | Live link becomes missing or loses qualifier; manual Re-check can repeat | Weekly verification detects transitions; manual action can notify again | Both owners receive the link and issue requiring attention |
| Local: PR25 | Welcome to Radar | Account confirmed or new verified Google account created | Once/account | Continue from existing analyzed Business Profile, or neutral account-ready next step |
| Local: PR25 | Why we built Radar | New verified account | Planned24h later; optional cap/daytime can delay | Ekene’s reason for building Radar and offer to help |
| Local: PR25 | Reset your Radar password | Valid password-reset request | Per request; one-hour single-use link | Password reset and session-security guidance |
| Local: PR25 | Your Radar trial is on | Trial successfully activated | Once/trial | End date, confirmation credit, billing amounts and cancellation path |
| Local: PR25 | Your Radar trial ends soon | Trial remains active and isn’t scheduled to cancel |24h before trial end; no overdue historical backfill | End date, automatic renewal and how to cancel |
| Local: PR25 | Your Radar receipt | Qualifying invoice-paid webhook | Per qualifying invoice | Actual amount/currency and invoice download path |
| Local: PR25 | Your Radar payment didn’t go through | Invoice payment-failure webhook; still unpaid at send | Per eligible failure event | Update card/pay invoice and access implications |
| Local: PR25 | Your Radar cancellation is confirmed | Current subscription changes to cancel at period end | Once/actual transition | Access end date and no renewal; resume link |
| Local: PR25 | Your Radar subscription has ended | Current subscription enters canceled/incomplete_expired | Once/actual transition | Ended/expired setup state and account restart path |
| Local: work reminder | Conversations worth joining | New Daily Brief remains without copied/posted reply | After1h; same-day relevance window | Review conversations, edit a reply and participate |
| Local: work reminder | Choose the topics you want to publish | New content plan has no approval/scheduling action | After24h; once/source | Review useful topics and complete the next step |
| Local: work reminder | Turn your article into social posts | Newly ready article has no article-sourced social content | After2h; once/source | Create and review social posts from the article |
| Local: work reminder | Your social posts are ready to schedule | New pack has no copied/scheduled/posted content | After24h; once/source | Review the saved posts and publish/schedule/share |
| Local: combined work reminder | A few things to pick up in Radar | Two/three unfinished source actions are eligible together | Combined; at most one new optional email/account/24h | Up to three relevant next steps across owned businesses |
| Local: education week1 | Does ChatGPT or Claude recommend {business}? | Verified account enrollment, including existing users | First of five; daytime/cap respected | Two buyer questions, inspect answers/citations, choose an article question and track counts |
| Local: education week2 | Five conversations {business} could join this week | Lesson1 provider-accepted | At least7days later | Find useful threads, edit/post replies and check follow-through |
| Local: education week3 | Could another founder’s site introduce {business}? | Lesson2 provider-accepted | At least7days later | Join the optional network, review proposals and check live placement |
| Local: education week4 | What should {business} publish next? | Lesson3 provider-accepted | At least7days later | Approve a focused topic, review/publish the draft and measure in Search Console |
| Local: education week5 | Give {business}’s next article another outing | Lesson4 provider-accepted | At least7days later; sequence ends | Generate/review a social pack, publish/schedule and check actual post status |
| Separate local AI feature | Recommendation share this week · {domain} | Active business with collected AI answers in the preceding week | Monday after08:00UTC/12:00Dubai; once/business/week | Current/previous recommendation share, change, biggest miss and proposed topic |

Education subjects have neutral fallbacks when no business name exists. Pre-trial/lapsed/setup variants explain the prerequisite and give the appropriate next-step CTA. Core lifecycle messages, work reminders and weekly education use HTML/plain text and a compact Email preferences footer button. Optional categories can be stopped independently without suppressing security/billing messages. New/missing work preferences default on; existing persisted false values remain off. Only new work events are captured, so rollout does not send a historical backlog. Weekly lessons take the next eligible optional slot ahead of work reminders, preserving the24-hour cap and essential-mail priority.

Earlier education drafts remain local editorial references, not a second scheduled campaign:

| Status | Subject | Earlier proposed timing | Content |
| --- | --- | --- | --- |
| Draft; welcome alternative | Put your Business Profile to work | Day0; never wired | Saved profile→trial→first content workflow |
| Draft/reference; existing founder event | Why we built Radar | Day1; no additional send | Approved founder story and help offer |
| Draft only | What happens before an article goes live | Day4; never wired | Research, topics, draft review and publishing controls |
| Draft only | Would an AI assistant recommend your product? | Day7; never wired | Five assistants, answers/citations and tracked questions |
| Draft only | Your next article might be a page you already have | Day11; never wired | Search Console page refresh opportunities |
| Draft only | Read the sentence before you agree to the link | Day14; never wired | Backlink placement context and approval |
| Draft only | Find one conversation you can help with | Day18; never wired | Daily Brief and personal, useful replies |
| Retired; suppressed | Your Radar workspace is ready | Former activation event; removed | Redundant workspace/profile-ready notice; not queued now |

Two messages are sent by Radar **to its team**, not to the user:

| Status | Subject | Trigger/cadence | Content |
| --- | --- | --- | --- |
| Live, internal | Radar support request | User explicitly selects Email support; retry deduped | Conversation, page/business context and reply contact |
| Live, internal | Feature request — {domain} | User submits a feature request | Request text, authenticated contact, role and business |

There is no dedicated multi-email expired-trial win-back campaign, new-backlink-match notice, link-now-live confirmation, invitation reminder, customer support acknowledgment, article-published receipt or social-published email. Current in-app notifications are not additional email senders. Stripe-native dashboard email settings are separate from Radar’s templates and have not been established by the code inventory; do not label them active without account-level evidence.

Evidence: `.factory/weekly-education/production-inventory.json`, `email-inventory-scout.md` (20worktrees searched), current source/QA records and the separate local report companion record. All live/local labels describe the state at this checkpoint; merging/deploying the pending release changes those labels.
