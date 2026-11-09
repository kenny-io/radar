# Current lifecycle schedule

These are runtime schedules in pending PR #25, not a Resend broadcast or a production activation. First-observation delays start when the running feature finds the account eligible; rollout does not calculate overdue sends from old account ages.

| Purpose / former draft | Current subject | Trigger / earliest timing | Audience and exits |
| --- | --- | --- | --- |
| Profile activation | Put your Business Profile to work | Verified account created/confirmed, immediate welcome | Analyzed-profile variant; direct/unfinished signup gets neutral Welcome to Radar. Existing welcome key prevents a second welcome. |
| Founder story | Why we built Radar | Existing founder event, planned +24 hours | Effective optional setup permission; once/account. Existing queued/sent founder mail stays intact. |
| First article workflow | What happens before an article goes live | First observed accessible untouched workspace+24 hours, or eligible saved/analyzed pre-trial profile+3 days. Later access can shorten, never postpone, the remaining delay. | Owner has not approved a topic, entered drafting/review/scheduling/publication, or generated an article in any owned business. Proposed calendar topics alone do not resolve it. Meaningful work permanently skips it. |
| AI questions | Does ChatGPT or Claude recommend {Business}? | Existing weekly lesson 1, first eligible slot | All eligible verified course accounts; setup/pre-trial/lapsed copy and CTA adapt. No duplicate nurture campaign. |
| Useful conversations | Find a conversation {Business} can help with | Existing weekly lesson 2, at least7 days after lesson 1 provider acceptance | Same account-wide course; separate from new Brief missing-action reminders. |
| Reviewed partner links | How {Business} could appear on another site | Existing weekly lesson 3, at least7 days after lesson 2 | Includes already-joined accounts with conditional instructions; network participation remains optional. |
| Search intent and topic choice | What should {Business} publish next? | Existing weekly lesson 4, at least7 days after lesson 3 | Focuses keyword/customer fit and intent, distinct from first-article publishing instructions. |
| Article distribution | Put {Business}’s article to work on social | Existing weekly lesson 5, at least7 days after lesson 4 | Fifth lesson completes the course; no loop/reset. |
| Existing-page refresh | Your next article might be a page you already have | Primary owned business has connected Search Console, a synced-through marker and measured page impressions in the last28 completed local days, plus the account’s Organic Search lesson was actually accepted. Due=max(first observation+24 hours, Organic Search acceptance+7 days). | Recheck ownership/data at send. The public guide is useful without current paid access; private Performance instructions explain the prerequisite. No invented connection timestamp or claim that a specific page underperforms. |

## Shared delivery behavior

- All education and guides are eligible by default, preserving recorded opt-outs. They share the existing signed education category and preference page; turning it off stops both. Research-study participation remains separate and off unless chosen.
- Essential/security/billing notices retain priority. Then weekly course, one-time guides, founder note and work reminders. All optional types share daytime 09:00–18:00 and one new optional mail per rolling 24 hours/account, across businesses.
- Nominal due times can defer for daytime, optional cap or source checks. If Social Marketing and refresh guidance coincide, the weekly lesson takes the next slot and the guide follows in a later slot.
- One durable state/event per account/guide. Progress survives sign-in, subscription transitions and preference toggles; source changes and meaningful completion do not reopen a guide. Retries retain attempted bodies/keys and bounded deduplication windows.
- The separate weekly AI recommendation-share report keeps its own per-business Monday cadence and dedicated opt-out. The copy-only companion remains local to the unmerged measurement feature and does not inherit the lifecycle cap or new guide ledger.

Core trial/payment/cancellation, confirmation, invitations and partner notices remain event-based; copy edits do not add recurring sends. Internal support/feature forwards remain operational. The redundant workspace-ready message remains removed.

## Rollout

Preserve canonical main migration 0010_autopilot. Apply the unpublished lifecycle/engagement/course migrations as 0011–0013, then the guide migration as 0014; journal timestamps must increase after main 0010. Run matching guide-aware web/worker with existing education activation flag after approved release review. Pausing the flag retains history. Do not roll an older guide-unaware dispatcher over queued guide rows; keep the guide-aware worker paused or stop/drain dispatch before rollback. No historical catch-up, old customer mail replay, new service, marketing list or provider campaign.

The numbered catalogue covers #1–#29, with lettered audience/data variants. Main’s Autopilot owner-action handoff is #29: it requires explicit per-business activation and a current eligible owner. It remains operational service mail outside this optional lifecycle cap/category; its footer explains Autopilot management separately from Email preferences. New handoff content is refined in the actual pure builder. Final main-integration evidence supersedes the pre-Autopilot migration numbering above.
