# Independent nurture-copy review

Reviewer: independent critic under `review-the-work`. Editorial scope only; no production sender, audience subscription, trigger or scheduling was changed by this review.

## Initial verdict: REVISE

The seven drafts are original Radar adaptations, not competitor testimonials or product-name substitutions. They follow the actual pre-trial journey and are suitable for revision into review previews. Three small edits are needed before presenting the set:

1. Daily Brief subject is abstract: “Your next useful conversation is worth finding.” Use **“Find one conversation you can help with.”** It names the job and sounds less manufactured.
2. The backlinks bullet “Check which of your pages it points to” assumes every proposal is inbound. Radar has inbound and outbound proposals. Use **“See the destination page and why the link fits.”**
3. The AI-visibility preheader is needlessly comparative. Use **“Read each assistant’s response and the pages it cites.”** It states the concrete value.

## Fact and voice checks

- **Analyzed profile:** Activation explicitly assumes completed website analysis and a saved Business Profile. It does not ask the visitor to enter the website again. The metadata correctly makes it an alternative to the existing welcome, not an additional account-created message.
- **Actual workflow:** Topic research/proposals, approval, drafting, review and optional scheduling are consistent with calendar/drafting code. Blog autopilot is a separate opt-in. Pre-trial language does not claim these jobs are already running.
- **Founder:** Matches the owner's already-approved reason and help offer. It should reuse `founder_note`, retaining its existing opt-out and dedupe, rather than inserting another founder letter.
- **Backlinks:** Actual matching creates incoming and outgoing proposals. Weekly verification and optional auto-approval are implemented. Draft does not promise daily links, authority scores, rankings or safety guarantees. Correct the direction-specific bullet above.
- **Daily Brief:** Supported sources include Reddit, X, LinkedIn and Hacker News. Draft says Radar looks for relevant discussions and proposes replies, not that every run finds results or replies automatically. It is feature education for pre-trial users, distinct from the action-conditioned post-activation reminder.
- **AI visibility:** Actual prompt generation, assistant responses, mention detection and source citations support the claims. “Not collected” is explicitly distinct from “not mentioned.” No separate free checker or promise of recommendations is implied. Performance → AI Visibility matches the existing UI.
- **Search guide:** Uses supported Search Console impressions/clicks/positions and suggestions. It does not repeat third-party Bing release news or assume data is already connected. Positions10–20 are investigation candidates, not a ranking or click forecast.
- **Outcome claims:** No competitor case studies, testimonials, DR statistics, fabricated screenshots,35%growth promise or personalized competitive claim is reused.
- **Pricing:** Copy uses “trial,” never a free-trial claim. Preview trial captions must use the actual shared constants:3days, $1confirmation credited toward first month, normally$49first month then$50/month, cancellation before trial end avoids monthly subscription charges. This review has not independently inspected the renderer yet.

## Audience and send-policy recommendations

These remain editorial drafts, not authorization for an operational marketing sequence. Before any later sender wiring:

- Require separate applicable consent for pre-trial product education; do not reuse work-reminder opt-ins as a marketing subscription.
- Recheck trial/account state immediately before sending. Exclude started trials, paid/complimentary access and prior subscribers, not just accounts currently inactive. A canceled subscriber should not receive “start your trial” onboarding.
- Deduplicate welcome/founder against their existing events. Starting a trial ends this pre-trial sequence; a new active-user education series would require different calls to action.
- Use a finite sequence and a conservative shared optional-email cap. The draft day gaps are reasonable recommendations, not active triggers. Avoid sending overdue messages in a burst.
- The backlinks introduction is the weakest conversion item: it explains review mechanics well but is less immediately useful to a pre-trial reader. Keep it late and interest-specific, or omit it if the recipient showed no interest. Do not frame network joining as required account setup.
- The Search Console guide should be skipped or adapted for a site with no meaningful search history if reliable history is available; otherwise keep its current conditional “if your site has…data” wording.

## Source checks

Read the drafts; approved founder text; `src/lib/billing.ts`; AI visibility collection/read model and actions; Performance UI; drafting jobs; backlinks matching/network/weekly verification; and Daily Brief scan source selection. No external claims require borrowing the competitor's numbers.

Only `.factory/lifecycle-emails/nurture/review.md` is owned by this reviewer. Other agents' files and the unrelated indexing log were preserved.

## Final verdict: PASS for editorial preview

Re-read `copy.mjs` after the author applied all three requested edits. The Daily Brief subject now names the contribution the reader can make; the link-placement bullet works for inbound and outbound proposals; the AI preheader states a specific inspectable benefit.

Also inspected `scripts/preview-nurture-emails.mjs`: it has no sender/queue/database import, derives trial details from the shared billing constants, keeps the existing Radar mark/compact button, provides plaintext companions, and labels the gallery as unscheduled drafts with preview-only unsubscribe links. Four trial CTAs include the actual $1/3-day/$49-first-month/$50-renewal terms. The public backlinks and guide links do not pretend to start a trial. The founder action is a reply to team@thally.io.

The remaining weakest draft is the backlinks introduction. Its value is reader relevance and review control, not a demonstrated customer outcome; keep its interest-specific late position. That is an honest limitation, not a reason to invent a testimonial or ranking statistic.

These pass as seven drafts for the owner's review. This verdict does not approve sending, enrollment, a live unsubscribe implementation, trial-state audience selection or an automated campaign. Those are intentionally outside the current editorial artifacts. No runtime file, marketing preference, existing approved message or pending-work trigger was edited by the reviewer.
